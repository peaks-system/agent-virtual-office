const path = require('node:path')
const { createStaffRuntime } = require('./staff-runtime.cjs')
const { createCodexProvider } = require('./codex-staff-provider.cjs')

const loopback = value => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value)
function permitted(req) {
  if (!loopback(req.socket?.remoteAddress)) return false
  const host = req.headers.host
  if (typeof host !== 'string' || !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin && origin !== `http://${host}`) return false
  return req.method !== 'POST' || origin === `http://${host}`
}

function createStaffApi({ root, authorize = () => true, runtime: suppliedRuntime } = {}) {
  let runtime = suppliedRuntime
  const getRuntime = () => runtime ||= createStaffRuntime({
    provider: createCodexProvider(),
    dataRoot: path.join(root, '.office-work', 'staff'),
    configPath: path.join(root, 'config', 'staff.json'),
  })
  const reply = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(value))
  }
  const handler = async (req, res) => {
    if (!permitted(req) || !authorize(req)) return reply(res, 403, { error: 'この操作は同じPCのオフィス画面から実行してください。' })
    const pathname = new URL(req.url, 'http://local').pathname.replace(/^\/api\/staff(?=\/|$)/, '')
    const match = pathname.match(/^\/runs\/([A-Za-z0-9_-]{1,100})(\/cancel)?$/)
    if (req.method === 'GET' && match && !match[2]) {
      const run = runtime?.getRun(match[1])
      return reply(res, run ? 200 : 404, run || { error: '実行記録が見つかりません。サーバーの再起動後は保存フォルダーを確認してください。' })
    }
    if (req.method !== 'POST' || !(pathname === '/runs' || match?.[2])) return reply(res, 404, { error: '操作が見つかりません。' })
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(res, 415, { error: 'JSON形式で送信してください。' })
    let size = 0
    const chunks = []
    try {
      req.setTimeout?.(10000, () => req.destroy())
      for await (const chunk of req) {
        size += chunk.length
        if (size > 40000) { reply(res, 413, { error: '依頼文が長すぎます。短くして再送してください。' }); return }
        chunks.push(Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (match?.[2]) {
        const run = runtime?.getRun(match[1])
        if (!run) return reply(res, 404, { error: '実行記録が見つかりません。' })
        await runtime.cancel(match[1])
        return reply(res, 200, runtime.getRun(match[1]))
      }
      if (typeof body.projectId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.projectId)
          || typeof body.request !== 'string' || !body.request.trim() || body.request.length > 8000) {
        return reply(res, 400, { error: 'プロジェクトと8,000文字以内の依頼文を指定してください。' })
      }
      const run = getRuntime().start({ projectId: body.projectId, request: body.request.trim() })
      return reply(res, 202, run)
    } catch (error) {
      // Do not reflect CLI output, credential paths or arbitrary exception data.
      if (!res.headersSent) reply(res, error instanceof SyntaxError ? 400 : 409, {
        error: error instanceof SyntaxError ? '送信データを読み取れませんでした。' : '実行を開始できませんでした。実行中の依頼やスタッフ設定を確認してください。',
      })
    }
  }
  return { handler, close: () => runtime?.close() }
}
module.exports = { createStaffApi, permitted }
