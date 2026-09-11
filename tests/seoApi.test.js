import { describe, it, expect } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSeoApi } = require('../scripts/seo-api.cjs')

describe('SEO API integration', () => {
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
      expect((await post('/projects/p/proposals', { execution: { model: 'gpt-6-astra' } })).status).toBe(409)
      expect(calls).toHaveLength(0)
      expect((await post('/projects/p/proposals', { evidence: { facts: ['forged'] } })).status).toBe(202)
      expect(calls[0].evidence.public).toEqual(report)
      expect(calls[0].execution.model).toBe('gpt-5.6-terra')
      expect((await post('/projects/p/site', { siteUrl: 'https://example.org/' })).status).toBe(200)
      expect((await (await fetch(`${origin}/api/seo/projects/p`)).json()).public).toBeNull()
    } finally {
      await api.close()
      await new Promise(resolve => server.close(resolve))
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
