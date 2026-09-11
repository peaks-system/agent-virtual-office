import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

const require = createRequire(import.meta.url)
const { createSearchConsole, externalBrowser } = require('../scripts/search-console.cjs')

const client = { installed: { client_id: 'mock-client-id', client_secret: 'mock-client-secret', token_uri: 'https://oauth2.googleapis.com/token' } }
const tokens = { access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expires_at: Date.now() + 60_000 }
const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('Google Search Console boundary', () => {
  it('waits for OS browser dispatch and keeps the OAuth URL out of Windows command arguments', async () => {
    for (const exitCode of [0, 1]) {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), kill: vi.fn() })
      const spawnImpl = vi.fn(() => child)
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?state=harmless-marker'
      const opened = externalBrowser(url, { platform: 'win32', spawnImpl })
      expect(JSON.stringify(spawnImpl.mock.calls)).not.toContain(url)
      expect(child.stdin.read().toString()).toBe(url)
      child.emit('close', exitCode)
      if (exitCode) await expect(opened).rejects.toThrow('browser')
      else await expect(opened).resolves.toBeUndefined()
    }
  })

  it('clears the pending callback when the system browser cannot open', async () => {
    const search = createSearchConsole({ vault: { read: async () => ({ client: client.installed }), write: async () => {} }, openBrowser: async () => { throw new Error('raw URL must not escape') } })
    await expect(search.connect()).rejects.toMatchObject({ code: 'SEO_BROWSER_OPEN' })
    expect((await search.status()).pending).toBe(false)
    await search.close()
  })
  it('does not report a configuration saved when encrypted persistence fails', async () => {
    const search = createSearchConsole({ vault: { read: async () => ({}), write: async () => { throw new Error('not for display') } } })
    await expect(search.configure(client)).rejects.toMatchObject({ code: 'SEO_CLIENT_STORAGE' })
    expect((await search.status()).configured).toBe(false)
    await search.close()
  })
  it('accepts Google downloaded desktop JSON endpoint variants but uses fixed current endpoints', async () => {
    for (const tokenUri of ['https://oauth2.googleapis.com/token', 'https://accounts.google.com/o/oauth2/token']) {
      const vault = { read: async () => ({}), write: vi.fn(async () => {}) }
      const opened = vi.fn(async () => {})
      const search = createSearchConsole({ vault, openBrowser: opened })
      const downloaded = { installed: { ...client.installed, auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: tokenUri, redirect_uris: ['http://localhost'] } }
      try {
        expect((await search.configure(downloaded)).configured).toBe(true)
        expect(vault.write.mock.calls[0][0].client.token_uri).toBe('https://oauth2.googleapis.com/token')
        await search.connect()
        expect(new URL(opened.mock.calls[0][0]).pathname).toBe('/o/oauth2/v2/auth')
      } finally { await search.close() }
    }
  })

  it('rejects foreign endpoints and wrong client types without replacing saved configuration', async () => {
    const vault = { read: async () => ({}), write: vi.fn(async () => {}) }
    const search = createSearchConsole({ vault })
    await expect(search.configure({ web: client.installed })).rejects.toMatchObject({ code: 'SEO_CLIENT_FORMAT' })
    await expect(search.configure({ installed: { ...client.installed, auth_uri: 'https://evil.test/auth' } })).rejects.toMatchObject({ code: 'SEO_CLIENT_FORMAT' })
    expect(vault.write).not.toHaveBeenCalled()
    await search.close()
  })
  it('never exposes client material and starts desktop OAuth in an external browser', async () => {
    const vault = { read: vi.fn(async () => ({})), write: vi.fn(async () => {}) }
    const opened = vi.fn(async () => {})
    const search = createSearchConsole({ vault, openBrowser: opened })
    expect(await search.configure(JSON.stringify(client))).toEqual({ configured: true, connected: false, pending: false, message: 'Google Search Console は設定済みです。' })
    const pending = await search.connect()
    expect(pending).toMatchObject({ configured: true, connected: false, pending: true })
    expect(JSON.stringify(pending)).not.toContain('mock-client')
    expect(opened).toHaveBeenCalledOnce()
    const authorization = new URL(opened.mock.calls[0][0])
    expect(authorization.hostname).toBe('accounts.google.com')
    expect(authorization.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly')
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    await search.close()
  })

  it('uses only read endpoints and whitelists Search Console fields', async () => {
    const vault = { read: vi.fn(async () => ({ client: client.installed, tokens })), write: vi.fn(async () => {}) }
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/sites')) return response({ siteEntry: [{ siteUrl: 'sc-domain:example.test', permissionLevel: 'siteOwner', unexpected: 'drop' }] })
      if (url.includes('searchAnalytics/query')) return response({ rows: [{ keys: ['query marker', 'https://www.example.test/page'], clicks: 4, impressions: 10, ctr: 0.4, position: 2, extra: 'drop' }] })
      if (url.includes('/sitemaps')) return response({ sitemap: [{ path: 'https://www.example.test/sitemap.xml', warnings: 0, errors: 0, injected: 'drop' }] })
      if (url.includes('urlInspection/index:inspect')) return response({ inspectionResult: { indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', unknown: 'drop' } } })
      throw new Error('unexpected request')
    })
    const search = createSearchConsole({ vault, fetchImpl })
    expect(await search.sites()).toEqual({ sites: [{ siteUrl: 'sc-domain:example.test', permissionLevel: 'siteOwner' }] })
    const result = await search.diagnose({ property: 'sc-domain:example.test', siteUrl: 'https://www.example.test/' })
    expect(result).toMatchObject({ property: 'sc-domain:example.test', siteUrl: 'https://www.example.test/', analytics: [{ query: 'query marker', page: 'https://www.example.test/page', clicks: 4 }], sitemaps: [{ path: 'https://www.example.test/sitemap.xml' }], inspection: { verdict: 'PASS', coverageState: 'Submitted and indexed' } })
    expect(result.facts.some(fact => fact.message.startsWith('検査結果: PASS'))).toBe(true)
    expect(result.unknowns.some(item => item.message.includes('robots.txt'))).toBe(true)
    expect(JSON.stringify(result)).not.toContain('drop')
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes('/sites')).length).toBe(4)
    for (const [url, options] of fetchImpl.mock.calls) {
      expect(url).toMatch(/^https:\/\/(www\.googleapis\.com|searchconsole\.googleapis\.com)\//)
      expect(options.headers.Authorization).toBe('Bearer mock-access-token')
      expect(options.redirect).toBe('error')
    }
  })

  it('does not fetch a property that is unavailable or fails to cover the requested site', async () => {
    const vault = { read: async () => ({ client: client.installed, tokens }), write: async () => {} }
    const fetchImpl = vi.fn(async () => response({ siteEntry: [{ siteUrl: 'https://example.test/', permissionLevel: 'siteOwner' }] }))
    const search = createSearchConsole({ vault, fetchImpl })
    const result = await search.diagnose({ property: 'https://example.test/', siteUrl: 'https://evil.test/' })
    expect(result.unknowns).toEqual([{ message: 'Google Search Console のデータを取得できませんでした。' }])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an oversized response before buffering it', async () => {
    const vault = { read: async () => ({ client: client.installed, tokens }), write: async () => {} }
    const fetchImpl = vi.fn(async () => new Response('x', { headers: { 'content-length': '999999' } }))
    const search = createSearchConsole({ vault, fetchImpl })
    expect(await search.sites()).toEqual({ sites: [], unknowns: [{ message: 'Google Search Console のデータを取得できませんでした。' }] })
  })

  it('does not persist tokens when closed while an OAuth exchange is pending', async () => {
    let resolveToken
    const tokenStarted = new Promise(resolve => { resolveToken = resolve })
    const vault = { read: async () => ({ client: client.installed }), write: vi.fn(async () => {}) }
    const openBrowser = vi.fn(async () => {})
    const fetchImpl = vi.fn(async url => {
      if (url.includes('oauth2.googleapis.com')) return tokenStarted
      throw new Error('unexpected')
    })
    const search = createSearchConsole({ vault, openBrowser, fetchImpl })
    await search.connect()
    const auth = new URL(openBrowser.mock.calls[0][0])
    const callback = new URL(auth.searchParams.get('redirect_uri'))
    callback.pathname = '/oauth2/callback'
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'mock-code' }).toString()
    const callbackRequest = fetch(callback)
    while (!fetchImpl.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 1))
    await search.close()
    resolveToken(response({ access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', scope: 'https://www.googleapis.com/auth/webmasters.readonly' }))
    await callbackRequest.catch(() => {})
    expect(vault.write).not.toHaveBeenCalled()
  })
})
