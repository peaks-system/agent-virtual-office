import { describe, expect, it, vi } from 'vitest'
import crawler from '../scripts/seo-crawler.cjs'
import redaction from '../scripts/seo-redaction.cjs'

const { auditSite, normalizeSiteUrl, vettedAddresses } = crawler
const { redactDiagnostics } = redaction
const okLookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
const response = (body, status = 200, headers = { 'content-type': 'text/html' }) => ({ status, headers, body: Buffer.from(body) })

describe('seo crawler public transport guard', () => {
  it('rejects credentials, credential-like query values, private IPs, and non-standard ports', async () => {
    expect(() => normalizeSiteUrl('https://user:pass@example.com/')).toThrow(/認証情報/)
    expect(() => normalizeSiteUrl('https://example.com/?api_key=x')).toThrow(/認証情報/)
    expect(() => normalizeSiteUrl('https://example.com/?client_id=x')).toThrow(/認証情報/)
    expect(() => normalizeSiteUrl('http://example.com:8080/')).toThrow(/標準ポート/)
    expect(() => normalizeSiteUrl('http://[::1]/')).toThrow(/ローカル/)
    await expect(vettedAddresses('example.com', async () => [{ address: '127.0.0.1', family: 4 }])).rejects.toThrow(/公開されていない/)
    await expect(vettedAddresses('example.com', async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }])).rejects.toThrow(/公開されていない/)
    await expect(vettedAddresses('example.com', async () => [{ address: '2002:0a00::1', family: 6 }])).rejects.toThrow(/公開されていない/)
  })

  it('pins a vetted lookup and validates each redirect before requesting it', async () => {
    const request = vi.fn(async (url, options) => {
      await new Promise((resolve, reject) => options.lookup(url.hostname, {}, (error, address) => error ? reject(error) : (expect(address).toBe('93.184.216.34'), resolve())))
      return url.pathname === '/' ? response('', 302, { location: 'http://127.0.0.1/', 'content-type': 'text/html' }) : response('')
    })
    const out = await auditSite('https://example.com/', { lookup: okLookup, request, limits: { pages: 1, requests: 4 } })
    expect(request).toHaveBeenCalled()
    expect(out.unknowns.some(f => /確認できません/.test(f.message))).toBe(true)
    expect(request.mock.calls.some(([url]) => url.hostname === '127.0.0.1')).toBe(false)
  })

  it('returns every vetted address when Node requests lookup with all:true', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }, { address: '93.184.216.35', family: 4 }])
    const request = vi.fn(async (url, options) => {
      await new Promise((resolve, reject) => options.lookup(url.hostname, { all: true }, (error, addresses) => error ? reject(error) : (expect(addresses).toHaveLength(2), resolve())))
      return response(url.pathname === '/' ? '<title>公開</title>' : '', url.pathname === '/robots.txt' ? 404 : 200)
    })
    const out = await auditSite('https://example.com/', { lookup, request, limits: { pages: 1, requests: 5 } })
    expect(request).toHaveBeenCalled()
    expect(out.pages[0]?.title).toBe('公開')
  })
})

describe('seo crawler bounded signals', () => {
  it('reports bounded Japanese facts, hypotheses and index uncertainty', async () => {
    const request = vi.fn(async url => {
      if (url.pathname === '/robots.txt') return response('User-agent: *\nDisallow: /private')
      if (url.pathname === '/') return response('<title>同じ題名</title><meta name="robots" content="noindex"><script></script><a href="/next">次</a>')
      return response('<title>同じ題名</title><h1>見出し</h1>')
    })
    const out = await auditSite('https://example.com/', { lookup: okLookup, request, limits: { pages: 2, requests: 5, responseBytes: 4096, totalBytes: 8192 } })
    expect(out.usage.pages).toBeLessThanOrEqual(2)
    expect(out.usage.requests).toBeLessThanOrEqual(5)
    expect(out.pages[0]).toMatchObject({ noindex: true, title: '同じ題名' })
    expect(out.facts.some(f => /noindex/.test(f.message))).toBe(true)
    expect(out.hypotheses.some(f => /重複/.test(f.message))).toBe(true)
    expect(out.unknowns.join(' ')).toMatch(/Google/)
  })

  it('stops before accepting compressed or oversized responses', async () => {
    const request = vi.fn(async () => response('x'.repeat(300), 200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }))
    const out = await auditSite('https://example.com/', { lookup: okLookup, request, limits: { pages: 1, requests: 3, responseBytes: 64 } })
    expect(out.usage.pages).toBe(0)
    expect(out.unknowns.some(f => /確認できません/.test(f.message))).toBe(true)
  })

  it('honors an already-aborted crawl without making a request', async () => {
    const controller = new AbortController(); controller.abort()
    const request = vi.fn()
    const out = await auditSite('https://example.com/', { lookup: okLookup, request, signal: controller.signal })
    expect(request).not.toHaveBeenCalled()
    expect(out.pages).toEqual([])
    expect(out.unknowns.length).toBeGreaterThan(0)
  })

  it('allows page sampling after robots 404, but records failed transfer bytes as usage rather than a broken link', async () => {
    const request = vi.fn(async (url, options) => {
      if (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml') return response('', 404)
      options.onBytes(150)
      throw new Error('connection closed')
    })
    const out = await auditSite('https://example.com/', { lookup: okLookup, request, limits: { pages: 1, requests: 5, totalBytes: 128 } })
    expect(out.usage.bytes).toBe(150)
    expect(out.pages).toEqual([])
    expect(out.unknowns.some(value => /未確定/.test(value))).toBe(true)
    expect(out.facts.some(f => /到達できない内部URL/.test(f.message))).toBe(false)
  })

  it('bounds stalled DNS and request promises by the total deadline', async () => {
    const started = Date.now()
    const out = await auditSite('https://example.com/', { lookup: () => new Promise(() => {}), limits: { durationMs: 10 } })
    expect(Date.now() - started).toBeLessThan(500)
    expect(out.pages).toEqual([])
  })

  it('bounds a stalled response promise by the total deadline', async () => {
    const started = Date.now()
    const request = vi.fn(url => (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml') ? Promise.resolve(response('', 404)) : new Promise(() => {}))
    const out = await auditSite('https://example.com/', { lookup: okLookup, request, limits: { pages: 1, requests: 5, durationMs: 10 } })
    expect(Date.now() - started).toBeLessThan(500)
    expect(out.pages).toEqual([])
  })

  it('redacts credential-shaped content recursively before diagnostics leave the crawler', async () => {
    const request = vi.fn(async url => {
      if (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml') return response('', 404)
      return response('<title>Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijk.abcdefghijkl</title><meta name="description" content="https://example.com/?token=very-secret">')
    })
    const report = await auditSite('https://example.com/', { lookup: okLookup, request, limits: { pages: 1, requests: 5 } })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('very-secret')
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(serialized).toContain('[REDACTED]')
    expect(redactDiagnostics({ nested: ['Bearer abcdefghijklmnop', 'normal evidence'] }).nested[1]).toBe('normal evidence')
  })
})
