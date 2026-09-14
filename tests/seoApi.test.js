import { describe, it, expect } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSeoApi } = require('../scripts/seo-api.cjs')

describe('SEO API integration', () => {
  it('allows OAuth redirects only from a user-activated same-origin navigation and protects cancellation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-navigation-'))
    let starts = 0, cancels = 0
    const api = createSeoApi({ root, google: { connect: async options => { expect(options.launchBrowser).toBe(false); starts++ }, authorizationRedirect: () => 'https://accounts.google.com/o/oauth2/v2/auth', cancelAuthorization: async () => { cancels++; return { pending: false } }, close: async () => {} } })
    const server = http.createServer(api.handler); await new Promise(r => server.listen(0,'127.0.0.1',r))
    const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}/api/seo/google/authorize`
    const headers = { 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', 'sec-fetch-user': '?1' }
    // Node fetch overwrites Sec-Fetch-Mode, so exercise actual navigation headers via http.
    const navigate = custom => new Promise(resolve => { http.get(url, { headers: custom }, res => { res.resume(); res.on('end', () => resolve({ code: res.statusCode, headers: res.headers })) }) })
    try {
      for (const invalid of [{}, { ...headers, 'sec-fetch-site': 'cross-site' }, { ...headers, 'sec-fetch-user': '?0' }, { ...headers, 'sec-fetch-dest': 'iframe' }]) expect((await navigate(invalid)).code).toBe(403)
      expect(starts).toBe(0)
      const valid = await navigate(headers); expect(valid.code).toBe(302); expect(valid.headers.location).toBe('https://accounts.google.com/o/oauth2/v2/auth'); expect(valid.headers['cache-control']).toBe('no-store')
      expect(starts).toBe(1)
      const cancelUrl = `${origin}/api/seo/google/cancel-authorization`
      expect((await fetch(cancelUrl, { method:'POST',headers:{'content-type':'application/json'},body:'{}' })).status).toBe(403)
      expect((await fetch(cancelUrl, { method:'POST',headers:{origin,'content-type':'application/json'},body:'{}' })).status).toBe(200)
      expect(cancels).toBe(1)
    } finally { await api.close(); await new Promise(r=>server.close(r)); fs.rmSync(root,{recursive:true,force:true}) }
  })
  it('enforces origin, public URLs, server-owned evidence and model approval', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-api-'))
    const calls = []
    const report = { generatedAt: '2026-09-10T00:00:00Z', facts: [{ message: 'observed' }], unknowns: [], pages: [] }
    const api = createSeoApi({ root, crawler: async () => report,
      google: { status: async () => ({ configured: false, connected: false }), close: async () => {} },
      staff: { start: input => { calls.push(input); return { id: 'run1', status: 'awaiting-human' } }, getRun: () => null, close: async () => {} } })
    const server = http.createServer(api.handler)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    const post = (route, data, source = origin) => fetch(`${origin}/api/seo${route}`, { method: 'POST', headers: { origin: source, 'content-type': 'application/json' }, body: JSON.stringify(data) })
    try {
      expect((await post('/projects/p/site', { siteUrl: 'https://example.com/' }, 'https://evil.test')).status).toBe(403)
      expect((await post('/projects/p/site', { siteUrl: 'http://127.0.0.1/' })).status).toBe(400)
      expect((await post('/projects/p/site', { siteUrl: 'https://example.com/' })).status).toBe(200)
      expect((await post('/projects/p/audits', {})).status).toBe(202)
      let saved
      for (let i = 0; i < 30; i++) {
        saved = await (await fetch(`${origin}/api/seo/projects/p`)).json()
        if (saved.audit.status === 'complete') break
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      expect(saved.public).toEqual(report)
      expect((await post('/projects/p/proposals', {})).status).toBe(403)
      expect((await post('/projects/p/settings', { ...saved.settings, category: 'general', permissions: { diagnosis: true, ai: true, draft: true }, confirmed: true })).status).toBe(200)
      expect((await post('/projects/p/proposals', { execution: { model: 'gpt-6-astra' } })).status).toBe(400)
      expect(calls).toHaveLength(0)
      expect((await post('/projects/p/proposals', { evidence: { facts: ['forged'] } })).status).toBe(202)
      expect(calls[0].evidence.public).toEqual(report)
      expect(calls[0].execution.model).toBe('gpt-5.6-terra')
      expect((await post('/projects/p/site', { siteUrl: 'https://example.org/' })).status).toBe(409)
      expect((await (await fetch(`${origin}/api/seo/projects/p`)).json()).public).toEqual(report)
    } finally {
      await api.close()
      await new Promise(resolve => server.close(resolve))
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
