import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { configurationStatus, createRevenueApi } = require('../scripts/revenue-api.cjs')
const uuid = '11111111-1111-4111-8111-111111111111'
const servers = []
const jsonHeaders = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

async function fixture({ authorize = () => true, env, store } = {}) {
  const api = createRevenueApi({ authorize, permit: () => true, env: env || { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', YOUTUBE_API_KEY: 'test-only' }, store, today: () => '2026-10-08' })
  const server = http.createServer(api.handler)
  servers.push(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

describe('Revenue Lab API', () => {
  it('reports missing environment names without values or constructing storage', async () => {
    const status = configurationStatus({ SUPABASE_URL: 'https://safe.test' })
    expect(status).toMatchObject({ configured: false, missing: ['SUPABASE_SERVICE_ROLE_KEY', 'YOUTUBE_API_KEY'], analysis: { configured: false, missing: ['OPENAI_API_KEY'] } })
    const origin = await fixture({ env: { SUPABASE_URL: 'https://safe.test' } })
    const response = await fetch(`${origin}/api/revenue/dashboard`)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(text).not.toContain('https://safe.test')
  })

  it('returns bounded dashboard data through the isolated namespace', async () => {
    const store = { dashboard: vi.fn(async () => ({ queries: [{ id: uuid }], opportunities: [{ youtubeVideoId: 'v1' }], latestJob: null })) }
    const origin = await fixture({ store })
    const response = await fetch(`${origin}/api/revenue/dashboard?limit=99`)
    expect(response.status).toBe(200)
    expect((await response.json()).data.opportunities).toHaveLength(1)
    expect(store.dashboard).toHaveBeenCalledWith(3)
  })

  it('validates and authorizes query updates before storage', async () => {
    const store = { updateQuery: vi.fn(async (id, patch) => ({ id, ...patch })) }
    const deniedOrigin = await fixture({ store, authorize: () => false })
    expect((await fetch(`${deniedOrigin}/api/revenue/queries/${uuid}`, { method: 'PUT', headers: jsonHeaders, body: '{}' })).status).toBe(401)
    expect(store.updateQuery).not.toHaveBeenCalled()

    const origin = await fixture({ store })
    const invalid = await fetch(`${origin}/api/revenue/queries/${uuid}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ buyerIntent: 101 }) })
    expect(invalid.status).toBe(400)
    const valid = await fetch(`${origin}/api/revenue/queries/${uuid}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ label: '  デスク用品  ', queryText: '机 ガジェット', buyerIntent: 80, commerceFit: null, enabled: true }) })
    expect(valid.status).toBe(200)
    expect(store.updateQuery).toHaveBeenCalledWith(uuid, { label: 'デスク用品', query_text: '机 ガジェット', buyer_intent: 80, commerce_fit: null, enabled: true })
  })

  it('enqueues a manual run and does not execute YouTube in the request', async () => {
    const store = { enqueueQuery: vi.fn(async () => ({ id: 'job1', created: true, status: 'pending' })) }
    const origin = await fixture({ store })
    const response = await fetch(`${origin}/api/revenue/jobs`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ sourceQueryId: uuid }) })
    expect(response.status).toBe(201)
    expect(store.enqueueQuery).toHaveBeenCalledWith(uuid, '2026-10-08')
    expect((await response.json()).data.status).toBe('pending')
  })

  it('enqueues a manual Tracking job independently from Discovery', async () => {
    const store = { enqueueTracking: vi.fn(async () => ({ createdCount: 1 })) }
    const origin = await fixture({ store })
    const response = await fetch(`${origin}/api/revenue/tracking/jobs`, { method: 'POST', headers: jsonHeaders, body: '{}' })
    expect(response.status).toBe(201)
    expect(store.enqueueTracking).toHaveBeenCalledWith('2026-10-08')
  })

  it('starts with one analysis candidate, caps six, and requires server-side OpenAI configuration', async () => {
    const store = { enqueueAnalysisCandidates: vi.fn(async limit => ({ selectedCount: limit, records: [{ created: true }] })) }
    const configuredEnv = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', YOUTUBE_API_KEY: 'test', OPENAI_API_KEY: 'secret' }
    const deniedOrigin = await fixture({ store, env: configuredEnv, authorize: () => false })
    expect((await fetch(`${deniedOrigin}/api/revenue/analysis/jobs`, { method: 'POST', headers: jsonHeaders, body: '{}' })).status).toBe(401)
    expect(store.enqueueAnalysisCandidates).not.toHaveBeenCalled()
    const missingOrigin = await fixture({ store })
    expect((await fetch(`${missingOrigin}/api/revenue/analysis/jobs`, { method: 'POST', headers: jsonHeaders, body: '{}' })).status).toBe(503)
    const origin = await fixture({ store, env: configuredEnv })
    const first = await fetch(`${origin}/api/revenue/analysis/jobs`, { method: 'POST', headers: jsonHeaders, body: '{}' })
    expect(first.status).toBe(201)
    expect(store.enqueueAnalysisCandidates).toHaveBeenCalledWith(1, expect.objectContaining({ model: 'gpt-6-luna' }))
    expect((await fetch(`${origin}/api/revenue/analysis/jobs`, { method: 'POST', headers: jsonHeaders, body: '{"limit":7}' })).status).toBe(400)
  })

  it('requires Rakuten server credentials and enqueues exactly one analysis product search', async () => {
    const store = { enqueueProductSearch: vi.fn(async () => ({ id: 'run-1', status: 'pending', created: true, cached: false })) }
    const base = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', YOUTUBE_API_KEY: 'test' }
    const missingOrigin = await fixture({ store, env: base })
    expect((await fetch(`${missingOrigin}/api/revenue/analyses/${uuid}/product-search/jobs`, { method: 'POST', headers: jsonHeaders, body: '{}' })).status).toBe(503)
    const env = { ...base, RAKUTEN_APPLICATION_ID: 'app', RAKUTEN_ACCESS_KEY: 'key' }
    const origin = await fixture({ store, env })
    const response = await fetch(`${origin}/api/revenue/analyses/${uuid}/product-search/jobs`, { method: 'POST', headers: jsonHeaders, body: '{}' })
    expect(response.status).toBe(201)
    expect(store.enqueueProductSearch).toHaveBeenCalledWith(uuid, '2026-10-08')
    expect(configurationStatus(env).products).toMatchObject({ configured: true, providerApiVersion: '20260701', affiliateConfigured: false })
  })

  it('validates and saves an append-only product research decision', async () => {
    const store = { createProductDecision: vi.fn(async (_candidate, _analysis, input) => ({ id: 'decision-1', ...input })) }
    const origin = await fixture({ store })
    const invalid = await fetch(`${origin}/api/revenue/product-candidates/${uuid}/decisions`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ analysisId: uuid, decision: 'publish' }) })
    expect(invalid.status).toBe(400)
    const response = await fetch(`${origin}/api/revenue/product-candidates/${uuid}/decisions`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ analysisId: uuid, decision: 'selected_for_research' }) })
    expect(response.status).toBe(201)
    expect(store.createProductDecision).toHaveBeenCalledWith(uuid, uuid, expect.objectContaining({ decision: 'selected_for_research' }))
  })

  it('uses a consistent safe error envelope for malformed JSON and service failures', async () => {
    const store = { dashboard: vi.fn(async () => { throw Object.assign(new Error('db secret details'), { code: 'SUPABASE_HTTP_ERROR' }) }) }
    const origin = await fixture({ store })
    const malformed = await fetch(`${origin}/api/revenue/jobs`, { method: 'POST', headers: jsonHeaders, body: '{' })
    expect(await malformed.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: '入力内容を確認してください。' } })
    const failed = await fetch(`${origin}/api/revenue/dashboard`)
    const text = await failed.text()
    expect(failed.status).toBe(502)
    expect(text).toContain('REVENUE_SERVICE_ERROR')
    expect(text).not.toContain('db secret details')
  })
})
