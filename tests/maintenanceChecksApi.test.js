import { it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSeoApi } = require('../scripts/seo-api.cjs')
it('rechecks only saved indexed URLs, rejects stale/foreign input and carries HEAD facts to review', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-checks-'))
  const dir = path.join(root, '.office-work', 'seo'); fs.mkdirSync(dir, { recursive: true })
  const source = { siteUrl: 'https://school-jk-style.com/', public: { generatedAt: '2026-09-11T00:00:00Z', pages: [{ url: 'https://school-jk-style.com/contact/', status: 404 }] } }
  fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify(source))
  const probes = [], staffCalls = []
  const check = { status: 404, type: 'html', method: 'HEAD', checkedAt: '2026-09-13T00:00:00Z' }
  const api = createSeoApi({ root, probe: async (...args) => { probes.push(args); return check }, staff: { start: data => { staffCalls.push(data); return { id: 'r', status: 'review-complete' } }, getRun: () => null, close: async () => {} } })
  const server = http.createServer(api.handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const post = (route, body, from = origin) => fetch(`${origin}/api/seo/projects/p/${route}`, { method: 'POST', headers: { origin: from, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    expect((await post('checks', { pageIndex: 0, generatedAt: source.public.generatedAt }, 'https://other.test')).status).toBe(403)
    expect((await post('checks', { pageIndex: 1, generatedAt: source.public.generatedAt })).status).toBe(409)
    expect((await post('checks', { pageIndex: 0, generatedAt: 'old' })).status).toBe(409)
    expect(probes).toHaveLength(0)
    expect((await post('checks', { pageIndex: 0, generatedAt: source.public.generatedAt, url: 'http://127.0.0.1/' })).status).toBe(200)
    expect(probes).toEqual([[source.public.pages[0].url, source.siteUrl]])
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'p.json'), 'utf8')).maintenanceChecks[0]).toEqual(check)
    await post('proposals', {})
    expect(staffCalls[0].evidence.public.pages[0].headCheck).toEqual(check)
    expect(staffCalls[0].evidence.public.pages[0].status).toBe(404)
  } finally { await api.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }) }
})
