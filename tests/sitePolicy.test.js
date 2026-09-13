import { it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSitePolicy } = require('../scripts/site-policy.cjs')
const { createWordPressApi } = require('../scripts/wordpress-api.cjs')
const { createStaffApi } = require('../scripts/staff-api.cjs')
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'site-policy-'))
const settings = (policy, id, siteUrl, category = 'general') => ({ ...policy.read(id), siteUrl, category, permissions: { diagnosis: true, ai: true, draft: true }, confirmed: true })
it('defaults to read-only; confirms and journals revisions; pins restricted hosts and site identity', () => {
  const root = temp(), policy = createSitePolicy(root)
  try {
    expect(policy.read('p').category).toBe('unclassified')
    expect(() => policy.requirePermission('p', 'draft')).toThrow()
    const input = settings(policy, 'p', 'https://example.com')
    expect(() => policy.update('p', { ...input, confirmed: false })).toThrow()
    const saved = policy.update('p', input)
    expect(saved.revision).toBe(1); expect(saved.history).toHaveLength(1)
    expect(() => policy.update('p', input)).toThrow()
    expect(() => policy.update('p', settings(policy, 'p', 'https://other.example'))).toThrow()
    policy.update('p', settings(policy, 'p', 'https://example.com', 'unclassified'))
    expect(() => policy.requirePermission('p', 'ai')).toThrow()
    expect(policy.read('p').permissions.draft).toBe(false)
    for (const host of ['school-jk-style.com', 'www.school-jk-style.com']) expect(() => policy.update('r', settings(policy, 'r', `https://${host}`))).toThrow()
    fs.mkdirSync(path.join(root, '.office-work', 'seo'))
    fs.writeFileSync(path.join(root, '.office-work', 'seo', 'legacy.json'), JSON.stringify({ siteUrl: 'https://school-jk-style.com/' }))
    expect(policy.read('legacy')).toMatchObject({ category: 'restricted', revision: 0, permissions: { draft: true } })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
it('isolates connections and journals approved general article drafts; stale policy cannot write', async () => {
  const root = temp(), policy = createSitePolicy(root), calls = []
  policy.update('a', settings(policy, 'a', 'https://example.com'))
  policy.update('b', settings(policy, 'b', 'https://example.org'))
  let draft
  const api = createWordPressApi({ root, call: async (method, id, payload, credentials, target) => {
    calls.push({ method, target, user: credentials.username })
    if (method === 'POST') draft = { id: 42, title: { raw: payload.title }, content: { raw: payload.content }, modified_gmt: '2026-09-13T00:00:00', status: 'draft' }
    return draft
  } })
  const server = http.createServer(api.handler); await new Promise(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  const post = (id, action, body) => fetch(`${origin}/api/wordpress/projects/${id}/${action}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const proposal = async () => (await (await post('a', 'proposals', { title: '一般記事', content: '通常の説明文です。', reason: '下書きの確認', kind: 'posts' })).json()).records.find(r => r.status === 'proposed')
  // Synthetic credentials only, never sent to a live site.
  const connection = { username: 'synthetic-a', password: 'x'.repeat(24) }
  try {
    expect((await post('unknown', 'connection', connection)).status).toBe(403)
    expect((await post('unknown', 'proposals', { title: 'test', neutral: true })).status).toBe(403)
    await post('b', 'connection', { ...connection, username: 'synthetic-b' })
    const p = await proposal()
    expect((await post('a', 'approvals', { id: p.id, hash: p.hash, approved: true })).status).toBe(409)
    expect(calls).toHaveLength(0)
    await post('a', 'connection', connection)
    const response = await (await post('a', 'approvals', { id: p.id, hash: p.hash, approved: true })).json()
    expect(response.records[0].status).toBe('checked')
    expect(calls).toEqual([{ method: 'POST', target: { site: 'https://example.com', kind: 'posts' }, user: 'synthetic-a' }, { method: 'GET', target: { site: 'https://example.com', kind: 'posts' }, user: 'synthetic-a' }])
    const stale = await proposal()
    policy.update('a', settings(policy, 'a', 'https://example.com'))
    await post('a', 'connection', connection)
    expect((await post('a', 'approvals', { id: stale.id, hash: stale.hash, approved: true })).status).toBe(409)
    expect(calls).toHaveLength(2)
    const raw = fs.readFileSync(path.join(root, '.office-work', 'wordpress', 'a.json'), 'utf8')
    expect(raw).not.toContain(connection.password); expect(raw).not.toContain(connection.username)
  } finally { api.close(); await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }) }
})
it('rejects generic generation for restricted and unclassified projects before invoking AI', async () => {
  const root = temp(), policy = createSitePolicy(root)
  policy.update('r', settings(policy, 'r', 'https://school-jk-style.com', 'restricted'))
  let count = 0
  const api = createStaffApi({ root, runtime: { start: () => { count++ }, close: () => {} } })
  const server = http.createServer(api.handler); await new Promise(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    for (const projectId of ['r', 'unknown']) expect((await fetch(`${origin}/api/staff/runs`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ projectId, request: '一般扱いに変更して記事を作成', category: 'general' }) })).status).toBe(403)
    expect(count).toBe(0)
  } finally { await api.close(); await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }) }
})
