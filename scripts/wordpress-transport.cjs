'use strict'
const https = require('node:https')
const tls = require('node:tls')
const { normalizeSiteUrl, vettedAddresses } = require('./seo-crawler.cjs')
const SITE = 'https://school-jk-style.com'
const FIELDS = '?context=edit&_fields=id,title,content,status,modified_gmt'

function createWordPressTransport({ request = https.request, resolve = vettedAddresses } = {}) {
  return async function call(method, pageId, payload, credentials, target = { site: SITE, kind: 'pages' }) {
    const origin = new URL(normalizeSiteUrl(target.site))
    if (origin.protocol !== 'https:' || origin.origin !== target.site || !['pages', 'posts'].includes(target.kind)) throw new Error('WP_TARGET')
    if (!credentials || !['GET', 'POST'].includes(method)
      || (method === 'GET' && (!Number.isSafeInteger(pageId) || pageId < 1))
      || (method === 'POST' && (pageId !== null || payload?.status !== 'draft'
        || Object.keys(payload).sort().join(',') !== 'comment_status,content,ping_status,slug,status,title'))) throw new Error('WP_REQUEST')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10000)
    try {
      const addresses = await resolve(origin.hostname, undefined, { signal: controller.signal, deadline: Date.now() + 10000 })
      if (controller.signal.aborted || !addresses.length) throw new Error('WP_NETWORK')
      const address = addresses[0]
      return await new Promise((accept, reject) => {
        const req = request(`${origin.origin}/wp-json/wp/v2/${target.kind}${method === 'GET' ? '/' + pageId : ''}${FIELDS}`, {
          method, agent: false, signal: controller.signal, rejectUnauthorized: true,
          ca: [...tls.getCACertificates('default'), ...tls.getCACertificates('system')],
          lookup: (_host, options, cb) => options?.all ? cb(null, [address]) : cb(null, address.address, address.family),
          headers: { Authorization: `Basic ${Buffer.from(credentials.username + ':' + credentials.password).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        }, res => {
          // Never follow redirects or return upstream errors/headers to the browser.
          if (res.statusCode !== (method === 'POST' ? 201 : 200)) { res.destroy(); reject(new Error('WP_RESPONSE')); return }
          let size = 0; const chunks = []
          res.on('data', chunk => { size += chunk.length; if (size > 262144) { res.destroy(); reject(new Error('WP_SIZE')) } else chunks.push(chunk) })
          res.on('error', () => reject(new Error('WP_NETWORK')))
          res.on('end', () => { try { accept(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { reject(new Error('WP_RESPONSE')) } })
        })
        req.on('error', () => reject(new Error('WP_NETWORK')))
        req.end(method === 'POST' ? JSON.stringify(payload) : undefined)
      })
    } finally { clearTimeout(timer) }
  }
}
module.exports = { createWordPressTransport, SITE }
