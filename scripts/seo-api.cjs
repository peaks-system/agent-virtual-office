'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { permitted } = require('./staff-api.cjs')
const { auditSite, normalizeSiteUrl } = require('./seo-crawler.cjs')
const { createSearchConsole } = require('./search-console.cjs')
const { createSeoStaffRuntime } = require('./seo-staff-runtime.cjs')
const { resolveExecution } = require('./staff-model-policy.cjs')
const { redactDiagnostics } = require('./seo-redaction.cjs')
const { createSitePolicy } = require('./site-policy.cjs')
const { propertyChoice, readable } = require('./search-console-property.cjs')
const { isMaintenanceSite } = require('./maintenance-scope.cjs')
const { createMaintenanceProbe } = require('./maintenance-probe.cjs')
const { createMaintenanceActions } = require('./maintenance-actions.cjs')

function createSeoApi({ root, authorize = () => true, crawler = auditSite, google, staff, probe = createMaintenanceProbe(), maintenanceActions = createMaintenanceActions() } = {}) {
  const policies = createSitePolicy(root)
  const directory = path.join(root, '.office-work', 'seo')
  const jobs = new Map()
  let active = false, closed = false, crawlController = null
  const gsc = () => google ||= createSearchConsole()
  const ai = () => staff ||= createSeoStaffRuntime({ root })
  const ensure = () => {
    for (const folder of [path.join(root, '.office-work'), directory]) {
      if (!fs.existsSync(folder)) fs.mkdirSync(folder)
      if (fs.lstatSync(folder).isSymbolicLink() || !fs.statSync(folder).isDirectory()) throw new Error('作業フォルダーを安全に開けません。')
    }
  }
  const file = id => path.join(directory, `${id}.json`)
  const read = id => {
    ensure()
    if (!fs.existsSync(file(id))) return { siteUrl: '', public: null, google: null, proposal: null }
    if (fs.lstatSync(file(id)).isSymbolicLink() || fs.statSync(file(id)).size > 2000000) throw new Error('保存済みの診断を読み込めません。')
    return JSON.parse(fs.readFileSync(file(id), 'utf8'))
  }
  const save = (id, value) => {
    ensure()
    if (fs.existsSync(file(id)) && fs.lstatSync(file(id)).isSymbolicLink()) throw new Error('保存先が正しくありません。')
    if (!fs.existsSync(file(id)) && fs.readdirSync(directory).filter(name => name.endsWith('.json')).length >= 100) throw new Error('保存可能なプロジェクト数の上限です。')
    const raw = JSON.stringify(redactDiagnostics(value))
    if (Buffer.byteLength(raw) > 2000000) throw new Error('診断結果が保存上限を超えました。')
    const temp = path.join(directory, `${id}.${randomUUID()}.tmp`)
    fs.writeFileSync(temp, raw, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    fs.renameSync(temp, file(id))
  }
  const reply = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(redactDiagnostics(value)))
  }
  async function handler(req, res) {
    if (!permitted(req) || !authorize(req)) return reply(res, 403, { error: 'このPCのオフィス画面から操作してください。' })
    if (closed) return reply(res, 503, { error: 'オフィスを終了しています。' })
    try {
      const pathname = new URL(req.url, 'http://local').pathname.replace(/^\/api\/seo(?=\/|$)/, '')
      const match = pathname.match(/^\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?:\/(site|audits|google|proposals|checks|maintenance-actions|settings|properties|property))?$/)
      const id = match?.[1], action = match?.[2]
      if (req.method === 'GET') {
        if (pathname === '/google/authorize') {
          // Only a deliberate click from this Office may start/reopen the redirect.
          // Never return the OAuth URL as JSON or render credential material in HTML.
          if (req.headers['sec-fetch-site'] !== 'same-origin' || req.headers['sec-fetch-mode'] !== 'navigate' || req.headers['sec-fetch-dest'] !== 'document' || req.headers['sec-fetch-user'] !== '?1') return reply(res, 403, { error: 'Officeの「Search Consoleに接続」ボタンから開いてください。' })
          await gsc().connect({ launchBrowser: false })
          const target = gsc().authorizationRedirect()
          if (!target) { res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('承認画面を準備できませんでした。Officeへ戻り、認証設定を確認してください。承認処理中の場合は完了をお待ちください。') }
          res.writeHead(302, { Location: target, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return res.end()
        }
        if (pathname === '/google/status') return reply(res, 200, await gsc().status())
        if (pathname === '/google/sites') return reply(res, 200, await gsc().sites())
        if (id && action === 'properties') {
          const profile = policies.read(id), status = await gsc().status()
          if (!status.connected) return reply(res, 200, { sites: [], reason: 'not-connected', siteUrl: profile.siteUrl })
          const result = await gsc().sites()
          return reply(res, 200, { ...result, siteUrl: profile.siteUrl, sites: (result.sites || []).map(item => propertyChoice(item, profile.siteUrl + '/')).sort((a,b) => Number(b.selectable) - Number(a.selectable)) })
        }
        if (id && !action) {
          const value = read(id)
          const run = value.proposal?.id && staff?.getRun(value.proposal.id)
          if (run) {
            const changed = value.proposal.status !== run.status || value.proposal.steps?.length !== run.steps?.length
            value.proposal = run
            if (changed && !['queued', 'running'].includes(run.status)) save(id, value)
          } else if (value.proposal && ['queued', 'running'].includes(value.proposal.status)) {
            value.proposal = { ...value.proposal, status: 'cancelled', error: '再起動で実行は終了しました。必要に応じてもう一度依頼してください。' }
          }
          return reply(res, 200, { ...value, settings: policies.read(id), audit: jobs.get(id) || null })
        }
        return reply(res, 404, { error: '操作が見つかりません。' })
      }
      if (req.method !== 'POST') return reply(res, 405, { error: 'この操作は対応していません。' })
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return reply(res, 415, { error: 'JSON形式で送信してください。' })
      let size = 0
      const chunks = []
      req.setTimeout?.(10000, () => req.destroy())
      for await (const chunk of req) {
        size += chunk.length
        if (size > 32768) return reply(res, 413, { error: '入力が大きすぎます。' })
        chunks.push(Buffer.from(chunk))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(res, 400, { error: '入力形式を確認してください。' })
      if (pathname === '/google/configuration') { await gsc().configure(body.client); return reply(res, 200, await gsc().status()) }
      if (pathname === '/google/connection') { await gsc().connect(); return reply(res, 202, await gsc().status()) }
      if (pathname === '/google/cancel-authorization') return reply(res, 200, await gsc().cancelAuthorization())
      if (pathname === '/google/disconnection') { await gsc().disconnect(); return reply(res, 200, await gsc().status()) }
      if (!id || !action) return reply(res, 404, { error: '操作が見つかりません。' })
      const value = read(id)
      if (action === 'property') {
        if (body.manual !== true) {
          const result = await gsc().sites()
          if (result.unknowns?.length) return reply(res, 409, { error: 'Googleの一覧を再確認できません。再取得するか、詳細設定の手入力を利用してください。' })
          if (!(result.sites || []).some(item => item.siteUrl === body.property && readable(item.permissionLevel))) return reply(res, 403, { error: 'このアカウントの閲覧権限を確認できません。アカウント・サイト登録・権限を確認して一覧を再取得してください。' })
        }
        return reply(res, 200, policies.setProperty(id, body.property, body.expectedProperty))
      }
      if (value.proposal?.id && ['queued', 'running'].includes(staff?.getRun(value.proposal.id)?.status)) return reply(res, 409, { error: 'AIによる検討の終了までお待ちください。' })
      if (action === 'settings') {
        if (active) return reply(res, 409, { error: '診断の終了をお待ちください。' })
        const profile = policies.update(id, body)
        save(id, { ...value, siteUrl: profile.siteUrl + '/' })
        return reply(res, 200, profile)
      }
      if (action === 'site') {
        if (active || (value.proposal?.id && ['queued', 'running'].includes(staff?.getRun(value.proposal.id)?.status))) return reply(res, 409, { error: '診断・AI実行の終了後にURLを変更してください。' })
        let siteUrl
        try { siteUrl = normalizeSiteUrl(body.siteUrl) } catch { return reply(res, 400, { error: '公開サイトのHTTP(S) URLを指定してください。内部アドレス・認証情報・特殊なポートは利用できません。' }) }
        if (value.siteUrl && new URL(siteUrl).origin !== new URL(value.siteUrl).origin) return reply(res, 409, { error: '別サイトは新しいプロジェクトに登録してください。' })
        if (siteUrl !== value.siteUrl) save(id, { siteUrl, public: null, google: null, proposal: null })
        return reply(res, 200, read(id))
      }
      if (!value.siteUrl) return reply(res, 400, { error: '先に公開サイトURLを保存してください。' })
      const profile = policies.requirePermission(id, 'diagnosis')
      if (action === 'maintenance-actions') {
        if (active) return reply(res, 409, { error: '確認の終了までお待ちください。' })
        active = true
        try {
          const result = await maintenanceActions(value.siteUrl)
          if (closed) return reply(res, 503, { error: '終了したため結果を保存しませんでした。もう一度確認してください。' })
          const history = [...(value.maintenanceActionHistory || []), result].slice(-10)
          save(id, { ...value, maintenanceAction: result, maintenanceActionHistory: history })
          return reply(res, 200, result)
        } finally { active = false }
      }
      if (action === 'audits') {
        if (active) return reply(res, 409, { error: '別の診断が実行中です。終了までお待ちください。' })
        active = true
        crawlController = new AbortController()
        jobs.clear()
        jobs.set(id, { status: 'running', startedAt: Date.now() })
        Promise.resolve().then(() => crawler(value.siteUrl, { signal: crawlController.signal })).then(report => {
          if (!closed) { save(id, { ...read(id), public: report, proposal: null, maintenanceChecks: {} }); jobs.set(id, { status: 'complete' }) }
        }).catch(() => { jobs.set(id, { status: 'error', error: '公開サイトの診断を完了できませんでした。公開URL・接続状況・安全制限を確認してください。' }) })
          .finally(() => { active = false; crawlController = null })
        return reply(res, 202, { status: 'running' })
      }
      if (action === 'google') {
        if (active) return reply(res, 409, { error: '診断の終了までお待ちください。' })
        if (typeof body.property !== 'string' || body.property.length > 2048) return reply(res, 400, { error: 'Search Consoleのサイトを選んでください。' })
        active = true
        try {
          const report = await gsc().diagnose({ siteUrl: value.siteUrl, property: body.property })
          save(id, { ...value, google: report, proposal: null })
          return reply(res, 200, report)
        } finally { active = false }
      }
      if (!value.public) return reply(res, 400, { error: 'まず公開サイトを診断してください。' })
      if (action === 'checks') {
        if (active || !Number.isInteger(body.pageIndex) || body.pageIndex < 0 || body.pageIndex >= Math.min(value.public.pages?.length || 0, 10)
          || body.generatedAt !== value.public.generatedAt) return reply(res, 409, { error: '再確認する診断記録を読み直してください。' })
        active = true
        try {
          const checked = await probe(value.public.pages[body.pageIndex].url, value.siteUrl)
          const checks = { ...(value.maintenanceChecks || {}), [body.pageIndex]: checked }
          save(id, { ...value, maintenanceChecks: checks })
          return reply(res, 200, checked)
        } finally { active = false }
      }
      const publicEvidence = profile.category === 'restricted' ? { ...value.public, pages: (value.public.pages || []).map((page, index) => ({ ...page, headCheck: value.maintenanceChecks?.[index] || null })) } : value.public
      const evidence = { siteUrl: value.siteUrl, generatedAt: value.public.generatedAt, public: publicEvidence, google: value.google, maintenanceAction: value.maintenanceAction }
      policies.requirePermission(id, 'ai')
      const selection = body.execution || { model: profile.model, reasoningEffort: profile.reasoningEffort }
      if (selection.model === 'gpt-6-astra' && (typeof body.astraReason !== 'string' || body.astraReason.trim().length < 5)) return reply(res, 400, { error: 'Astraが必要な理由を入力し、今回の使用を承認してください。' })
      const run = ai().start({ projectId: id, evidence, maintenance: profile.category === 'restricted', execution: resolveExecution(selection) })
      save(id, { ...value, proposal: run })
      return reply(res, 202, run)
    } catch (error) {
      if (!res.headersSent && error?.code === 'SITE_POLICY') return reply(res, 403, { error: error.message })
      // Never include arbitrary upstream exceptions, OAuth responses or request data.
      if (!res.headersSent && error?.code === 'SEO_BROWSER_OPEN') return reply(res, 409, { error: 'Google承認画面をブラウザーで開けませんでした。Windowsの既定のブラウザーを確認してから、もう一度接続してください。' })
      if (!res.headersSent && error?.code === 'SEO_CLIENT_FORMAT') return reply(res, 400, { error: '認証用JSONの形式が合いません。Google Cloudで作成した「デスクトップアプリ」のJSONを選んでください。ファイルの中身を貼り付ける必要はありません。' })
      if (!res.headersSent && error?.code === 'SEO_CLIENT_STORAGE') return reply(res, 409, { error: 'JSONの形式は確認できましたが、Windowsの暗号化保存に失敗しました。このメッセージをチャットでお知らせください。' })
      if (!res.headersSent) reply(res, error instanceof SyntaxError ? 400 : 409, { error: '処理を完了できませんでした。URL・接続設定・実行中の処理を確認してください。認証情報は表示しません。' })
    }
  }
  return { handler, async close() { closed = true; crawlController?.abort(); await Promise.allSettled([google?.close(), staff?.close()]) } }
}
module.exports = { createSeoApi }
