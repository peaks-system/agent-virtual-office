'use strict'
const https = require('node:https')
const tls = require('node:tls')
const { vettedAddresses } = require('./seo-crawler.cjs')
const { isMaintenanceSite, resourceKind } = require('./maintenance-scope.cjs')
function createMaintenanceProbe({ request = https.request, resolve = vettedAddresses } = {}) {
  return async (value, site) => {
    const url = new URL(value), base = new URL(site)
    if (!isMaintenanceSite(base.href) || url.origin !== base.origin || url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Invalid maintenance URL')
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000)
    try {
      const rows = await resolve(url.hostname, undefined, { signal: controller.signal, deadline: Date.now() + 10000 })
      if (controller.signal.aborted || !rows.length) throw new Error('Probe unavailable')
      return await new Promise((accept, reject) => {
        const req = request(url, { method: 'HEAD', agent: false, signal: controller.signal, rejectUnauthorized: true, maxHeaderSize: 16384,
          ca: [...tls.getCACertificates('default'), ...tls.getCACertificates('system')],
          lookup: (_host, options, cb) => options?.all ? cb(null, [rows[0]]) : cb(null, rows[0].address, rows[0].family),
          headers: { Accept: '*/*', 'User-Agent': 'AI-Office-Maintenance/1.0' },
        }, res => {
          const contentType = String(res.headers['content-type'] || '').split(';')[0].toLowerCase()
          // Return only bounded protocol facts. No body, cookies, location or arbitrary headers.
          const result = { status: res.statusCode, type: resourceKind(url.href, /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(contentType) ? contentType : ''), checkedAt: new Date().toISOString(), method: 'HEAD' }
          res.destroy(); accept(result)
        })
        req.on('error', () => reject(new Error('Probe unavailable')))
        req.end()
      })
    } finally { clearTimeout(timer) }
  }
}
module.exports = { createMaintenanceProbe }
