'use strict'
const https = require('node:https')
const tls = require('node:tls')
const { Readable } = require('node:stream')

// Use the OS trust store for Google requests, without changing process-wide TLS.
function createGoogleFetch({ request = https.request, certificates = tls } = {}) {
  return (url, options = {}) => new Promise((resolve, reject) => {
    let req
    try {
      const ca = typeof certificates.getCACertificates === 'function'
        ? [...certificates.getCACertificates('default'), ...certificates.getCACertificates('system')]
        : undefined
      req = request(url, { method: options.method || 'GET', headers: options.headers,
        signal: options.signal, ca, rejectUnauthorized: true }, response => {
        try {
          // Native https does not follow redirects. The caller rejects non-2xx responses.
          const status = response.statusCode || 500
          resolve(new Response([204, 205, 304].includes(status) ? null : Readable.toWeb(response), { status, headers: response.headers }))
        } catch (error) { response.destroy(); reject(error) }
      })
      req.once('error', reject)
      if (options.body !== undefined) req.write(String(options.body))
      req.end()
    } catch (error) { req?.destroy(); reject(error) }
  })
}
module.exports = { createGoogleFetch }
