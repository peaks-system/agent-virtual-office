import { it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createMaintenanceProbe } = require('../scripts/maintenance-probe.cjs')
it('restricts host and protocol, sends HEAD with no credentials and does not follow redirects', async () => {
  const seen = []
  const probe = createMaintenanceProbe({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: (url, options, callback) => {
    seen.push(options)
    const req = new EventEmitter(); req.end = () => { const res = new EventEmitter(); res.statusCode = 302; res.headers = { 'content-type': 'text/html', location: 'https://other.test/', 'set-cookie': 'must-not-return' }; res.destroy = () => {}; callback(res) }; return req
  } })
  const site = 'https://school-jk-style.com/'
  for (const url of ['https://other.test/', 'http://school-jk-style.com/', 'https://name:pass@school-jk-style.com/', 'https://school-jk-style.com:123/']) await expect(probe(url, site)).rejects.toThrow()
  expect(seen).toHaveLength(0)
  const result = await probe(site, site)
  expect(seen).toHaveLength(1); expect(seen[0].method).toBe('HEAD'); expect(seen[0].headers.Authorization).toBeUndefined()
  expect(seen[0].rejectUnauthorized).toBe(true)
  expect(result).toMatchObject({ status: 302, method: 'HEAD', type: 'html' }); expect(JSON.stringify(result)).not.toContain('must-not-return')
})
