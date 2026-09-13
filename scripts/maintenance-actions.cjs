'use strict'
const { defaultRequest, vettedAddresses } = require('./seo-crawler.cjs')
const { createMaintenanceProbe } = require('./maintenance-probe.cjs')
const SITE = 'https://school-jk-style.com/'
const PAIRS = [
  { key: 'contact', label: 'お問い合わせ', before: '/お問い合わせ/', after: '/contact/' },
  { key: 'privacy', label: 'プライバシーポリシー', before: '/プライバシーポリシー/', after: '/privacy-policy/' },
]
function matchingLinks(html) {
  // Static anchor inspection only. Discard all prose and all non-target URLs.
  const source = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const counts = Object.fromEntries(PAIRS.flatMap(p => [[p.before, 0], [p.after, 0]]))
  for (const match of source.matchAll(/<a\b[^>]*\s+href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    try {
      const url = new URL(match[1] ?? match[2] ?? match[3], SITE)
      const path = decodeURIComponent(url.pathname)
      if (url.origin === new URL(SITE).origin && Object.hasOwn(counts, path)) counts[path]++
    } catch {}
  }
  return counts
}
function createMaintenanceActions({ request = defaultRequest, resolve = vettedAddresses, probe = createMaintenanceProbe() } = {}) {
  return async site => {
    if (site !== SITE) throw new Error('Unsupported maintenance site')
    const controller = new AbortController(), deadline = Date.now() + 10000
    const timer = setTimeout(() => controller.abort(), 10000)
    let source = { status: null, inspected: false }, counts = null
    try {
      const rows = await resolve(new URL(SITE).hostname, undefined, { deadline, signal: controller.signal })
      const result = await request(new URL(SITE), { timeoutMs: 5000, deadline, maxBytes: 512 * 1024, signal: controller.signal,
        lookup: (_host, opts, cb) => opts?.all ? cb(null, [rows[0]]) : cb(null, rows[0].address, rows[0].family),
      })
      const mime = String(result.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase()
      const valid = result.status === 200 && ['text/html', 'application/xhtml+xml'].includes(mime) && Buffer.isBuffer(result.body) && result.body.length <= 512 * 1024
      source = { status: result.status, inspected: valid }
      if (valid) counts = matchingLinks(result.body.toString('utf8'))
    } catch { /* No upstream text or body escapes this boundary. */ }
    finally { clearTimeout(timer) }
    const items = await Promise.all(PAIRS.map(async pair => {
      const check = async path => { try { const result = await probe(new URL(path, SITE).href, SITE); return { status: result.status, checkedAt: result.checkedAt } } catch { return { status: null } } }
      const [beforeCheck, afterCheck] = await Promise.all([check(pair.before), check(pair.after)])
      const oldLinks = counts?.[pair.before] ?? null, newLinks = counts?.[pair.after] ?? null
      const state = !source.inspected ? 'source-unknown' : afterCheck.status !== 200 ? 'target-unconfirmed' : oldLinks > 0 ? ([404, 410].includes(beforeCheck.status) ? 'change-needed' : 'legacy-link') : newLinks > 0 ? 'replacement-observed' : 'link-not-found'
      return { ...pair, beforeCheck, afterCheck, oldLinks, newLinks, state }
    }))
    return { checkedAt: new Date().toISOString(), source: { ...source, url: SITE }, items, mode: 'read-only', writerSupported: false }
  }
}
module.exports = { createMaintenanceActions, matchingLinks }
