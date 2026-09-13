'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { permitted } = require('./staff-api.cjs')
const { createWordPressTransport, SITE } = require('./wordpress-transport.cjs')
const { createSitePolicy } = require('./site-policy.cjs')
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = () => { throw new Error('WP_INVALID') }
function plain(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[<>\[\]\x00-\x08]|https?:\/\/|(?:api[_ -]?key|access[_ -]?token|password|client[_ -]?secret)\s*[:=]/i.test(value)) fail()
  return value.trim()
}
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
const markup = text => text.split(/\n\s*\n/).map(p => `<p>${escape(p).replaceAll('\n', '<br>')}</p>`).join('\n')
function snapshot(page) {
  if (!Number.isSafeInteger(page?.id) || page.id < 1 || typeof page.title?.raw !== 'string'
    || typeof page.content?.raw !== 'string' || page.content.raw.length > 40000
    || page.title.raw.length > 300 || typeof page.modified_gmt !== 'string'
    || !['draft', 'publish', 'private', 'pending'].includes(page.status)) fail()
  return { id: page.id, title: page.title.raw, content: page.content.raw, status: page.status, modified: page.modified_gmt }
}
function createWordPressApi({ root, authorize = () => true, call = createWordPressTransport() } = {}) {
  const directory = path.join(root, '.office-work', 'wordpress')
  const connections = new Map(), policies = createSitePolicy(root)
  let busy = false, closed = false
  function location(id) {
    for (const dir of [path.join(root, '.office-work'), directory]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir)
      if (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory()) fail()
    }
    const file = path.join(directory, `${id}.json`)
    if (fs.existsSync(file) && (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 4000000)) fail()
    return file
  }
  const read = id => { const file = location(id); return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [] }
  function save(id, records) {
    const file = location(id), raw = JSON.stringify(records)
    if (Buffer.byteLength(raw) > 4000000 || (!fs.existsSync(file) && fs.readdirSync(directory).filter(n => n.endsWith('.json')).length >= 100)) fail()
    const temp = `${file}.${randomUUID()}.tmp`
    fs.writeFileSync(temp, raw, { flag: 'wx', mode: 0o600 })
    fs.renameSync(temp, file)
  }
  const view = id => { const profile = policies.read(id); const connection = connections.get(id); return { site: profile.siteUrl, category: profile.category, canDraft: profile.permissions.draft && profile.category !== 'unclassified', revision: profile.revision, configured: connection?.site === profile.siteUrl && connection?.revision === profile.revision, busy, records: read(id).map(p => ({ ...p, site: p.site || SITE, kind: p.kind || 'pages' })) } }
  const reply = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)) }
  async function handler(req, res) {
    if (!permitted(req) || !authorize(req)) return reply(res, 403, { error: 'このPCのOffice画面から操作してください。' })
    if (closed) return reply(res, 503, { error: 'Officeは終了しています。' })
    let ownsBusy = false
    try {
      const route = new URL(req.url, 'http://local').pathname.replace(/^\/api\/wordpress(?=\/|$)/, '')
      const match = route.match(/^\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?:\/(proposals|approvals|connection))?$/)
      const id = match?.[1], action = match?.[2]
      if (req.method === 'GET' && id && !action) return reply(res, 200, view(id))
      if (req.method !== 'POST') return reply(res, 405, { error: 'この操作には対応していません。' })
      if (busy) return reply(res, 409, { error: '処理の終了をお待ちください。' })
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(res, 415, { error: '入力形式が正しくありません。' })
      let size = 0; const chunks = []
      req.setTimeout?.(10000, () => req.destroy())
      for await (const chunk of req) { size += chunk.length; if (size > 32768) return reply(res, 413, { error: '入力が長すぎます。' }); chunks.push(chunk) }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail()
      // Recheck after streaming the body to close concurrent-request races.
      if (busy) return reply(res, 409, { error: '処理の終了をお待ちください。' })
      busy = true; ownsBusy = true
      if (!id || !action) return reply(res, 404, { error: '操作が見つかりません。' })
      const profile = policies.requirePermission(id, 'draft')
      const connection = connections.get(id)
      const credentials = connection?.site === profile.siteUrl && connection?.revision === profile.revision ? connection.credentials : null
      if (action === 'connection') {
        if (typeof body.username !== 'string' || !body.username || body.username.length > 100 || /[:\r\n]/.test(body.username)
          || typeof body.password !== 'string' || body.password.length > 64 || !/^[A-Za-z0-9]{24}$/.test(body.password.replaceAll(' ', ''))) fail()
        connections.set(id, { site: profile.siteUrl, revision: profile.revision, credentials: { username: body.username, password: body.password.replaceAll(' ', '') } })
        return reply(res, 200, { configured: true })
      }
      if (!id || !action) return reply(res, 404, { error: '操作が見つかりません。' })
      const records = read(id)
      if (action === 'proposals') {
        if (records.length >= 50 || (profile.category === 'restricted' && body.neutral !== true)) fail()
        const kind = profile.category === 'general' && body.kind === 'posts' ? 'posts' : 'pages'
        const title = plain(body.title, 120), content = plain(body.content, 8000), reason = plain(body.reason, 1000)
        let source = null
        if (body.sourceId !== null && body.sourceId !== undefined && body.sourceId !== '') {
          if (!Number.isSafeInteger(body.sourceId) || body.sourceId < 1 || !credentials) fail()
          source = snapshot(await call('GET', body.sourceId, null, credentials, { site: profile.siteUrl, kind }))
          if (source.id !== body.sourceId) fail()
          if (JSON.stringify(source).includes(credentials.password)) fail()
        }
        const proposal = { site: profile.siteUrl, revision: profile.revision, category: profile.category, kind, id: randomUUID(), createdAt: new Date().toISOString(), source, after: { title, content }, reason, status: 'proposed' }
        proposal.hash = digest({ source, after: proposal.after, reason, id: proposal.id, site: proposal.site, revision: proposal.revision, category: proposal.category, kind: proposal.kind })
        records.unshift(proposal); save(id, records)
        return reply(res, 201, { ...view(id), busy: false })
      }
      const proposal = records.find(p => p.id === body.id)
      const context = proposal?.site ? { site: proposal.site, revision: proposal.revision, category: proposal.category, kind: proposal.kind } : {}
      if (proposal && (proposal.site ? proposal.site !== profile.siteUrl || proposal.revision !== profile.revision || proposal.category !== profile.category : profile.siteUrl !== SITE || profile.revision !== 0)) return reply(res, 409, { error: 'サイト設定が変わっています。変更案を作り直して承認してください。' })
      const target = { site: profile.siteUrl, kind: proposal?.kind || 'pages' }
      if (!credentials || !proposal || proposal.status !== 'proposed' || body.approved !== true || body.hash !== proposal.hash
        || digest({ source: proposal.source, after: proposal.after, reason: proposal.reason, id: proposal.id, ...context }) !== proposal.hash) return reply(res, 409, { error: '接続情報と承認対象を確認してください。実行済み・結果不明の案は再送できません。' })
      if (proposal.source) {
        const current = snapshot(await call('GET', proposal.source.id, null, credentials, target))
        if (digest(current) !== digest(proposal.source)) return reply(res, 409, { error: '元ページが更新されています。変更案を作り直してください。' })
      }
      if (closed || policies.requirePermission(id, 'draft').revision !== profile.revision) fail()
      // Journal before the only write: even crashes/timeouts must never cause retries.
      proposal.status = 'sending'; proposal.approvedAt = new Date().toISOString()
      proposal.slug = `office-maintenance-${proposal.id}`
      save(id, records)
      const payload = { title: proposal.after.title, content: markup(proposal.after.content), status: 'draft', slug: proposal.slug, comment_status: 'closed', ping_status: 'closed' }
      try {
        const created = await call('POST', null, payload, credentials, target)
        if (!Number.isSafeInteger(created?.id) || created.id < 1 || created.id === proposal.source?.id) fail()
        proposal.draftId = created.id; proposal.status = 'saved'; save(id, records)
        try {
          const actual = snapshot(await call('GET', created.id, null, credentials, target))
          proposal.checks = { draft: actual.id === created.id && actual.status === 'draft', title: actual.title === payload.title, content: actual.content === payload.content }
          if (proposal.source) proposal.checks.sourceUnchanged = digest(snapshot(await call('GET', proposal.source.id, null, credentials, target))) === digest(proposal.source)
          proposal.status = Object.values(proposal.checks).every(Boolean) ? 'checked' : 'needs-review'
        } catch { proposal.status = 'needs-review' }
      } catch { proposal.status = proposal.draftId ? 'needs-review' : 'uncertain' }
      save(id, records)
      return reply(res, 200, { ...view(id), busy: false })
    } catch (error) { if (error?.code === 'SITE_POLICY') return reply(res, 403, { error: error.message }); return reply(res, 400, { error: '処理できませんでした。入力・接続情報・WordPressの権限を確認してください。詳細な認証情報は表示しません。保存を試みた場合は履歴を再読み込みしてください。' }) }
    finally { if (ownsBusy) busy = false }
  }
  return { handler, close: () => { closed = true; connections.clear() } }
}
module.exports = { createWordPressApi, markup, snapshot }
