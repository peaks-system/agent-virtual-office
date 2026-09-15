import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createStaffApi, permitted } = require('../scripts/staff-api.cjs')

describe('staff HTTP boundary', () => {
  it('rejects remote clients, foreign origins, missing POST origins and rebinding hosts', () => {
    const req = { method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } }
    expect(permitted(req)).toBe(true)
    expect(permitted({ ...req, socket: { remoteAddress: '192.168.1.2' } })).toBe(false)
    for (const headers of [{ host: 'localhost:5173' }, { host: 'evil.example', origin: 'http://evil.example' }, { ...req.headers, origin: 'https://evil.example' }, { ...req.headers, 'sec-fetch-site': 'cross-site' }]) expect(permitted({ ...req, headers })).toBe(false)
  })
  it('starts, polls and cancels only validated same-origin requests', async () => {
    const run = { id: 'run-1', status: 'queued' }
    const runtime = { start: vi.fn(() => run), getRun: vi.fn(id => id === run.id ? run : null), decide: vi.fn(() => ({ parent: run, next: null })), cancel: vi.fn(() => { run.status = 'cancelled' }), close: vi.fn() }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-policy-'))
    const policies = require('../scripts/site-policy.cjs').createSitePolicy(root)
    policies.update('project-1', { ...policies.read('project-1'), siteUrl: 'https://example.com', category: 'general', permissions: { diagnosis: true, ai: true, draft: true }, confirmed: true })
    const api = createStaffApi({ root, runtime })
    const server = http.createServer(api.handler)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const post = (body, origin = base) => fetch(`${base}/api/staff/runs`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body })
    try {
      expect((await post('{}', 'https://evil.example')).status).toBe(403)
      expect((await post('{')).status).toBe(400)
      expect((await post(JSON.stringify({ projectId: '../escape', request: 'test' }))).status).toBe(400)
      expect(runtime.start).not.toHaveBeenCalled()
      expect((await post(JSON.stringify({ projectId: 'project-1', request: '日本語の依頼' }))).status).toBe(202)
      expect(runtime.start).toHaveBeenCalledWith({ projectId: 'project-1', request: '日本語の依頼', execution: { model: 'gpt-5.6-terra', reasoningEffort: 'medium', humanApprovedAstra: false } })
      runtime.start.mockClear()
      expect((await post(JSON.stringify({ projectId: 'project-1', request: 'test', execution: { model: 'gpt-6-astra' } }))).status).toBe(400)
      expect(runtime.start).not.toHaveBeenCalled()
      expect(await (await fetch(`${base}/api/staff/runs/run-1`)).json()).toEqual(run)
      expect((await fetch(`${base}/api/staff/runs/missing`)).status).toBe(404)
      const decision = body => fetch(`${base}/api/staff/runs/run-1/decision`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      expect((await decision({ projectId: 'unknown', action: 'approve' })).status).toBe(403)
      expect(runtime.decide).not.toHaveBeenCalled()
      expect((await decision({ projectId: 'project-1', action: 'reject', actor: 'Local', feedback: '' })).status).toBe(200)
      expect(runtime.decide).toHaveBeenCalledTimes(1)
      const cancelled = await fetch(`${base}/api/staff/runs/run-1/cancel`, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' })
      expect((await cancelled.json()).status).toBe('cancelled')
    } finally {
      await api.close()
      await new Promise(resolve => server.close(resolve))
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
