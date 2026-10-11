import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { configurationStatus, createRevenueApi } = require('../scripts/revenue-api.cjs')
const uuid = '11111111-1111-4111-8111-111111111111'
const idempotencyKey = '22222222-2222-4222-8222-222222222222'
const servers = []
const headers = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

async function fixture(store, env) {
  const api = createRevenueApi({ authorize: () => true, permit: () => true, store, env })
  const server = http.createServer(api.handler)
  servers.push(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

describe('Revenue Lab Pollo integration boundary', () => {
  it('queues a scene using server-selected provider configuration without exposing the key', async () => {
    const store = { enqueueVideoGeneration: vi.fn(async () => ({ runId: uuid, sceneGenerationId: idempotencyKey, created: true })) }
    const env = {
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', YOUTUBE_API_KEY: 'test-only',
      POLLO_API_KEY: 'private-pollo-key', REVENUE_LAB_POLLO_MODEL: 'pollo-v2-5',
    }
    const origin = await fixture(store, env)
    const response = await fetch(`${origin}/api/revenue/creative-production-plans/${uuid}/scenes/2/video-generations`, {
      method: 'POST', headers, body: JSON.stringify({ idempotencyKey, regenerate: true }),
    })
    expect(response.status).toBe(201)
    expect(store.enqueueVideoGeneration).toHaveBeenCalledWith(uuid, 2, {
      idempotencyKey, regenerate: true, model: 'pollo-v2-5', provider: 'pollo', providerVersion: 'platform-v1', resolution: '480p',
    })
    expect(JSON.stringify(await response.json())).not.toContain('private-pollo-key')
  })

  it('reports only the missing variable name and rejects malformed scene input', async () => {
    const store = { enqueueVideoGeneration: vi.fn() }
    const base = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', YOUTUBE_API_KEY: 'test-only' }
    const missingOrigin = await fixture(store, base)
    const missing = await fetch(`${missingOrigin}/api/revenue/creative-production-plans/${uuid}/scenes/1/video-generations`, {
      method: 'POST', headers, body: JSON.stringify({ idempotencyKey }),
    })
    expect(missing.status).toBe(503)
    expect(await missing.text()).toContain('POLLO_API_KEY')
    const configuredOrigin = await fixture(store, { ...base, POLLO_API_KEY: 'private-pollo-key' })
    const invalid = await fetch(`${configuredOrigin}/api/revenue/creative-production-plans/${uuid}/scenes/0/video-generations`, {
      method: 'POST', headers, body: JSON.stringify({ idempotencyKey: 'bad' }),
    })
    expect(invalid.status).toBe(400)
    expect(store.enqueueVideoGeneration).not.toHaveBeenCalled()
    const status = configurationStatus({ POLLO_API_KEY: 'private-pollo-key' }).videoGeneration
    expect(status).toMatchObject({ configured: true, provider: 'pollo', providerVersion: 'platform-v1', requestedModel: 'pollo-v2', audioEnabled: false })
    expect(JSON.stringify(status)).not.toContain('private-pollo-key')
  })

  it('ships service-role-only schema, idempotency, cost provenance, and guarded rollback', () => {
    const migration = readFileSync('supabase/migrations/20261011150000_revenue_lab_pollo_video_generation_v1.sql', 'utf8')
    const rollback = readFileSync('supabase/rollback/20261011150000_revenue_lab_pollo_video_generation_v1_down.sql', 'utf8')
    for (const table of ['video_generation_runs', 'video_generation_scenes']) {
      expect(migration).toContain(`create table revenue_lab.${table}`)
      expect(rollback).toContain(`drop table if exists revenue_lab.${table}`)
    }
    expect(migration).toContain('create unique index video_generation_scenes_one_active_idx')
    expect(migration).toContain("cost_provenance in ('actual', 'estimated', 'unavailable')")
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
    expect(rollback).toContain('Rollback blocked: video generation evidence must not be discarded')
  })
})
