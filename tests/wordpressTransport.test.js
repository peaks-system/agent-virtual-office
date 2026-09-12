import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createWordPressTransport } = require('../scripts/wordpress-transport.cjs')
const { vettedAddresses } = require('../scripts/seo-crawler.cjs')
const fake = { username: 'test-only', password: 'synthetic' }
describe('WordPress fixed transport', () => {
  it('pins public DNS, verifies TLS and rejects redirects without following them', async () => {
    const seen = []
    const call = createWordPressTransport({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: (url, options, cb) => {
      seen.push({ url, options })
      const req = new EventEmitter(); req.end = () => { const res = new EventEmitter(); res.statusCode = 302; res.destroy = () => {}; cb(res) }; return req
    } })
    await expect(call('GET', 9, null, fake)).rejects.toThrow('WP_RESPONSE')
    expect(seen).toHaveLength(1)
    expect(seen[0].url).toBe('https://school-jk-style.com/wp-json/wp/v2/pages/9?context=edit&_fields=id,title,content,status,modified_gmt')
    expect(seen[0].options.rejectUnauthorized).toBe(true)
    expect(seen[0].options.agent).toBe(false)
    seen[0].options.lookup('school-jk-style.com', { all: true }, (_error, rows) => expect(rows[0].address).toBe('93.184.216.34'))
  })
  it('rejects private DNS before any request', async () => {
    let requests = 0
    const call = createWordPressTransport({ resolve: host => vettedAddresses(host, async () => [{ address: '127.0.0.1', family: 4 }]), request: () => { requests++ } })
    await expect(call('GET', 1, null, fake)).rejects.toThrow()
    expect(requests).toBe(0)
  })
  it('rejects publish, update, delete and non-whitelisted fields', async () => {
    const call = createWordPressTransport({ request: () => { throw new Error('unexpected network') } })
    for (const args of [['DELETE', 1, null], ['POST', 1, { status: 'draft' }], ['POST', null, { status: 'publish' }], ['POST', null, { status: 'draft', meta: {} }], ['GET', 'https://other.test/', null]]) {
      await expect(call(...args, fake)).rejects.toThrow('WP_REQUEST')
    }
  })
})
