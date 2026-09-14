import { it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { siteCovers, propertyChoice } = require('../scripts/search-console-property.cjs')
const { createSitePolicy } = require('../scripts/site-policy.cjs')
const { createSeoApi } = require('../scripts/seo-api.cjs')
const { createSearchConsole } = require('../scripts/search-console.cjs')

it('matches exact Google identifiers without conflating host, protocol, path or permissions', () => {
  for (const [property, target, expected] of [
    ['sc-domain:example.com', 'https://www.example.com/', true],
    ['sc-domain:example.com', 'http://example.com/', true],
    ['sc-domain:example.com', 'https://evil-example.com/', false],
    ['sc-domain:example.com', 'https://example.com.evil.test/', false],
    ['sc-domain:example.com/', 'https://example.com/', false],
    ['https://example.com/', 'https://example.com/', true],
    ['http://example.com/', 'https://example.com/', false],
    ['https://www.example.com/', 'https://example.com/', false],
    ['https://example.com/blog/', 'https://example.com/', false],
    ['https://example.com/blog/', 'https://example.com/blog/post', true],
    ['https://example.com/Blog/', 'https://example.com/blog/post', false],
    ['https://user@example.com/', 'https://example.com/', false],
    ['https://example.com/?x=y', 'https://example.com/', false],
  ]) expect(siteCovers(property, target)).toBe(expected)
  expect(propertyChoice({ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteUnverifiedUser' }, 'https://example.com/')).toMatchObject({ matches: true, selectable: false })
})

it('lists, selects, persists and reloads independent project properties without changing restricted settings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsc-picker-')), policy = createSitePolicy(root)
  const register = (id, siteUrl, category) => policy.update(id, { ...policy.read(id), siteUrl, category, confirmed: true })
  register('a', 'https://www.example.com', 'general')
  register('b', 'https://school-jk-style.com', 'restricted')
  const prior = policy.read('b')
  let connected = true, failed = false
  const rows = [
    { siteUrl: 'https://other.test/', permissionLevel: 'siteOwner' },
    { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://www.example.com/', permissionLevel: 'siteFullUser' },
    { siteUrl: 'https://www.example.com/blog/', permissionLevel: 'siteOwner' },
    { siteUrl: 'sc-domain:school-jk-style.com', permissionLevel: 'siteRestrictedUser' },
    { siteUrl: 'https://www.example.com', permissionLevel: 'siteUnverifiedUser' },
  ]
  const api = createSeoApi({ root, google: { status: async () => ({ connected }), sites: async () => failed ? { sites: [], reason: 'forbidden', unknowns: [{}] } : { sites: rows }, close: async () => {} } })
  const server = http.createServer(api.handler); await new Promise(r => server.listen(0, '127.0.0.1', r))
  const origin = `http://127.0.0.1:${server.address().port}`
  const get = async suffix => (await fetch(origin + '/api/seo/projects/' + suffix)).json()
  const post = (id, body) => fetch(`${origin}/api/seo/projects/${id}/property`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const list = await get('a/properties')
    expect(list.sites.filter(row => row.selectable).map(row => row.siteUrl)).toEqual(['sc-domain:example.com', 'https://www.example.com/'])
    expect(list.sites).toHaveLength(rows.length)
    const saved = await post('a', { property: 'sc-domain:example.com', expectedProperty: '' })
    expect(saved.status).toBe(200)
    expect((await get('a')).settings.property).toBe('sc-domain:example.com')
    expect(createSitePolicy(root).read('a').property).toBe('sc-domain:example.com')
    expect(policy.read('b')).toEqual(prior)
    expect((await post('b', { property: 'sc-domain:school-jk-style.com', expectedProperty: '' })).status).toBe(200)
    expect((await post('a', { property: 'https://www.example.com/', expectedProperty: 'sc-domain:example.com' })).status).toBe(200)
    expect((await get('a')).settings.property).toBe('https://www.example.com/')
    expect((await get('b')).settings).toMatchObject({ property: 'sc-domain:school-jk-style.com', category: 'restricted', revision: prior.revision, permissions: prior.permissions })
    expect((await post('a', { property: 'https://other.test/', expectedProperty: 'https://www.example.com/' })).status).toBe(403)
    expect((await post('a', { property: 'https://www.example.com', expectedProperty: 'https://www.example.com/' })).status).toBe(403)
    expect((await post('a', { property: 'https://www.example.com/', expectedProperty: '' })).status).toBe(403)
    connected = false; expect((await get('a/properties')).reason).toBe('not-connected')
    connected = true; failed = true; expect((await get('a/properties')).reason).toBe('forbidden')
    expect((await post('a', { property: 'sc-domain:example.com', expectedProperty: 'https://www.example.com/' })).status).toBe(409)
    expect(policy.read('a').property).toBe('https://www.example.com/')
    expect((await post('a', { manual: true, property: 'sc-domain:example.com', expectedProperty: 'https://www.example.com/' })).status).toBe(200)
  } finally { await api.close(); await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }) }
})

it('classifies Google denial without exposing upstream errors or credentials', async () => {
  for (const [status, reason] of [[403,'forbidden'],[401,'not-connected'],[500,'failed']]) {
    const search = createSearchConsole({ vault: { read: async () => ({ client: {}, tokens: { access_token: 'synthetic', refresh_token: 'synthetic', expires_at: Date.now() + 90000 } }) }, fetchImpl: async () => new Response('upstream private detail', { status }) })
    const result = await search.sites()
    expect(result.reason).toBe(reason)
    expect(JSON.stringify(result)).not.toContain('upstream')
    expect(JSON.stringify(result)).not.toContain('synthetic')
    await search.close()
  }
})
