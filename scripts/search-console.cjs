const crypto = require('node:crypto')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { createSeoVault } = require('./seo-vault.cjs')

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const API_BASE = 'https://www.googleapis.com/webmasters/v3'
const INSPECTION_ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect'
const CALLBACK_TTL_MS = 5 * 60 * 1000
const FETCH_TIMEOUT_MS = 15 * 1000
const MAX_RESPONSE_BYTES = 256 * 1024

const safeMessage = (message = 'Google Search Console の要求を完了できませんでした。') => String(message).slice(0, 120)
const b64url = value => Buffer.from(value).toString('base64url')
const random = size => crypto.randomBytes(size).toString('base64url')
const pacificDay = (days, clock) => {
  const date = new Date(clock() - days * 86400000)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}
const numberOrNull = value => Number.isFinite(value) ? value : null

function externalBrowser(url) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  return new Promise((resolve, reject) => {
    let child
    try { child = spawn(command, [url], { detached: true, windowsHide: true, stdio: 'ignore', shell: false }) } catch { reject(new Error('browser')); return }
    child.once('error', () => reject(new Error('browser')))
    child.unref()
    setImmediate(resolve)
  })
}

function parseInstalled(value) {
  let json
  try { json = typeof value === 'string' ? JSON.parse(value) : value } catch { throw new Error('Invalid installed application configuration') }
  const client = json && json.installed
  if (!client || typeof client.client_id !== 'string' || !client.client_id || typeof client.client_secret !== 'string') throw new Error('Invalid installed application configuration')
  if (client.token_uri && client.token_uri !== TOKEN_ENDPOINT) throw new Error('Invalid installed application configuration')
  if (client.auth_uri && client.auth_uri !== AUTH_ENDPOINT) throw new Error('Invalid installed application configuration')
  return { client_id: client.client_id, client_secret: client.client_secret, token_uri: TOKEN_ENDPOINT }
}

function siteCovers(property, siteUrl) {
  let target
  try { target = new URL(siteUrl) } catch { return false }
  if (!/^https?:$/.test(target.protocol)) return false
  if (property.startsWith('sc-domain:')) {
    const domain = property.slice('sc-domain:'.length).toLowerCase()
    return /^[a-z0-9.-]+$/.test(domain) && (target.hostname === domain || target.hostname.endsWith(`.${domain}`))
  }
  try {
    const prefix = new URL(property)
    return /^https?:$/.test(prefix.protocol) && target.href.startsWith(prefix.href)
  } catch { return false }
}

function pickAnalytics(payload) {
  return (Array.isArray(payload.rows) ? payload.rows : []).slice(0, 100).map(row => ({
    query: Array.isArray(row.keys) && typeof row.keys[0] === 'string' ? row.keys[0].slice(0, 2048) : '',
    page: Array.isArray(row.keys) && typeof row.keys[1] === 'string' ? row.keys[1].slice(0, 2048) : '',
    clicks: numberOrNull(row.clicks),
    impressions: numberOrNull(row.impressions),
    ctr: numberOrNull(row.ctr),
    position: numberOrNull(row.position)
  }))
}

function pickSitemaps(payload) {
  return (Array.isArray(payload.sitemap) ? payload.sitemap : []).slice(0, 100).map(item => ({
    path: typeof item.path === 'string' ? item.path.slice(0, 2048) : '',
    lastSubmitted: typeof item.lastSubmitted === 'string' ? item.lastSubmitted : null,
    lastDownloaded: typeof item.lastDownloaded === 'string' ? item.lastDownloaded : null,
    isPending: Boolean(item.isPending),
    warnings: numberOrNull(item.warnings),
    errors: numberOrNull(item.errors)
  }))
}

function pickInspection(payload) {
  const value = payload && payload.inspectionResult && payload.inspectionResult.indexStatusResult
  if (!value || typeof value !== 'object') return null
  const fields = ['verdict', 'coverageState', 'robotsTxtState', 'indexingState', 'lastCrawlTime', 'pageFetchState', 'googleCanonical', 'userCanonical']
  const picked = Object.fromEntries(fields.filter(field => typeof value[field] === 'string').map(field => [field, value[field].slice(0, 2048)]))
  if (Array.isArray(value.sitemap)) picked.sitemap = value.sitemap.filter(item => typeof item === 'string').slice(0, 20).map(item => item.slice(0, 2048))
  return picked
}

function inspectionFacts(inspection, siteUrl) {
  const labels = { verdict: '検査結果', coverageState: 'カバレッジ', robotsTxtState: 'robots.txt', indexingState: 'インデックス状況', lastCrawlTime: '最終クロール', pageFetchState: 'ページ取得', googleCanonical: 'Google が選択した正規 URL', userCanonical: 'ユーザー指定の正規 URL', sitemap: 'サイトマップ' }
  const required = ['verdict', 'coverageState', 'robotsTxtState', 'indexingState', 'lastCrawlTime', 'pageFetchState', 'googleCanonical', 'userCanonical', 'sitemap']
  const facts = [{ message: '検索パフォーマンスは直近 28 日間（太平洋時間）を最大 100 行で取得しました。', url: siteUrl }]
  const unknowns = [{ message: 'Search Console の検索分析は上位行のみで、全データを保証しません。', url: siteUrl }]
  for (const field of required) {
    if (inspection && inspection[field] && (!Array.isArray(inspection[field]) || inspection[field].length)) facts.push({ message: `${labels[field]}: ${Array.isArray(inspection[field]) ? inspection[field].join('、') : inspection[field]}`, url: siteUrl })
    else unknowns.push({ message: `${labels[field]}は Search Console から取得できませんでした。`, url: siteUrl })
  }
  return { facts, unknowns }
}

function createSearchConsole({ vault = createSeoVault(), openBrowser = externalBrowser, fetchImpl = fetch, httpImpl = http, now = () => Date.now() } = {}) {
  let stored = { client: null, tokens: null }
  let loaded = false
  let loadPromise = null
  let storageError = false
  let closed = false
  let pending = null
  let refreshing = null
  let authGeneration = 0
  const load = async () => {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      try {
        const value = await vault.read()
        stored = { client: value.client || null, tokens: value.tokens || null }
      } catch { storageError = true }
      loaded = true
    })()
    return loadPromise
  }
  const state = message => ({ configured: Boolean(stored.client), connected: Boolean(stored.tokens && stored.tokens.refresh_token), pending: Boolean(pending), message: safeMessage(message || (storageError ? '暗号化された認証情報ストレージを利用できません。' : pending ? 'ブラウザーでの認可を待っています。' : stored.tokens ? '接続済みです。' : stored.client ? '接続の準備ができました。' : 'Google Search Console は未設定です。')) })
  const persist = async () => { if (storageError) throw new Error('storage'); await vault.write(stored) }
  const cancelPending = () => {
    if (!pending) return
    const attempt = pending
    pending = null
    clearTimeout(attempt.timer)
    try { attempt.server.close() } catch {}
  }
  const request = async (url, options = {}) => {
    if (!url.startsWith('https://www.googleapis.com/') && url !== INSPECTION_ENDPOINT && url !== TOKEN_ENDPOINT) throw new Error('Request blocked')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal })
      const length = Number(response.headers && response.headers.get && response.headers.get('content-length'))
      if (!response.ok || (Number.isFinite(length) && length > MAX_RESPONSE_BYTES)) throw new Error('Google request failed')
      if (!response.body || typeof response.body.getReader !== 'function') throw new Error('Google request failed')
      const reader = response.body.getReader()
      const chunks = []; let total = 0
      while (true) {
        const part = await reader.read()
        if (part.done) break
        total += part.value.byteLength
        if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('Google request failed') }
        chunks.push(part.value)
      }
      const text = new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))))
      try { return JSON.parse(text) } catch { throw new Error('Google request failed') }
    } finally { clearTimeout(timer) }
  }
  const token = async () => {
    await load()
    if (closed || !stored.client || !stored.tokens) throw new Error('Google Search Console is not connected')
    if (stored.tokens.expires_at > now() + 30000 && stored.tokens.access_token) return stored.tokens.access_token
    if (!refreshing) {
      const generation = authGeneration
      const currentClient = stored.client
      const currentTokens = stored.tokens
      refreshing = (async () => {
      const body = new URLSearchParams({ client_id: currentClient.client_id, client_secret: currentClient.client_secret, refresh_token: currentTokens.refresh_token, grant_type: 'refresh_token' })
      const refreshed = await request(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
      if (closed || generation !== authGeneration || stored.client !== currentClient || stored.tokens !== currentTokens || typeof refreshed.access_token !== 'string' || (refreshed.scope && refreshed.scope.trim() !== SCOPE)) throw new Error('Google authorization must grant only read-only access')
      stored.tokens = { ...currentTokens, access_token: refreshed.access_token, refresh_token: typeof refreshed.refresh_token === 'string' ? refreshed.refresh_token : currentTokens.refresh_token, expires_at: now() + Math.max(60, Math.min(Number(refreshed.expires_in) || 3600, 7200)) * 1000 }
      await persist()
      return stored.tokens.access_token
      })().finally(() => { refreshing = null })
    }
    return refreshing
  }
  const authorized = async (url, options = {}) => request(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${await token()}` } })
  const ownedProperty = async (property, siteUrl) => {
    if (typeof property !== 'string' || property.length > 2048 || !siteCovers(property, siteUrl)) throw new Error('Selected property does not cover this site')
    const list = await authorized(`${API_BASE}/sites`)
    const entries = Array.isArray(list.siteEntry) ? list.siteEntry : []
    if (!entries.some(entry => entry && entry.siteUrl === property)) throw new Error('Selected property is not available to this account')
  }
  return {
    async status() { await load(); return state() },
    async configure(installedClientJson) {
      await load()
      cancelPending()
      authGeneration += 1
      stored = { client: parseInstalled(installedClientJson), tokens: null }
      await persist()
      return state('Google Search Console は設定済みです。')
    },
    async connect() {
      await load()
      if (closed || storageError || !stored.client) return state(closed ? 'Google Search Console は閉じられています。' : undefined)
      if (pending) return state()
      const starting = { starting: true }
      pending = starting
      const verifier = random(48)
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
      const nonce = random(32)
      const server = httpImpl.createServer(async (req, res) => {
        const finish = (code, body) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body) }
        const attempt = pending
        if (!attempt || now() > attempt.expiresAt || req.method !== 'GET') return finish(400, '認可要求の有効期限が切れました。')
        let callback
        try { callback = new URL(req.url, `http://127.0.0.1:${attempt.port}`) } catch { return finish(400, '認可応答が無効です。') }
        if (callback.pathname !== '/oauth2/callback' || callback.searchParams.get('state') !== attempt.state || attempt.used) return finish(400, '認可応答が無効です。')
        attempt.used = true
        const code = callback.searchParams.get('code')
        if (!code || callback.searchParams.get('error')) { if (pending === attempt) cancelPending(); return finish(400, '認可は完了しませんでした。') }
        try {
          const body = new URLSearchParams({ client_id: stored.client.client_id, client_secret: stored.client.client_secret, code, code_verifier: verifier, redirect_uri: `http://127.0.0.1:${attempt.port}/oauth2/callback`, grant_type: 'authorization_code' })
          const response = await request(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
          if (closed || pending !== attempt || typeof response.access_token !== 'string' || typeof response.refresh_token !== 'string' || response.scope !== SCOPE) throw new Error('Unauthorized scope')
          stored.tokens = { access_token: response.access_token, refresh_token: response.refresh_token, expires_at: now() + Math.max(60, Math.min(Number(response.expires_in) || 3600, 7200)) * 1000 }
          await persist(); if (closed || pending !== attempt) throw new Error('cancelled'); cancelPending(); finish(200, '認可が完了しました。このウィンドウは閉じてかまいません。')
        } catch { if (pending === attempt) cancelPending(); finish(400, '認可を完了できませんでした。') }
      })
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) }) } catch { if (pending === starting) pending = null; return state('認可を開始できませんでした。') }
      if (closed || pending !== starting) { server.close(); return state() }
      const address = server.address()
      if (!address || typeof address === 'string') { server.close(); return state('認可を開始できませんでした。') }
      pending = { server, port: address.port, state: nonce, expiresAt: now() + CALLBACK_TTL_MS, used: false }
      pending.timer = setTimeout(() => { if (pending && pending.server === server) { pending = null; server.close() } }, CALLBACK_TTL_MS)
      const auth = new URL(AUTH_ENDPOINT)
      auth.search = new URLSearchParams({ client_id: stored.client.client_id, redirect_uri: `http://127.0.0.1:${address.port}/oauth2/callback`, response_type: 'code', scope: SCOPE, state: nonce, code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }).toString()
      try { await openBrowser(auth.toString()) } catch { cancelPending(); return state('システムブラウザーを開けませんでした。') }
      return state()
    },
    async sites() {
      await load()
      try {
        const data = await authorized(`${API_BASE}/sites`)
        return { sites: (Array.isArray(data.siteEntry) ? data.siteEntry : []).slice(0, 100).filter(item => item && typeof item.siteUrl === 'string').map(item => ({ siteUrl: item.siteUrl, permissionLevel: typeof item.permissionLevel === 'string' ? item.permissionLevel : 'unknown' })) }
      } catch { return { sites: [], unknowns: [{ message: 'Google Search Console のデータを取得できませんでした。' }] } }
    },
    async diagnose({ siteUrl, property } = {}) {
      await load()
      try {
        const target = new URL(siteUrl)
        if (!/^https?:$/.test(target.protocol)) throw new Error('Invalid site URL')
        await ownedProperty(property, target.href)
        const encoded = encodeURIComponent(property)
        const [analytics, sitemaps, inspection] = await Promise.all([
          authorized(`${API_BASE}/sites/${encoded}/searchAnalytics/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startDate: pacificDay(28, now), endDate: pacificDay(1, now), dimensions: ['query', 'page'], rowLimit: 100, type: 'web' }) }),
          authorized(`${API_BASE}/sites/${encoded}/sitemaps`),
          authorized(INSPECTION_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inspectionUrl: target.href, siteUrl: property, languageCode: 'ja-JP' }) })
        ])
        const inspectionResult = pickInspection(inspection)
        const findings = inspectionFacts(inspectionResult, target.href)
        return { property, siteUrl: target.href, generatedAt: new Date(now()).toISOString(), analytics: pickAnalytics(analytics), sitemaps: pickSitemaps(sitemaps), inspection: inspectionResult, facts: findings.facts, unknowns: findings.unknowns }
      } catch { return { property: null, siteUrl: null, generatedAt: new Date(now()).toISOString(), analytics: [], sitemaps: [], inspection: null, facts: [], unknowns: [{ message: 'Google Search Console のデータを取得できませんでした。' }] } }
    },
    async disconnect() { await load(); cancelPending(); authGeneration += 1; stored.tokens = null; if (stored.client) await persist(); return state('Google Search Console の接続を解除しました。') },
    async close() { closed = true; authGeneration += 1; cancelPending() }
  }
}

module.exports = { createSearchConsole, SCOPE }
