import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { analyticsDateRangeInput, configurationStatus, createRevenueApi, directProductInput,
  DIRECT_PRODUCT_PLACEHOLDERS, threePicksV2CampaignInput } = require('../scripts/revenue-api.cjs')
const uuid = '11111111-1111-4111-8111-111111111111'
const idempotencyKey = '22222222-2222-4222-8222-222222222222'
const servers = []
const jsonHeaders = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

async function fixture({ authorize = () => true, analyticsService, env, store } = {}) {
  const api = createRevenueApi({ authorize, permit: () => true, analyticsService, env: env || { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', YOUTUBE_API_KEY: 'test-only' }, store, today: () => '2026-10-08' })
  const server = http.createServer(api.handler)
  servers.push(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

describe('Revenue Lab API', () => {
  it('validates v2 Product Set asset cardinality and requires every local v2 composition dependency', () => {
    const input = threePicksV2CampaignInput({ idempotencyKey, campaignName: 'v2', items: [1, 2, 3].map(index => ({
      curatedProductId: `${index}1111111-1111-4111-8111-111111111111`,
      productAssetRevisionIds: [`${index}2222222-2222-4222-8222-222222222222`], verifiedFactRef: 'summary',
    })) })
    expect(input.items).toHaveLength(3)
    expect(configurationStatus({ OPENAI_API_KEY: 'configured' }).multiProductShortsV2).toMatchObject({
      configured: true, archetype: 'three_picks_v2', templateId: 'hero-carousel-v2', templateSelection: 'server_fixed',
      promptVersion: 'three-picks-production-planner-v4', schemaVersion: 'multi-product-shorts-plan-v5',
    })
    expect(configurationStatus({}).finalCompositionV2).toMatchObject({ configured: false,
      missing: expect.arrayContaining(['REVENUE_LAB_PRODUCT_ASSET_BUCKET', 'REVENUE_LAB_CREATIVE_AUDIO_BUCKET',
        'REVENUE_LAB_COMPOSITION_BUCKET', 'REVENUE_LAB_FFMPEG_PATH', 'REVENUE_LAB_FFPROBE_PATH']) })
    expect(configurationStatus({
      REVENUE_LAB_PRODUCT_ASSET_BUCKET: 'products', REVENUE_LAB_CREATIVE_AUDIO_BUCKET: 'revenue-lab-creative-audio',
      REVENUE_LAB_COMPOSITION_BUCKET: 'compositions', REVENUE_LAB_FFMPEG_PATH: process.execPath,
      REVENUE_LAB_FFPROBE_PATH: process.execPath, REVENUE_LAB_COMPOSITION_FONT_PATH: process.execPath,
    }).finalCompositionV2).toMatchObject({ configured: true, missing: [] })
    expect(() => threePicksV2CampaignInput({ idempotencyKey, campaignName: 'v2', items: input.items.map(item => ({
      ...item, productAssetRevisionIds: [uuid, uuid],
    })) })).toThrow(TypeError)
  })

  it('exposes only safe ElevenLabs configuration and enqueues generation without the API key', async () => {
    const store = { enqueueCreativeAudioGeneration: vi.fn(async () => ({ created: true, artifactCount: 5 })) }
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
      YOUTUBE_API_KEY: 'test', ELEVENLABS_API_KEY: 'private-elevenlabs-key',
      REVENUE_LAB_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2', REVENUE_LAB_ELEVENLABS_VOICE_ID: 'voice-1',
      REVENUE_LAB_FFPROBE_PATH: 'ffprobe', REVENUE_LAB_CREATIVE_AUDIO_BUCKET: 'revenue-lab-creative-audio',
      REVENUE_LAB_PRODUCT_ASSET_BUCKET: 'product-assets', REVENUE_LAB_COMPOSITION_BUCKET: 'compositions' }
    const status = configurationStatus(env).textToSpeech
    expect(status).toMatchObject({ configured: true, provider: 'elevenlabs',
      providerAdapterVersion: 'elevenlabs-tts-adapter-v1', requestedModel: 'eleven_multilingual_v2',
      voiceConfigured: true, outputFormat: 'mp3_44100_128', storageBucket: 'revenue-lab-creative-audio' })
    expect(JSON.stringify(status)).not.toContain('private-elevenlabs-key')
    expect(JSON.stringify(status)).not.toContain('voice-1')

    const origin = await fixture({ store, env })
    const response = await fetch(`${origin}/api/revenue/three-picks-v2-plans/${uuid}/audio-generations`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey }),
    })
    expect(response.status).toBe(201)
    expect(store.enqueueCreativeAudioGeneration).toHaveBeenCalledWith(uuid, expect.objectContaining({
      provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice: 'voice-1',
      outputFormat: 'mp3_44100_128', storageBucket: 'revenue-lab-creative-audio',
      fingerprintSchemaVersion: 'creative-audio-generation-v2',
      voiceSettings: expect.objectContaining({
        normalization: { apply_text_normalization: 'auto' } }),
    }))
    expect(JSON.stringify(store.enqueueCreativeAudioGeneration.mock.calls)).not.toContain('private-elevenlabs-key')
  })

  it('routes v2 campaign and plan mutations only to dedicated store methods', async () => {
    const store = { createThreePicksV2Campaign: vi.fn(async () => ({ created: true })),
      enqueueThreePicksV2Plan: vi.fn(async () => ({ created: true })) }
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
      YOUTUBE_API_KEY: 'test', OPENAI_API_KEY: 'test' }
    const origin = await fixture({ store, env })
    const items = [1, 2, 3].map(index => ({ curatedProductId: `${index}1111111-1111-4111-8111-111111111111`,
      productAssetRevisionIds: [`${index}2222222-2222-4222-8222-222222222222`], verifiedFactRef: 'summary' }))
    const created = await fetch(`${origin}/api/revenue/three-picks-v2/campaigns`, { method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ idempotencyKey, campaignName: 'v2', items }) })
    expect(created.status).toBe(201)
    const planned = await fetch(`${origin}/api/revenue/campaign-iterations/${uuid}/three-picks-v2-plans`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey }) })
    expect(planned.status).toBe(201)
    expect(store.createThreePicksV2Campaign).toHaveBeenCalledOnce()
    expect(store.enqueueThreePicksV2Plan).toHaveBeenCalledWith(uuid, expect.objectContaining({ idempotencyKey }))
  })

  it('returns a sealed 422 response for evidence preparation failures', async () => {
    const store = { enqueueThreePicksV2Plan: vi.fn(async () => {
      throw Object.assign(new Error('private product row detail'), { code: 'REVENUE_EVIDENCE_PREPARATION_FAILED', status: 422 })
    }) }
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
      YOUTUBE_API_KEY: 'test', OPENAI_API_KEY: 'test' }
    const origin = await fixture({ store, env })
    const response = await fetch(`${origin}/api/revenue/campaign-iterations/${uuid}/three-picks-v2-plans`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey }),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: { code: 'REVENUE_EVIDENCE_PREPARATION_FAILED',
      message: '商品情報から動画用の根拠データを作成できませんでした。商品説明の形式を確認してください。' } })
  })

  it('returns a product-specific sealed 422 response for missing typed facts', async () => {
    const store = { enqueueThreePicksV2Plan: vi.fn(async () => {
      throw Object.assign(new Error('private product row detail'), { code: 'TYPED_FACT_CANDIDATE_MISSING', status: 422,
        productIndex: 2, reason: 'no safe typed fact candidate could be compiled' })
    }) }
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test',
      YOUTUBE_API_KEY: 'test', OPENAI_API_KEY: 'test' }
    const origin = await fixture({ store, env })
    const response = await fetch(`${origin}/api/revenue/campaign-iterations/${uuid}/three-picks-v2-plans`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey }),
    })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: { code: 'TYPED_FACT_CANDIDATE_MISSING',
      message: '商品2から安全な事実ラベルを作成できませんでした',
      details: { product_index: 2, reason: 'no safe typed fact candidate could be compiled' } } })
  })
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

  it('returns only the active Discovery job set and rejects malformed job ids', async () => {
    const store = { discoveryResults: vi.fn(async (jobIds, limit) => ({ status: 'succeeded', completedCount: 1, totalCount: 1, receivedCount: 18, opportunities: [{ id: 'current' }] })) }
    const origin = await fixture({ store })
    const invalid = await fetch(`${origin}/api/revenue/discovery/results?jobIds=bad`)
    expect(invalid.status).toBe(400)
    const response = await fetch(`${origin}/api/revenue/discovery/results?jobIds=${uuid}&limit=99`)
    expect(response.status).toBe(200)
    expect(store.discoveryResults).toHaveBeenCalledWith([uuid], 3)
    expect((await response.json()).data).toMatchObject({ status: 'succeeded', receivedCount: 18, opportunities: [{ id: 'current' }] })
  })

  it('reports server-only YouTube Analytics configuration names without values', () => {
    const status = configurationStatus({ YOUTUBE_ANALYTICS_CLIENT_ID: 'desktop-client-id' }).youtubeAnalytics
    expect(status).toMatchObject({ configured: false, missing: ['YOUTUBE_ANALYTICS_CLIENT_SECRET'], credentialStore: 'windows-dpapi' })
    expect(JSON.stringify(status)).not.toContain('desktop-client-id')
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

  it('enqueues Commerce Translation and records safe human keyword lineage', async () => {
    const store = {
      enqueueCommerceTranslation: vi.fn(async () => ({ id: uuid, created: true, cached: false })),
      createCommerceTranslationFeedback: vi.fn(async (_id, input) => ({ id: 'feedback-1', ...input })),
    }
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', YOUTUBE_API_KEY: 'test', OPENAI_API_KEY: 'secret' }
    const origin = await fixture({ store, env })
    const queued = await fetch(`${origin}/api/revenue/analyses/${uuid}/commerce-translations/jobs`, { method: 'POST', headers: jsonHeaders, body: '{}' })
    expect(queued.status).toBe(201)
    expect(store.enqueueCommerceTranslation).toHaveBeenCalledWith(uuid, expect.objectContaining({ model: 'gpt-6-luna' }))
    const keywordId = '33333333-3333-4333-8333-333333333333'
    const approved = await fetch(`${origin}/api/revenue/commerce-translations/${uuid}/feedback`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ keywordId, action: 'override', overrideKeyword: '省スペース 卓上照明' }) })
    expect(approved.status).toBe(201)
    expect(store.createCommerceTranslationFeedback).toHaveBeenCalledWith(uuid, expect.objectContaining({ keywordId, action: 'override', overrideKeyword: '省スペース 卓上照明' }))
    const blocked = await fetch(`${origin}/api/revenue/commerce-translations/${uuid}/feedback`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ keywordId, action: 'override', overrideKeyword: 'ダイソー ライト' }) })
    expect(blocked.status).toBe(400)
  })

  it('enqueues description enrichment only through the authenticated server boundary', async () => {
    const store = { enqueueYouTubeDescriptionEnrichment: vi.fn(async () => ({ id: 'enrichment-request-1', created: true, status: 'pending' })) }
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test', YOUTUBE_API_KEY: 'test', OPENAI_API_KEY: 'secret' }
    const denied = await fixture({ store, env, authorize: () => false })
    expect((await fetch(`${denied}/api/revenue/analyses/${uuid}/source-enrichment/jobs`, { method: 'POST', headers: jsonHeaders, body: '{}' })).status).toBe(401)
    const origin = await fixture({ store, env })
    const response = await fetch(`${origin}/api/revenue/analyses/${uuid}/source-enrichment/jobs`, { method: 'POST', headers: jsonHeaders, body: '{}' })
    expect(response.status).toBe(201)
    expect(store.enqueueYouTubeDescriptionEnrichment).toHaveBeenCalledWith(uuid, '2026-10-08', expect.objectContaining({ model: 'gpt-6-luna' }))
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

  it('creates one manual Campaign lineage through the isolated authenticated API', async () => {
    const store = { createManualCampaign: vi.fn(async () => ({ campaignId: uuid, iterationStatus: 'published' })) }
    const origin = await fixture({ store })
    const input = {
      idempotencyKey,
      campaignName: '卓上ライト検証', objective: '訴求の確認', discoveryChannel: 'google_search',
      searchKeyword: '卓上 ライト', merchant: 'Example Shop', productName: '確認済みライト',
      productUrl: 'https://example.com/product', affiliateUrl: '', priceAmount: 3980, currency: 'jpy', productNotes: '人間が商品ページを確認',
      appealHypothesis: '省スペースを訴求', hookText: '暗い机が変わる', contentOutline: '比較して紹介', scriptText: '',
      youtubeVideoId: 'video123', publicationTitle: '公開タイトル', publishedAt: '2026-10-10T01:00:00+09:00',
      translationOrigin: { translationId: uuid, keywordId: uuid, feedbackId: null },
    }
    const denied = await fixture({ store, authorize: () => false })
    expect((await fetch(`${denied}/api/revenue/analyses/${uuid}/campaigns`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })).status).toBe(401)
    const response = await fetch(`${origin}/api/revenue/analyses/${uuid}/campaigns`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })
    expect(response.status).toBe(201)
    expect(store.createManualCampaign).toHaveBeenCalledWith(uuid, expect.objectContaining({
      campaignName: '卓上ライト検証', productUrl: 'https://example.com/product', affiliateUrl: null,
      currency: 'JPY', youtubeVideoId: 'video123', publishedAt: '2026-10-09T16:00:00.000Z',
      translationOrigin: { translationId: uuid, keywordId: uuid, feedbackId: null },
    }))
  })

  it('creates a draft Campaign without requiring a YouTube publication', async () => {
    const store = { createManualCampaign: vi.fn(async () => ({ campaignId: uuid, publicationId: null, iterationStatus: 'draft' })) }
    const origin = await fixture({ store })
    const input = { idempotencyKey, campaignName: '公開前Campaign', discoveryChannel: 'google_search', searchKeyword: 'keyword', merchant: 'shop', productName: 'product', productUrl: 'https://example.com/product', currency: 'JPY', appealHypothesis: 'appeal', hookText: 'hook', contentOutline: 'outline', youtubeVideoId: '' }
    const response = await fetch(`${origin}/api/revenue/analyses/${uuid}/campaigns`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })
    expect(response.status).toBe(201)
    expect((await response.json()).data).toMatchObject({ publicationId: null, iterationStatus: 'draft' })
    expect(store.createManualCampaign).toHaveBeenCalledWith(uuid, expect.objectContaining({ youtubeVideoId: null, publicationTitle: null, publishedAt: null }))
  })

  it('creates a Direct Product Campaign without Opportunity or AI lineage', async () => {
    const store = { createDirectProductCampaign: vi.fn(async () => ({ campaignId: uuid, publicationId: null, iterationStatus: 'draft', lineageKind: 'direct_product', created: true })) }
    const origin = await fixture({ store })
    const input = {
      idempotencyKey, merchant: '自社',
      productName: '確認済み商品', productUrl: 'https://example.com/product', affiliateUrl: '',
      priceAmount: 5000, currency: 'jpy', productCategory: '生活用品', verifiedFacts: '材質と寸法を確認済み',
      cautions: '火気厳禁', productNotes: '', isOwnProduct: true,
      assets: [{ assetUrl: 'https://example.com/hero.jpg', assetKind: 'hero', assetSource: 'self_owned', usagePermission: 'owned', label: '正面' }],
    }
    const response = await fetch(`${origin}/api/revenue/direct-products/campaigns`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })
    expect(response.status).toBe(201)
    expect(store.createDirectProductCampaign).toHaveBeenCalledWith(expect.objectContaining({
      productName: '確認済み商品', productCategory: '生活用品', isOwnProduct: true, currency: 'JPY',
      campaignName: '確認済み商品 · 商品登録', objective: null,
      appealHypothesis: DIRECT_PRODUCT_PLACEHOLDERS.appealHypothesis,
      hookText: DIRECT_PRODUCT_PLACEHOLDERS.hookText,
      contentOutline: DIRECT_PRODUCT_PLACEHOLDERS.contentOutline,
      scriptText: null,
      affiliateUrl: null, assets: [expect.objectContaining({ assetKind: 'hero', usagePermission: 'owned' })],
    }))
    expect(store.createDirectProductCampaign.mock.calls[0][0]).not.toHaveProperty('analysisId')

    const invalid = await fetch(`${origin}/api/revenue/direct-products/campaigns`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ...input, assets: [{ ...input.assets[0], usagePermission: 'assumed' }] }) })
    expect(invalid.status).toBe(400)
  })

  it('generates bounded deterministic lineage placeholders instead of accepting Direct Product creative input', () => {
    const base = { idempotencyKey, merchant: '自社', productName: '長'.repeat(240),
      productUrl: 'https://example.com/product', currency: 'JPY', verifiedFacts: '確認済み',
      isOwnProduct: false, assets: [] }
    const first = directProductInput({ ...base, campaignName: '利用者入力', hookText: '流用禁止' })
    const second = directProductInput(base)
    expect(first.campaignName).toBe(second.campaignName)
    expect(Array.from(first.campaignName)).toHaveLength(120)
    expect(first).toMatchObject({ objective: null, appealHypothesis: DIRECT_PRODUCT_PLACEHOLDERS.appealHypothesis,
      hookText: DIRECT_PRODUCT_PLACEHOLDERS.hookText, contentOutline: DIRECT_PRODUCT_PLACEHOLDERS.contentOutline,
      scriptText: null, productCategory: null })
    expect(first.hookText).not.toContain('流用禁止')
  })

  it('registers a real YouTube publication later and validates only supplied IDs', async () => {
    const store = { registerCampaignPublication: vi.fn(async () => ({ publicationId: uuid, iterationStatus: 'published' })) }
    const origin = await fixture({ store })
    const invalid = await fetch(`${origin}/api/revenue/campaign-iterations/${uuid}/publications`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ youtubeVideoId: 'bad id' }) })
    expect(invalid.status).toBe(400)
    const response = await fetch(`${origin}/api/revenue/campaign-iterations/${uuid}/publications`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ youtubeVideoId: 'realVideo1', publicationTitle: '公開済み', publishedAt: '2026-10-10T12:00:00+09:00' }) })
    expect(response.status).toBe(201)
    expect(store.registerCampaignPublication).toHaveBeenCalledWith(uuid, { youtubeVideoId: 'realVideo1', publicationTitle: '公開済み', publishedAt: '2026-10-10T03:00:00.000Z' })
  })

  it('validates and routes Campaign lifecycle operations without exposing immutable writes', async () => {
    const store = {
      updateDraftCampaignIteration: vi.fn(async () => ({ iterationId: uuid, iterationStatus: 'draft' })),
      createCampaignIteration: vi.fn(async () => ({ iterationId: idempotencyKey, iterationNumber: 2, iterationStatus: 'draft' })),
      hardDeleteDraftCampaign: vi.fn(async () => ({ campaignId: uuid, deleted: true })),
      voidCampaign: vi.fn(async () => ({ campaignId: uuid, status: 'voided', voidReason: 'duplicate' })),
    }
    const origin = await fixture({ store })
    const creative = { appealHypothesis: 'updated appeal', hookText: 'updated hook', contentOutline: 'updated outline', scriptText: '' }
    expect((await fetch(`${origin}/api/revenue/campaign-iterations/${uuid}/draft`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ ...creative, hookText: '' }) })).status).toBe(400)
    const edited = await fetch(`${origin}/api/revenue/campaign-iterations/${uuid}/draft`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(creative) })
    expect(edited.status).toBe(200)
    expect(store.updateDraftCampaignIteration).toHaveBeenCalledWith(uuid, { ...creative, scriptText: null })
    const created = await fetch(`${origin}/api/revenue/campaigns/${uuid}/iterations`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ sourceIterationId: idempotencyKey, ...creative }) })
    expect(created.status).toBe(201)
    expect(store.createCampaignIteration).toHaveBeenCalledWith(uuid, idempotencyKey, { ...creative, scriptText: null })
    const invalidVoid = await fetch(`${origin}/api/revenue/campaigns/${uuid}/void`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ reason: 'other', note: '' }) })
    expect(invalidVoid.status).toBe(400)
    const voided = await fetch(`${origin}/api/revenue/campaigns/${uuid}/void`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ reason: 'duplicate', note: '二重登録' }) })
    expect(voided.status).toBe(200)
    expect(store.voidCampaign).toHaveBeenCalledWith(uuid, { reason: 'duplicate', note: '二重登録' })
    const deleted = await fetch(`${origin}/api/revenue/campaigns/${uuid}`, { method: 'DELETE', headers: jsonHeaders })
    expect(deleted.status).toBe(200)
    expect(store.hardDeleteDraftCampaign).toHaveBeenCalledWith(uuid)
  })

  it('returns a sealed conflict when evidence makes a Campaign immutable', async () => {
    const store = { hardDeleteDraftCampaign: vi.fn(async () => { throw Object.assign(new Error('private database detail'), { code: 'CAMPAIGN_OPERATION_CONFLICT', status: 409 }) }) }
    const origin = await fixture({ store })
    const response = await fetch(`${origin}/api/revenue/campaigns/${uuid}`, { method: 'DELETE', headers: jsonHeaders })
    expect(response.status).toBe(409)
    const text = await response.text()
    expect(text).toContain('CAMPAIGN_OPERATION_CONFLICT')
    expect(text).not.toContain('private database detail')
  })

  it('queues one immutable Creative Production revision with server-selected model', async () => {
    const store = { enqueueCreativeProduction: vi.fn(async () => ({ requestId: uuid, revisionNumber: 1, created: true })) }
    const env = {
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', YOUTUBE_API_KEY: 'test-only',
      OPENAI_API_KEY: 'secret', REVENUE_LAB_CREATIVE_PRODUCTION_MODEL: 'gpt-test',
    }
    const origin = await fixture({ store, env })
    const response = await fetch(`${origin}/api/revenue/campaign-iterations/${uuid}/production-plans`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey }),
    })
    expect(response.status).toBe(201)
    expect(store.enqueueCreativeProduction).toHaveBeenCalledWith(uuid, { idempotencyKey, model: 'gpt-test' })
    expect(JSON.stringify(await response.json())).not.toContain('secret')
  })

  it('requires OpenAI configuration and a UUID idempotency key for Creative Production', async () => {
    const store = { enqueueCreativeProduction: vi.fn() }
    const origin = await fixture({ store })
    const missing = await fetch(`${origin}/api/revenue/campaign-iterations/${uuid}/production-plans`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey }),
    })
    expect(missing.status).toBe(503)
    const configured = await fixture({ store, env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', YOUTUBE_API_KEY: 'test-only', OPENAI_API_KEY: 'secret' } })
    const invalid = await fetch(`${configured}/api/revenue/campaign-iterations/${uuid}/production-plans`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey: 'not-a-uuid' }),
    })
    expect(invalid.status).toBe(400)
    expect(store.enqueueCreativeProduction).not.toHaveBeenCalled()
  })

  it('queues Pollo generation only through server-selected provider configuration', async () => {
    const store = { enqueueVideoGeneration: vi.fn(async () => ({ runId: uuid, sceneGenerationId: idempotencyKey, created: true })) }
    const env = {
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', YOUTUBE_API_KEY: 'test-only',
      POLLO_API_KEY: 'private-pollo-key', REVENUE_LAB_POLLO_MODEL: 'pollo-v2-5',
    }
    const origin = await fixture({ store, env })
    const response = await fetch(`${origin}/api/revenue/creative-production-plans/${uuid}/scenes/2/video-generations`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey, regenerate: true }),
    })
    expect(response.status).toBe(201)
    expect(store.enqueueVideoGeneration).toHaveBeenCalledWith(uuid, 2, {
      idempotencyKey, regenerate: true, model: 'pollo-v2-5', provider: 'pollo', providerVersion: 'platform-v1', resolution: '480p',
    })
    const serialized = JSON.stringify(await response.json())
    expect(serialized).not.toContain('private-pollo-key')
    expect(serialized).not.toContain('x-api-key')
  })

  it('reports only the missing Pollo variable name and rejects malformed scene requests', async () => {
    const store = { enqueueVideoGeneration: vi.fn() }
    const origin = await fixture({ store })
    const missing = await fetch(`${origin}/api/revenue/creative-production-plans/${uuid}/scenes/1/video-generations`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey }),
    })
    expect(missing.status).toBe(503)
    expect(await missing.text()).toContain('POLLO_API_KEY')
    const configured = await fixture({ store, env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', YOUTUBE_API_KEY: 'test-only', POLLO_API_KEY: 'private-pollo-key' } })
    const invalid = await fetch(`${configured}/api/revenue/creative-production-plans/${uuid}/scenes/0/video-generations`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ idempotencyKey: 'bad' }),
    })
    expect(invalid.status).toBe(400)
    expect(store.enqueueVideoGeneration).not.toHaveBeenCalled()
    const status = configurationStatus({ POLLO_API_KEY: 'private-pollo-key' })
    expect(status.videoGeneration).toMatchObject({ configured: true, provider: 'pollo', providerVersion: 'platform-v1', requestedModel: 'pollo-v2', audioEnabled: false })
    expect(JSON.stringify(status)).not.toContain('private-pollo-key')
  })

  it('starts Desktop OAuth and manually collects one publication date range', async () => {
    const env = {
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-only', YOUTUBE_API_KEY: 'test-only',
      YOUTUBE_ANALYTICS_CLIENT_ID: 'desktop-id', YOUTUBE_ANALYTICS_CLIENT_SECRET: 'desktop-secret',
    }
    const analyticsService = {
      startAuthorization: vi.fn(async () => ({ status: 'authorizing', errorCode: null })),
      connectionStatus: vi.fn(async () => ({ flow: { status: 'idle', errorCode: null }, connection: null })),
      collect: vi.fn(async () => ({ id: uuid, status: 'succeeded', views: 42 })), close: vi.fn(),
    }
    const store = { dashboard: vi.fn(async () => ({ queries: [], opportunities: [], trackingOpportunities: [], campaigns: [] })) }
    const origin = await fixture({ env, store, analyticsService })
    const start = await fetch(`${origin}/api/revenue/youtube-analytics/oauth/start`, { method: 'POST', headers: jsonHeaders, body: '{}' })
    expect(start.status).toBe(202)
    expect(await start.json()).toEqual({ data: { status: 'authorizing', errorCode: null } })
    const collected = await fetch(`${origin}/api/revenue/campaign-publications/${uuid}/youtube-analytics/runs`, {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ startDate: '2026-10-01', endDate: '2026-10-09' }),
    })
    expect(collected.status).toBe(201)
    expect(analyticsService.collect).toHaveBeenCalledWith(uuid, { startDate: '2026-10-01', endDate: '2026-10-09' })
    expect(JSON.stringify(await collected.json())).not.toContain('desktop-secret')
  })

  it('rejects invalid Analytics date ranges before collection', () => {
    expect(() => analyticsDateRangeInput({ startDate: '2026-10-10', endDate: '2026-10-09' })).toThrow(TypeError)
    expect(() => analyticsDateRangeInput({ startDate: '2025-01-01', endDate: '2026-10-09' })).toThrow(TypeError)
    expect(analyticsDateRangeInput({ startDate: '2026-10-01', endDate: '2026-10-09' })).toEqual({ startDate: '2026-10-01', endDate: '2026-10-09' })
  })

  it('returns the existing Campaign for an idempotent replay', async () => {
    const store = { createManualCampaign: vi.fn(async () => ({ campaignId: uuid, iterationStatus: 'draft', created: false, idempotentReplay: true })) }
    const origin = await fixture({ store })
    const input = { idempotencyKey, campaignName: 'Campaign', discoveryChannel: 'direct', searchKeyword: 'keyword', merchant: 'shop', productName: 'product', productUrl: 'https://example.com/product', currency: 'JPY', appealHypothesis: 'appeal', hookText: 'hook', contentOutline: 'outline' }
    const response = await fetch(`${origin}/api/revenue/analyses/${uuid}/campaigns`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(input) })
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({ campaignId: uuid, created: false, idempotentReplay: true })
    expect(store.createManualCampaign).toHaveBeenCalledWith(uuid, expect.objectContaining({ idempotencyKey }))
  })

  it('rejects insecure product URLs and malformed YouTube IDs before storage', async () => {
    const store = { createManualCampaign: vi.fn() }
    const origin = await fixture({ store })
    const base = { idempotencyKey, campaignName: 'test', discoveryChannel: 'direct', searchKeyword: 'keyword', merchant: 'shop', productName: 'product', productUrl: 'https://example.com/product', currency: 'JPY', appealHypothesis: 'appeal', hookText: 'hook', contentOutline: 'outline', youtubeVideoId: 'video123' }
    expect((await fetch(`${origin}/api/revenue/analyses/${uuid}/campaigns`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ...base, productUrl: 'http://example.com' }) })).status).toBe(400)
    expect((await fetch(`${origin}/api/revenue/analyses/${uuid}/campaigns`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ ...base, youtubeVideoId: 'bad id' }) })).status).toBe(400)
    expect(store.createManualCampaign).not.toHaveBeenCalled()
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
