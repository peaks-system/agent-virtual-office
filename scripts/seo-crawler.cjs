const http = require('node:http')
const https = require('node:https')
const dns = require('node:dns').promises
const net = require('node:net')
const tls = require('node:tls')
const { redactDiagnostics, SENSITIVE_QUERY } = require('./seo-redaction.cjs')

const DEFAULT_LIMITS = Object.freeze({ pages: 10, requests: 30, durationMs: 30_000, requestMs: 5_000, responseBytes: 512 * 1024, totalBytes: 3 * 1024 * 1024 })
const sensitiveQuery = SENSITIVE_QUERY

function normalizeSiteUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('サイトURLは HTTP(S) の完全なURLで指定してください。') }
  if (typeof value !== 'string' || value.length > 2048 || url.href.length > 2048) throw new Error('サイトURLは2,048文字以内で指定してください。')
  if (!['http:', 'https:'].includes(url.protocol) || (url.port && url.port !== (url.protocol === 'http:' ? '80' : '443'))) throw new Error('HTTP(S) の標準ポートだけを利用できます。')
  if (url.username || url.password || [...url.searchParams.keys()].some(key => sensitiveQuery.test(key))) throw new Error('認証情報または認証情報らしいクエリを含むURLは利用できません。')
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || (net.isIP(host) && blockedAddress(host))) throw new Error('ローカルまたは公開されていないホストは利用できません。')
  url.hash = ''
  return url.href
}

function blockedAddress(address) {
  const family = net.isIP(address)
  if (family === 4) {
    const p = address.split('.').map(Number)
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && (p[1] === 0 || p[1] === 168)) || (p[0] === 198 && (p[1] === 18 || p[1] === 19)) || (p[0] === 198 && p[1] === 51 && p[2] === 100) || (p[0] === 203 && p[1] === 0 && p[2] === 113)
  }
  if (family === 6) {
    const v = address.toLowerCase()
    // Only ordinary global-unicast space is useful to this crawler.  This also rejects
    // IPv4-compatible/mapped forms, site-local, documentation, Teredo and 6to4 forms.
    return !/^[23][0-9a-f]{0,3}:/i.test(v) || v.startsWith('2001:') || v.startsWith('2002:')
  }
  return true
}

function raceDeadline(promise, deadline, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('クロールは中止されました。'))
    const remaining = deadline - Date.now()
    if (remaining <= 0) return reject(new Error('クロール時間の上限を超えました。'))
    const timer = setTimeout(() => reject(new Error('クロール時間の上限を超えました。')), remaining)
    const abort = () => reject(new Error('クロールは中止されました。'))
    signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort) })
  })
}

async function vettedAddresses(hostname, lookup = dns.lookup, { deadline = Date.now() + DEFAULT_LIMITS.requestMs, signal } = {}) {
  if (net.isIP(hostname)) { if (blockedAddress(hostname)) throw new Error('公開されていないIPアドレスには接続できません。'); return [{ address: hostname, family: net.isIP(hostname) }] }
  const rows = await raceDeadline(lookup(hostname, { all: true, verbatim: true }), deadline, signal)
  if (!Array.isArray(rows) || !rows.length || rows.some(row => blockedAddress(row.address))) throw new Error('名前解決結果に公開されていないアドレスが含まれています。')
  return rows
}

function limitedOptions(options = {}) {
  const limits = { ...DEFAULT_LIMITS }
  for (const key of Object.keys(limits)) if (Number.isFinite(options.limits?.[key]) && options.limits[key] > 0) limits[key] = Math.min(limits[key], Math.floor(options.limits[key]))
  return limits
}

function responseBody(response, maxBytes, onBytes) {
  return new Promise((resolve, reject) => {
    const type = response.headers['content-encoding']
    if (type && !/^identity$/i.test(type)) { response.destroy(); reject(new Error('圧縮された応答は取得しません。')); return }
    const length = Number(response.headers['content-length'])
    if (Number.isFinite(length) && length > maxBytes) { response.destroy(); reject(new Error('応答サイズの上限を超えています。')); return }
    let size = 0; const chunks = []
    response.on('data', chunk => { size += chunk.length; const permitted = onBytes?.(chunk.length) !== false; if (!permitted) response.destroy(new Error('総取得量の上限を超えました。')); else if (size > maxBytes) response.destroy(new Error('応答サイズの上限を超えています。')); else chunks.push(chunk) })
    response.on('end', () => resolve(Buffer.concat(chunks)))
    response.on('error', reject)
  })
}

function defaultRequest(url, { timeoutMs, maxBytes, lookup, signal, deadline, onBytes }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('クロールは中止されました。'))
    const transport = url.protocol === 'https:' ? https : http
    let req
    const timer = setTimeout(() => req?.destroy(new Error('クロール時間の上限を超えました。')), Math.max(1, deadline - Date.now()))
    const ca = url.protocol === 'https:' && typeof tls.getCACertificates === 'function' ? [...tls.getCACertificates('default'), ...tls.getCACertificates('system')] : undefined
    req = transport.request(url, { method: 'GET', ca, headers: { 'User-Agent': 'AVO-SEO-Diagnostic/1.0', Accept: 'text/html,application/xml,text/plain;q=0.8,*/*;q=0.1', 'Accept-Encoding': 'identity' }, lookup, timeout: timeoutMs }, async response => {
      try { resolve({ status: response.statusCode || 0, headers: response.headers, body: await responseBody(response, maxBytes, onBytes), accounted: true }) } catch (error) { reject(error) }
    })
    const abort = () => req.destroy(new Error('クロールは中止されました。'))
    signal?.addEventListener('abort', abort, { once: true })
    req.once('timeout', () => req.destroy(new Error('リクエスト時間の上限を超えています。')))
    req.once('close', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) })
    req.once('error', reject); req.end()
  })
}

function attr(tag, name) { return new RegExp(`\\b${name}\\s*=\\s*(?:[\"']([^\"']*)[\"']|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find(v => v != null)?.trim() || null }
function text(value) { return value.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/ig, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() }
function pageSignals(html, url) {
  const title = text(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '')
  const metas = [...html.matchAll(/<meta\b[^>]*>/ig)].map(m => m[0]); const description = metas.find(tag => /^description$/i.test(attr(tag, 'name') || '')) || ''
  const robotsTag = metas.filter(tag => /^(robots|googlebot)$/i.test(attr(tag, 'name') || '')).map(tag => attr(tag, 'content') || '').join(',')
  const canonicalTag = [...html.matchAll(/<link\b[^>]*>/ig)].map(m => m[0]).find(tag => /(?:^|\s)canonical(?:\s|$)/i.test(attr(tag, 'rel') || '')) || ''
  const headings = {}; for (let n = 1; n <= 6; n++) headings[`h${n}`] = [...html.matchAll(new RegExp(`<h${n}\\b[^>]*>([\\s\\S]*?)<\\/h${n}>`, 'ig'))].map(m => text(m[1])).filter(Boolean).slice(0, 20)
  const links = [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:["']([^"']*)["']|([^\s>]+))[^>]*>/ig)].map(m => { try { return new URL(m[1] || m[2], url).href } catch { return null } }).filter(Boolean)
  return { title, description: attr(description, 'content') || '', canonical: attr(canonicalTag, 'href'), noindex: /\b(?:noindex|none)\b/i.test(robotsTag), headings, links, scriptCount: (html.match(/<script\b/ig) || []).length, textLength: text(html).length }
}

function robotsAllows(robots, pathname, known = true) {
  if (!known) return false
  const lines = robots.split(/\r?\n/); let active = false; let sawRule = true; const rules = []
  for (const line of lines) { const [key, raw = ''] = line.replace(/#.*/, '').split(':', 2); if (!key) continue; const value = raw.trim(); if (/^user-agent$/i.test(key)) { active = sawRule ? value === '*' : active || value === '*'; sawRule = false } else if (/^(allow|disallow)$/i.test(key)) { sawRule = true; if (active && value) { if (/[*$]/.test(value)) return false; rules.push({ allow: /^allow$/i.test(key), value }) } } }
  const applicable = rules.filter(rule => pathname.startsWith(rule.value)).sort((a, b) => b.value.length - a.value.length || Number(b.allow) - Number(a.allow))
  return !applicable.length || applicable[0].allow
}

async function auditSite(siteUrl, options = {}) {
  const normalized = normalizeSiteUrl(siteUrl); const origin = new URL(normalized); const limits = limitedOptions(options); const started = Date.now(); const deadline = started + limits.durationMs
  const lookup = options.lookup || dns.lookup; const request = options.request || defaultRequest; const facts = []; const hypotheses = []; const unknowns = ['公開クロールの範囲では、Google の登録状況・順位・検索結果への表示は確認できません。']
  const pages = []; const usage = { pages: 0, requests: 0, bytes: 0 }; let robots = '', robotsKnown = false
  const fetchSafe = async input => {
    let current = new URL(input); const redirects = []
    for (let count = 0; count <= 5; count++) {
      if (options.signal?.aborted) throw new Error('クロールは中止されました。')
      if (current.hostname !== origin.hostname) throw new Error('登録したホスト名以外のURLは取得しません。')
      if (Date.now() >= deadline || usage.requests >= limits.requests) throw new Error('クロール上限に達しました。')
      normalizeSiteUrl(current.href); const addresses = await vettedAddresses(current.hostname, lookup, { deadline, signal: options.signal }); usage.requests++
      const pinnedLookup = (hostname, opts, callback) => { if (hostname !== current.hostname) return callback(new Error('接続先ホストが変化しました。')); const selected = opts?.all ? addresses : addresses[0]; callback(null, opts?.all ? selected : selected.address, opts?.all ? undefined : selected.family) }
      const onBytes = count => { usage.bytes += count; return usage.bytes <= limits.totalBytes }
      const result = await raceDeadline(request(current, { timeoutMs: Math.min(limits.requestMs, Math.max(1, deadline - Date.now())), maxBytes: Math.min(limits.responseBytes, limits.totalBytes - usage.bytes), lookup: pinnedLookup, signal: options.signal, deadline, onBytes }), deadline, options.signal)
      if (result.headers?.['content-encoding'] && !/^identity$/i.test(String(result.headers['content-encoding']))) throw new Error('圧縮された応答は取得しません。')
      if (!Buffer.isBuffer(result.body) || result.body.length > limits.responseBytes || (!result.accounted && result.body.length > limits.totalBytes - usage.bytes)) throw new Error('応答サイズの上限を超えています。')
      if (!result.accounted) usage.bytes += result.body.length; if (usage.bytes > limits.totalBytes) throw new Error('総取得量の上限を超えました。')
      if (result.status >= 300 && result.status < 400 && result.headers.location) { const next = new URL(result.headers.location, current); redirects.push({ from: current.href, to: next.href, status: result.status }); current = next; continue }
      return { ...result, url: current.href, redirects }
    }
    throw new Error('リダイレクト回数の上限を超えました。')
  }
  const recordError = (url, error) => unknowns.push({ message: '通信・証明書・取得上限などの理由でURLを確認できませんでした。サイトの不具合とは断定できません。', url })
  try { const r = await fetchSafe(new URL('/robots.txt', origin).href); robotsKnown = r.status === 200 || r.status === 404; robots = r.status === 200 ? r.body.toString('utf8') : ''; facts.push({ message: r.status === 200 ? 'robots.txt を取得しました。' : r.status === 404 ? 'robots.txt は見つかりませんでした。許可規則なしとして扱います。' : 'robots.txt は安全に確認できませんでした。', url: r.url, evidence: `HTTP ${r.status}` }) } catch (error) { recordError(new URL('/robots.txt', origin).href, error) }
  if (!robotsKnown) unknowns.push('robots.txt を安全に確認できなかったため、ページ本文の取得は行いませんでした。')
  const sitemapUrls = [...robots.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map(m => m[1]).slice(0, 3)
  if (!sitemapUrls.length) sitemapUrls.push(new URL('/sitemap.xml', origin).href)
  const queue = [origin.href]; const queued = new Set(queue); const broken = []
  for (const sitemapUrl of robotsKnown ? sitemapUrls : []) {
    if (usage.requests >= limits.requests || Date.now() - started >= limits.durationMs) break
    try {
      const r = await fetchSafe(sitemapUrl); const entries = [...r.body.toString('utf8').matchAll(/<loc\b[^>]*>\s*([^<\s]+)\s*<\/loc>/ig)].map(m => m[1])
      facts.push({ message: r.status === 200 ? 'サイトマップを取得しました。' : 'サイトマップは利用できませんでした。', url: r.url, evidence: `HTTP ${r.status}` })
      for (const entry of entries) { try { const candidate = new URL(entry); if (candidate.hostname === origin.hostname && !queued.has(candidate.href) && queue.length < limits.pages) { queued.add(candidate.href); queue.push(candidate.href) } } catch {} }
    } catch (error) { recordError(sitemapUrl, error) }
  }
  while (queue.length && pages.length < limits.pages && usage.requests < limits.requests && Date.now() - started < limits.durationMs) {
    const url = queue.shift(); const parsed = new URL(url); if (!robotsAllows(robots, parsed.pathname, robotsKnown)) { (robotsKnown ? facts : unknowns).push({ message: robotsKnown ? 'robots.txt に従いURLを取得しませんでした。' : 'robots.txt を確認できないためURLの取得を控えました。', url }); continue }
    try {
      const r = await fetchSafe(url); const headers = r.headers || {}; const contentType = String(headers['content-type'] || ''); const html = contentType.includes('html') ? r.body.toString('utf8') : ''
      const signal = pageSignals(html, r.url); const noindex = signal.noindex || /\bnoindex\b/i.test(String(headers['x-robots-tag'] || ''))
      const page = { url: r.url, status: r.status, contentType: contentType.split(';')[0].slice(0, 100), redirects: r.redirects, title: signal.title, description: signal.description, canonical: signal.canonical, noindex, headings: signal.headings }
      pages.push(page); usage.pages = pages.length
      facts.push({ message: `ページを取得しました（HTTP ${r.status}）。`, url: r.url, evidence: r.redirects.length ? `リダイレクト ${r.redirects.length} 回` : undefined })
      if (noindex) facts.push({ message: 'noindex 指示を検出しました。', url: r.url, evidence: signal.noindex ? 'meta robots' : 'X-Robots-Tag' })
      if (signal.scriptCount && signal.textLength < 200) hypotheses.push({ message: 'JavaScript の実行が必要なページである可能性があります。', url: r.url, evidence: `script=${signal.scriptCount}, 解析テキスト=${signal.textLength}文字` })
      if (signal.textLength < 200) hypotheses.push({ message: '本文量が少ない可能性があります。', url: r.url, evidence: `解析テキスト=${signal.textLength}文字` })
      for (const link of signal.links) { const candidate = new URL(link); if (candidate.hostname === origin.hostname && candidate.protocol === origin.protocol && !queued.has(candidate.href) && queue.length + pages.length < limits.pages) { queued.add(candidate.href); queue.push(candidate.href) } }
      if (r.status === 404 || r.status === 410) broken.push(r.url)
      else if (r.status >= 400) unknowns.push(`HTTP ${r.status} のため、内部URLの到達可否は未確定です: ${r.url}`)
    } catch (error) { unknowns.push(`取得制限または通信失敗のため、内部URLの到達可否は未確定です: ${url}`); recordError(url, error) }
  }
  if (broken.length) facts.push({ message: 'サンプル範囲で到達できない内部URLを検出しました。', url: broken[0], evidence: `${broken.length}件` })
  const titles = new Map(); for (const page of pages) if (page.title) { const list = titles.get(page.title) || []; list.push(page.url); titles.set(page.title, list) }
  for (const [title, urls] of titles) if (urls.length > 1) hypotheses.push({ message: '同じ title のページがあり、重複の可能性があります。', url: urls[0], evidence: `${urls.length}件: ${title}` })
  if (queue.length) unknowns.push(Date.now() >= deadline ? '総時間の上限に達したため、キューに残るURLは未確認です。' : usage.requests >= limits.requests ? 'リクエスト数の上限に達したため、キューに残るURLは未確認です。' : pages.length >= limits.pages ? 'ページ数の上限に達したため、キューに残るURLは未確認です。' : '安全制限により、キューに残るURLは未確認です。')
  unknowns.push('HTML は安全のため限定的な静的解析です。JavaScript 描画後の内容、構造化データ、完全なリンク網羅性は未確認です。')
  return redactDiagnostics({ siteUrl: normalized, generatedAt: new Date().toISOString(), limits, usage, pages, facts, hypotheses, unknowns })
}

module.exports = { auditSite, normalizeSiteUrl, vettedAddresses, blockedAddress, defaultRequest }
