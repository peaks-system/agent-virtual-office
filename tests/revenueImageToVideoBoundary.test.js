import React from 'react'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRequire } from 'node:module'
import { RevenueLabView } from '../src/components/RevenueLabDashboard'

const require = createRequire(import.meta.url)
const { createRevenueApi } = require('../scripts/revenue-api.cjs')
const { createSupabaseStore } = require('../scripts/revenue-lab/supabase-store.cjs')
const id = '11111111-1111-4111-8111-111111111111'
const assetId = '22222222-2222-4222-8222-222222222222'
const revisionId = '33333333-3333-4333-8333-333333333333'

function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }) }

function apiFixture({ store, assetRevisionService }) {
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-secret', YOUTUBE_API_KEY: 'youtube-secret', POLLO_API_KEY: 'pollo-secret', REVENUE_LAB_PRODUCT_ASSET_BUCKET: 'revenue-product-assets' }
  return createRevenueApi({ env, store, assetRevisionService, authorize: () => true, permit: () => true })
}

async function invoke(handler, url, payload) {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))])
  Object.assign(req, { method: 'POST', url, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, socket: { remoteAddress: '127.0.0.1' } })
  let statusCode = 200; let responseBody = ''
  const res = { setHeader: vi.fn(), writeHead: vi.fn(status => { statusCode = status }), end: vi.fn(value => { responseBody += value || '' }) }
  await handler(req, res)
  return { status: statusCode, text: responseBody, json: responseBody ? JSON.parse(responseBody) : null }
}

describe('Image-to-Video API, store and Dashboard boundary', () => {
  it('builds asset-hash idempotency input and rejects permission-ineligible revisions before RPC', async () => {
    const plan = { id, revision_number: 2, output_json: { scenes: [{ scene_number: 1, rendering_strategy: 'image_motion_scene', visual_source_type: 'real_product_asset', product_asset_id: assetId }] } }
    const eligible = { id: revisionId, product_asset_id: assetId, permission_snapshot: 'owned', i2v_allowed_snapshot: true,
      pixel_width: 720, pixel_height: 1280, content_sha256: 'a'.repeat(64), transformation_fingerprint: 'b'.repeat(64) }
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url, options })
      if (url.includes('creative_production_plans?')) return json([plan])
      if (url.includes('product_asset_revisions?')) return json([eligible])
      if (url.includes('/rpc/enqueue_image_video_generation_scene')) return json({ created: true, sceneGenerationId: 'scene-1' })
      throw new Error(`Unexpected URL ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://db.example.test', serviceRoleKey: 'secret', fetchImpl })
    await expect(store.enqueueImageVideoGeneration(id, 1, revisionId, { idempotencyKey: '44444444-4444-4444-8444-444444444444' })).resolves.toMatchObject({ created: true })
    const rpc = calls.find(call => call.url.includes('/rpc/enqueue_image_video_generation_scene'))
    const body = JSON.parse(rpc.options.body)
    expect(body).toMatchObject({ p_requested_model: 'wan-v2-2-flash', p_duration_seconds: 5, p_resolution: '720p', p_prompt_builder_version: 'product-i2v-identity-v1' })
    expect(body.p_generation_input_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(body.p_positive_prompt).not.toContain('pollo-secret')

    const blockedStore = createSupabaseStore({ url: 'https://db.example.test', serviceRoleKey: 'secret', fetchImpl: vi.fn(async url => {
      if (url.includes('creative_production_plans?')) return json([plan])
      if (url.includes('product_asset_revisions?')) return json([{ ...eligible, i2v_allowed_snapshot: false }])
      throw new Error('RPC must not be reached')
    }) })
    await expect(blockedStore.enqueueImageVideoGeneration(id, 1, revisionId, { idempotencyKey: '44444444-4444-4444-8444-444444444444' })).rejects.toMatchObject({ code: 'ASSET_I2V_PERMISSION_DENIED' })
  })

  it('keeps asset capture and I2V enqueue behind server-only endpoints without returning secrets', async () => {
    const store = { enqueueImageVideoGeneration: vi.fn(async () => ({ created: true, jobId: 'job-1' })) }
    const assetRevisionService = { createFromSource: vi.fn(async () => ({ sourceRevision: { id: 'r1' }, usableRevision: { id: revisionId } })) }
    const api = apiFixture({ store, assetRevisionService })
    const revision = await invoke(api.handler, `/api/revenue/product-assets/${assetId}/revisions`, { i2vAllowed: true, createNineSixteen: true })
    expect(revision.status).toBe(201)
    expect(assetRevisionService.createFromSource).toHaveBeenCalledWith(assetId, { i2vAllowed: true, createNineSixteen: true })
    const generation = await invoke(api.handler, `/api/revenue/creative-production-plans/${id}/scenes/1/image-video-generations`,
      { assetRevisionId: revisionId, idempotencyKey: '44444444-4444-4444-8444-444444444444' })
    expect(generation.status).toBe(201)
    expect(store.enqueueImageVideoGeneration).toHaveBeenCalledWith(id, 1, revisionId, expect.objectContaining({ model: 'wan-v2-2-flash' }))
    const text = generation.text
    expect(text).not.toContain('pollo-secret')
    expect(text).not.toContain('server-secret')
  })

  it('renders I2V controls only for image-motion scenes and exposes lineage without signed URLs', () => {
    const revision = { id: revisionId, revisionNumber: 2, availabilityStatus: 'available', i2vAllowed: true, permissionSnapshot: 'owned', contentSha256: 'a'.repeat(64), pixelWidth: 720, pixelHeight: 1280, derivationType: 'pad_9_16' }
    const asset = { id: assetId, usagePermission: 'owned', revisions: [revision] }
    const generation = { sceneNumber: 1, attemptNumber: 1, generationMode: 'image_to_video', status: 'submission_uncertain', submissionUncertain: true, model: 'wan-v2-2-flash', resolution: '720p', promptBuilderVersion: 'product-i2v-identity-v1', costProvenance: 'unavailable' }
    const scenes = [
      { scene_number: 1, rendering_strategy: 'image_motion_scene', visual_source_type: 'real_product_asset', product_asset_id: assetId, product_fact_references: [] },
      { scene_number: 2, rendering_strategy: 'static_product_scene', visual_source_type: 'real_product_asset', product_asset_id: assetId, product_fact_references: [] },
    ]
    const state = { config: { configured: true, missing: [], creativeProduction: { configured: true }, videoGeneration: { configured: true }, imageToVideo: { configured: true, requestedModel: 'wan-v2-2-flash', promptBuilderVersion: 'product-i2v-identity-v1' }, youtubeAnalytics: {} },
      queries: [], opportunities: [], campaigns: [{ id: 'campaign', status: 'active', origins: [], evidenceMarkers: [], iterations: [{ id: 'iteration', iterationNumber: 1, status: 'draft', product: { name: 'Relaxi RE-01', assets: [asset] }, publications: [], productionPlans: [{ requestId: 'request', planId: id, revisionNumber: 2, status: 'succeeded', output: { target_format: 'youtube_shorts', aspect_ratio: '9:16', scenes }, videoGenerations: [generation] }] }] }] }
    const noop = () => {}
    const markup = renderToStaticMarkup(React.createElement(RevenueLabView, { state, onReload: noop, onRun: noop,
      onTrack: noop, onAnalyze: noop, onReview: noop, onTranslate: noop, onEnrich: noop,
      onTranslationFeedback: noop, onProductSearch: noop, onProductDecision: noop,
      onCreateCampaign: noop, onCreateDirectProduct: noop, onGenerateProduction: noop,
      onGenerateVideo: noop, onCreateAssetRevision: noop, onGenerateImageVideo: noop,
      onRegisterPublication: noop, onUpdateIteration: noop, onCreateIteration: noop,
      onDeleteCampaign: noop, onVoidCampaign: noop, onConnectAnalytics: noop,
      onCollectAnalytics: noop, onSave: noop }))
    expect((markup.match(/商品画像I2V/g) || [])).toHaveLength(1)
    expect(markup).toContain('wan-v2-2-flash')
    expect(markup).toContain('product-i2v-identity-v1')
    expect(markup).toContain('送信結果不明')
    expect(markup).not.toContain('signed.example')
  })
})
