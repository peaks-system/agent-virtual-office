import { describe, it, expect } from 'vitest'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createWordPressApi, markup } = require('../scripts/wordpress-api.cjs')
const input = { title: '案内テスト', content: '案内の確認です。\n\n公開しません。', reason: '動作確認', neutral: true }
// Synthetic credentials for the in-memory mock only; never used against WordPress.
const fake = { username: 'test-only', password: 'a'.repeat(24) }
const page = (id, title, content) => ({ id, title: { raw: title }, content: { raw: content }, modified_gmt: '2026-09-11T00:00:00', status: 'draft' })
async function fixture(run, behavior) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-maintenance-test-'))
  const calls = []; let draft, api
  const call = async (method, id, payload) => {
    calls.push({ method, id, payload })
    if (behavior) { const value = await behavior(method, id, payload); if (value !== undefined) return value }
    if (method === 'POST') { draft = page(42, payload.title, payload.content); return draft }
    return id === 42 ? draft : page(id, '旧案内', '<p>旧案内文</p>')
  }
  const restart = () => { api?.close(); api = createWordPressApi({ root, call }) }
  restart()
  const server = http.createServer((req, res) => api.handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const post = (route, body, from = origin) => fetch(`${origin}/api/wordpress${route}`, { method: 'POST', headers: { origin: from, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const get = async () => (await fetch(`${origin}/api/wordpress/projects/p`)).json()
  const propose = async (value = input) => (await (await post('/projects/p/proposals', value)).json()).records[0]
  const approve = p => post('/projects/p/approvals', { id: p.id, hash: p.hash, approved: true })
  try { await run({ root, calls, post, get, propose, approve, restart }) }
  finally { api.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }) }
}
describe('WordPress approval and draft boundary', () => {
  it('previews offline; requires connection, exact approval, and never writes source', () => fixture(async ({ calls, post, propose, approve, get, root }) => {
    const proposal = await propose()
    expect(calls).toHaveLength(0)
    expect((await approve(proposal)).status).toBe(409)
    await post('/connection', fake)
    expect((await post('/projects/p/approvals', { id: proposal.id, hash: 'changed', approved: true })).status).toBe(409)
    expect((await post('/projects/p/approvals', { id: proposal.id, hash: proposal.hash })).status).toBe(409)
    expect(calls).toHaveLength(0)
    expect((await approve(proposal)).status).toBe(200)
    const saved = (await get()).records[0]
    expect(saved.status).toBe('checked')
    expect(saved.draftId).toBe(42)
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET'])
    expect(calls[0].id).toBeNull()
    expect(calls[0].payload).toEqual({ status: 'draft', title: input.title, content: markup(input.content), slug: `office-maintenance-${proposal.id}`, comment_status: 'closed', ping_status: 'closed' })
    expect((await approve(proposal)).status).toBe(409)
    const disk = fs.readFileSync(path.join(root, '.office-work/wordpress/p.json'), 'utf8')
    expect(disk).not.toContain(fake.password)
    expect(disk).not.toContain(fake.username)
  }))
  it('denies foreign origins, raw markup, absent attestation, huge input and mutation verbs', () => fixture(async ({ post, propose, calls }) => {
    expect((await post('/connection', fake, 'https://evil.test')).status).toBe(403)
    for (const value of [{ ...input, neutral: false }, { ...input, content: '<script>alert(1)</script>' }, { ...input, content: '[shortcode]' }, { ...input, content: 'https://other.test/' }, { ...input, title: 'a'.repeat(33000) }]) {
      expect((await post('/projects/p/proposals', value)).status).toBeGreaterThanOrEqual(400)
    }
    expect((await post('/projects/p/publish', input)).status).toBe(404)
    await propose({ ...input, status: 'publish', site: 'http://127.0.0.1' })
    expect(calls).toHaveLength(0)
  }))
  it('snapshots only the selected source and refuses a stale approval', () => {
    let reads = 0
    return fixture(async ({ post, propose, approve, calls }) => {
      await post('/connection', fake)
      const proposal = await propose({ ...input, sourceId: 7 })
      expect(proposal.source.id).toBe(7)
      expect((await approve(proposal)).status).toBe(409)
      expect(calls.map(c => [c.method, c.id])).toEqual([['GET', 7], ['GET', 7]])
    }, (method, id) => method === 'GET' ? page(id, ++reads === 1 ? 'old' : 'new', '<p>neutral</p>') : undefined)
  })
  it('retains uncertain writes across restart and never retries them', () => fixture(async ({ post, propose, approve, get, restart, calls }) => {
    await post('/connection', fake)
    const proposal = await propose()
    await approve(proposal)
    expect((await get()).records[0].status).toBe('uncertain')
    restart()
    expect((await get()).configured).toBe(false)
    await post('/connection', fake)
    expect((await approve(proposal)).status).toBe(409)
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
  }, method => { if (method === 'POST') throw new Error('mock timeout') }))
  it('records a created ID even when quality verification fails', () => fixture(async ({ post, propose, approve, get, calls }) => {
    await post('/connection', fake)
    const proposal = await propose(); await approve(proposal)
    const saved = (await get()).records[0]
    expect(saved.draftId).toBe(42); expect(saved.status).toBe('needs-review')
    expect((await approve(proposal)).status).toBe(409)
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
  }, (method, id) => { if (method === 'GET' && id === 42) throw new Error('mock read failure') }))
  it('serializes simultaneous approval requests', () => fixture(async ({ post, propose, approve, calls }) => {
    await post('/connection', fake)
    const proposal = await propose()
    const replies = await Promise.all([approve(proposal), approve(proposal)])
    expect(replies.map(r => r.status).sort()).toEqual([200, 409])
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1)
  }))
  it('does not trust a modified saved proposal', () => fixture(async ({ post, propose, approve, calls, root }) => {
    await post('/connection', fake)
    const proposal = await propose()
    const file = path.join(root, '.office-work/wordpress/p.json')
    const records = JSON.parse(fs.readFileSync(file, 'utf8')); records[0].after.title = 'tampered'; fs.writeFileSync(file, JSON.stringify(records))
    expect((await approve(proposal)).status).toBe(409); expect(calls).toHaveLength(0)
  }))
  it('creates a separate draft from one source and verifies that source remained unchanged', () => fixture(async ({ post, propose, approve, get, calls }) => {
    await post('/connection', fake)
    const proposal = await propose({ ...input, sourceId: 7 }); await approve(proposal)
    const saved = (await get()).records[0]
    expect(saved.status).toBe('checked'); expect(saved.checks.sourceUnchanged).toBe(true)
    expect(calls.filter(c => c.method === 'POST').map(c => c.id)).toEqual([null])
    expect(saved.source.id).toBe(7); expect(saved.draftId).toBe(42)
  }))
  it('never presents the source ID as a disposable new draft', () => fixture(async ({ post, propose, approve, get }) => {
    await post('/connection', fake)
    const proposal = await propose({ ...input, sourceId: 7 }); await approve(proposal)
    const saved = (await get()).records[0]
    expect(saved.status).toBe('uncertain'); expect(saved.draftId).toBeUndefined()
  }, method => method === 'POST' ? { id: 7 } : undefined))
})
