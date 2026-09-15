const path = require('node:path')
const { createSitePolicy } = require('./site-policy.cjs')
const { createStaffRuntime } = require('./staff-runtime.cjs')
const { createCodexProvider } = require('./codex-staff-provider.cjs')
const { resolveExecution } = require('./staff-model-policy.cjs')

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
  const policies = createSitePolicy(root)
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
    const match = pathname.match(/^\/runs\/([A-Za-z0-9_-]{1,100})(\/(?:cancel|decision))?$/)
    if (req.method === 'GET' && match && !match[2]) {
      let run
      try { run = getRuntime().getRun(match[1], new URL(req.url, 'http://local').searchParams.get('projectId') || undefined) } catch { return reply(res, 409, { error: '保存された実行記録を読み込めませんでした。' }) }
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
      if (match?.[2] === '/decision') {
        const profile = policies.requirePermission(body.projectId, 'ai')
        if (profile.category !== 'general') return reply(res, 403, { error: '追加検討はAI検討を許可した一般サイト専用です。' })
        return reply(res, 200, getRuntime().decide(match[1], body.projectId, body))
      }
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
      const profile = policies.requirePermission(body.projectId, 'ai')
      if (profile.category !== 'general') return reply(res, 403, { error: '通常のAI依頼は一般サイト専用です。制限対象サイトは診断結果の技術保守を利用してください。' })
      if (body.execution?.model === 'gpt-6-astra' && (typeof body.astraReason !== 'string' || body.astraReason.trim().length < 5)) return reply(res, 400, { error: 'Astraが必要な理由と今回の承認を指定してください。' })
      let execution
      try { execution = resolveExecution(body.execution || { model: profile.model, reasoningEffort: profile.reasoningEffort }) } catch (error) { return reply(res, 400, { error: error.message }) }
      const run = getRuntime().start({ projectId: body.projectId, request: body.request.trim(), execution })
      return reply(res, 202, run)
    } catch (error) {
      if (error?.code === 'SITE_POLICY') return reply(res, 403, { error: error.message })
      // Do not reflect CLI output, credential paths or arbitrary exception data.
      if (!res.headersSent) reply(res, error instanceof SyntaxError ? 400 : 409, {
        error: error instanceof SyntaxError ? '送信データを読み取れませんでした。' : '実行を開始できませんでした。実行中の依頼やスタッフ設定を確認してください。',
      })
    }
  }
  return { handler, close: () => runtime?.close() }
}
module.exports = { createStaffApi, permitted }
