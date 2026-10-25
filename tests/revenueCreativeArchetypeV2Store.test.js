import { describe, expect, it, vi } from 'vitest'
import { createSupabaseStore } from '../scripts/revenue-lab/supabase-store.cjs'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const response = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), {
  status, headers: body == null ? {} : { 'content-type': 'application/json' },
})

describe('Creative Archetype v2 store', () => {
  it('creates v2 lineage with ordered 1-4 revision arrays through the dedicated RPC', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body })
      if (url.includes('/projects?')) return response([{ id: uuid(1) }])
      if (url.includes('/rpc/create_three_picks_v2_campaign')) return response({ campaignId: uuid(2), created: true })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.createThreePicksV2Campaign({ idempotencyKey: uuid(90), campaignName: 'v2 test', items: [1, 2, 3].map(index => ({
      curatedProductId: uuid(index + 10), productAssetRevisionIds: [uuid(index + 20), uuid(index + 30)], verifiedFactRef: 'summary',
    })) })
    const rpc = calls.find(call => call.url.includes('/rpc/create_three_picks_v2_campaign'))
    expect(rpc.body.p_payload).toMatchObject({ archetype: 'three_picks_v2', selection_mode: 'human' })
    expect(rpc.body.p_payload.items[0].asset_revision_ids).toEqual([uuid(21), uuid(31)])
    expect(rpc.body.p_selection_fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('loads v2 item assets into planner input and calls only the v2 enqueue RPC', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body })
      if (url.includes('/campaign_iterations?')) return response([{ id: uuid(1), campaign_id: uuid(2), product_set_id: uuid(3), curated_product_id: null }])
      if (url.includes('/campaigns?')) return response([{ id: uuid(2), name: 'v2', objective: null }])
      if (url.includes('/campaign_product_sets?')) return response([{ id: uuid(3), archetype: 'three_picks_v2', status: 'locked' }])
      if (url.includes('/campaign_product_set_items?')) return response([
        { name: '車用ゴミ箱 LEDライト付き 折りたたみ式 マグネット固定', fact: 'LEDライト付き。折りたたみ式。マグネット固定（取り外し可能）。' },
        { name: 'スマホホルダー 車 マグネット 車載ホルダー N56', fact: 'N56磁石を採用。スマホを悪路でもホールド。' },
        { name: '車用 カーアロマディフューザー USB式', fact: '6種類の香り。1本で約2週間。USB接続。' },
      ].map((item, index) => ({ id: uuid(11 + index), product_name_snapshot: item.name,
        verified_fact_ref: 'summary', verified_fact_snapshot: { key: 'summary', value: item.fact },
        presentation_order: index + 1 })))
      if (url.includes('/campaign_product_set_item_assets?')) return response([1, 2, 3].map(index => ({ product_set_item_id: uuid(10 + index),
        product_asset_revision_id: uuid(20 + index), asset_order: 1, content_sha256_snapshot: 'a'.repeat(64) })))
      if (url.includes('/rpc/enqueue_three_picks_v2_plan')) return response({ requestId: uuid(50), created: true })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.enqueueThreePicksV2Plan(uuid(1), { idempotencyKey: uuid(99), model: 'gpt-test' })
    const rpc = calls.find(call => call.url.includes('/rpc/enqueue_three_picks_v2_plan'))
    expect(rpc.body.p_input_snapshot.contract).toMatchObject({ archetype: 'three_picks_v2', template_id: 'hero-carousel-v2',
      prompt_version: 'three-picks-production-planner-v4', schema_version: 'multi-product-shorts-plan-v5' })
    expect(rpc.body).toMatchObject({ p_prompt_version: 'three-picks-production-planner-v4',
      p_schema_version: 'multi-product-shorts-plan-v5' })
    expect(rpc.body.p_input_snapshot.products[0].asset_revisions).toHaveLength(1)
    expect(rpc.body.p_input_snapshot.products[0]).toMatchObject({
      source_product_name: '車用ゴミ箱 LEDライト付き 折りたたみ式 マグネット固定',
      fact_candidates: [
        { id: 'summary-1', verified_fact_ref: 'summary', text: 'LEDライト付き' },
        { id: 'summary-2', verified_fact_ref: 'summary', text: '折りたたみ式' },
        { id: 'summary-3', verified_fact_ref: 'summary', text: 'マグネット固定(取り外し可能)' },
      ] })
    expect(rpc.body.p_input_snapshot.products[0].identity_candidates[0]).toMatchObject({
      display_name: '車載ダストボックス',
    })
    expect(rpc.body.p_input_snapshot.products[0].fact_candidates[0].facts[0]).toMatchObject({
      type: 'feature', key: 'led', display_text: 'LED搭載',
    })
    expect(rpc.body.p_input_snapshot.products[0].display_name).toBeUndefined()
    expect(rpc.body.p_input_snapshot.products[0].fact_badge).toBeUndefined()
    expect(rpc.body.p_input_snapshot.products[0].verified_fact).toBeUndefined()
    expect(calls.some(call => call.url.includes('/rpc/enqueue_three_picks_plan'))).toBe(false)
  })

  it('maps an unusable verified fact to a safe evidence preparation error before RPC', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null })
      if (url.includes('/campaign_iterations?')) return response([{ id: uuid(1), campaign_id: uuid(2), product_set_id: uuid(3), curated_product_id: null }])
      if (url.includes('/campaigns?')) return response([{ id: uuid(2), name: 'v2', objective: null }])
      if (url.includes('/campaign_product_sets?')) return response([{ id: uuid(3), archetype: 'three_picks_v2', status: 'locked' }])
      if (url.includes('/campaign_product_set_items?')) return response([1, 2, 3].map(index => ({
        id: uuid(10 + index), product_name_snapshot: ['車用ゴミ箱', 'マグネット式スマホホルダー', '車載アロマディフューザー'][index - 1],
        verified_fact_ref: 'summary',
        verified_fact_snapshot: { key: 'summary', value: index === 1 ? 'LEDライト付き'
          : index === 2 ? 'A'.repeat(121) : '6種類の香り' }, presentation_order: index,
      })))
      if (url.includes('/campaign_product_set_item_assets?')) return response([1, 2, 3].map(index => ({
        product_set_item_id: uuid(10 + index), product_asset_revision_id: uuid(20 + index),
        asset_order: 1, content_sha256_snapshot: 'a'.repeat(64),
      })))
      if (url.includes('/rpc/enqueue_three_picks_v2_plan')) return response({ requestId: uuid(50), created: true })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await expect(store.enqueueThreePicksV2Plan(uuid(1), { idempotencyKey: uuid(99) })).rejects.toMatchObject({
      code: 'REVENUE_EVIDENCE_PREPARATION_FAILED', status: 422,
      message: '商品情報から動画用の根拠データを作成できませんでした。商品説明の形式を確認してください。',
    })
    expect(calls.some(call => call.url.includes('/rpc/enqueue_three_picks_v2_plan'))).toBe(false)
  })

  it('preserves a safe typed-fact-missing error with the product index before RPC', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null })
      if (url.includes('/campaign_iterations?')) return response([{ id: uuid(1), campaign_id: uuid(2), product_set_id: uuid(3), curated_product_id: null }])
      if (url.includes('/campaigns?')) return response([{ id: uuid(2), name: 'v2', objective: null }])
      if (url.includes('/campaign_product_sets?')) return response([{ id: uuid(3), archetype: 'three_picks_v2', status: 'locked' }])
      if (url.includes('/campaign_product_set_items?')) return response([
        { name: '車用ゴミ箱', fact: 'LEDライト付き' },
        { name: 'マグネット式スマホホルダー', fact: '毎日の運転を快適にします' },
        { name: '車載アロマディフューザー', fact: '6種類の香り' },
      ].map((item, index) => ({ id: uuid(11 + index), product_name_snapshot: item.name,
        verified_fact_ref: 'summary', verified_fact_snapshot: { key: 'summary', value: item.fact },
        presentation_order: index + 1 })))
      if (url.includes('/campaign_product_set_item_assets?')) return response([1, 2, 3].map(index => ({
        product_set_item_id: uuid(10 + index), product_asset_revision_id: uuid(20 + index),
        asset_order: 1, content_sha256_snapshot: 'a'.repeat(64),
      })))
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await expect(store.enqueueThreePicksV2Plan(uuid(1), { idempotencyKey: uuid(99) })).rejects.toMatchObject({
      code: 'TYPED_FACT_CANDIDATE_MISSING', status: 422, productIndex: 2,
      reason: 'no safe typed fact candidate could be compiled',
    })
    expect(calls.some(call => call.url.includes('/rpc/enqueue_three_picks_v2_plan'))).toBe(false)
  })

  it('persists deterministic narration segments as provider-neutral planned audio artifacts', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body })
      if (url.includes('/creative_archetype_plans')) return response([{ id: uuid(70) }])
      if (url.includes('/creative_audio_artifacts')) return response(null, 204)
      if (url.includes('/creative_archetype_requests?')) return response(null, 204)
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const products = [1, 2, 3].map(index => ({ product_set_item_id: uuid(10 + index), presentation_order: index,
      display_name: `商品${index}`, short_appeal: '短い訴求', fact_badge: `事実${index}`,
      verified_fact_ref: 'summary', tts: `商品${index}の確認済みポイントです。` }))
    const saved = await store.persistThreePicksV2Success({ id: uuid(60), projectId: uuid(1), campaignId: uuid(2),
      iterationId: uuid(3), productSetId: uuid(4), revisionNumber: 1, schemaVersion: 'multi-product-shorts-plan-v3' }, {
      productionPlan: { archetype: 'three_picks_v2', theme: '3選', hook: { display_text: 'Hook', tts: '三つを紹介します。' },
        product_presentations: products, cta: { display_text: '詳細を見る', tts: '詳細を確認してください。' } },
      resolvedModel: 'gpt-test', responseId: 'resp-1', usage: {},
    })
    expect(saved).toMatchObject({ planId: uuid(70), audioStatus: 'planned' })
    const artifactCall = calls.find(call => call.url.includes('/creative_audio_artifacts'))
    expect(artifactCall.body.length).toBeGreaterThanOrEqual(5)
    expect(artifactCall.body.every(item => item.status === 'planned' && item.provider == null && item.audio_sha256 == null)).toBe(true)
    expect(artifactCall.body.map(item => item.segment_id)).toContain('hook-1')
  })

  it('uses only dedicated RPCs to enqueue, claim, record, complete, and fail audio generation', async () => {
    const calls = []
    const row = { id: uuid(100), creative_archetype_plan_id: uuid(70), scene_id: 'hook', segment_id: 'hook-1',
      segment_order: 1, input_text: '紹介します。', input_sha256: 'a'.repeat(64), status: 'generating',
      provider: 'elevenlabs', provider_adapter_version: 'elevenlabs-tts-adapter-v1', model: 'model', voice: 'voice',
      stable_seed: 1, generation_fingerprint: 'f'.repeat(64), output_format: 'mp3_44100_128',
      storage_bucket: 'revenue-lab-creative-audio' }
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body })
      if (url.includes('/rpc/enqueue_creative_audio_generation_v1')) return response({ created: true, artifactCount: 1 })
      if (url.includes('/rpc/claim_creative_audio_generation_v1')) return response({ claimed: true, artifact: row })
      if (url.includes('/rpc/record_creative_audio_provider_receipt_v1')) return response({ ...row, provider_request_id: 'req-1' })
      if (url.includes('/rpc/complete_creative_audio_generation_v1')) return response({ ...row, status: 'ready' })
      if (url.includes('/rpc/fail_creative_audio_generation_v1')) return response({ ...row, status: 'submission_uncertain' })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.enqueueCreativeAudioGeneration(uuid(70), { provider: 'elevenlabs', providerAdapterVersion: 'elevenlabs-tts-adapter-v1',
      model: 'model', voice: 'voice', outputFormat: 'mp3_44100_128', voiceSettings: { stability: 0.5 },
      fingerprintSchemaVersion: 'creative-audio-generation-v1', storageBucket: 'revenue-lab-creative-audio', idempotencyKey: uuid(99) })
    const claim = await store.claimCreativeAudioGeneration(uuid(100), 'f'.repeat(64))
    expect(claim).toMatchObject({ claimed: true, artifact: { providerAdapterVersion: 'elevenlabs-tts-adapter-v1' } })
    const receipt = { audioSha256: 'b'.repeat(64), durationSeconds: 1.2, byteSize: 100,
      providerRequestId: 'req-1', providerTraceId: 'trace-1', characterCost: 10 }
    await store.recordCreativeAudioProviderReceipt(uuid(100), 'f'.repeat(64), receipt)
    await store.completeCreativeAudioGeneration(uuid(100), 'f'.repeat(64), receipt)
    await store.failCreativeAudioGeneration(uuid(100), 'f'.repeat(64), {
      status: 'submission_uncertain', safeErrorCode: 'TEST_UNCERTAIN' })
    expect(calls.map(call => call.url)).toEqual(expect.arrayContaining([
      expect.stringContaining('/rpc/enqueue_creative_audio_generation_v1'),
      expect.stringContaining('/rpc/claim_creative_audio_generation_v1'),
      expect.stringContaining('/rpc/record_creative_audio_provider_receipt_v1'),
      expect.stringContaining('/rpc/complete_creative_audio_generation_v1'),
      expect.stringContaining('/rpc/fail_creative_audio_generation_v1'),
    ]))
  })

  it('enqueues exactly one Creative Audio Artifact through the dedicated RPC', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body })
      if (url.includes('/rpc/enqueue_creative_audio_artifact_generation_v1')) {
        return response({ artifactId: uuid(100), planId: uuid(70), created: true, createdCount: 1 })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const result = await store.enqueueCreativeAudioArtifactGeneration(uuid(100), {
      provider: 'elevenlabs', providerAdapterVersion: 'elevenlabs-tts-adapter-v1',
      model: 'model', voice: 'voice', outputFormat: 'mp3_44100_128', voiceSettings: { stability: 0.5 },
      fingerprintSchemaVersion: 'creative-audio-generation-v1', storageBucket: 'revenue-lab-creative-audio',
      idempotencyKey: uuid(99),
    })
    expect(result).toMatchObject({ artifactId: uuid(100), createdCount: 1 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: expect.stringContaining('/rpc/enqueue_creative_audio_artifact_generation_v1'),
      body: { p_artifact_id: uuid(100), p_provider: 'elevenlabs',
        p_provider_adapter_version: 'elevenlabs-tts-adapter-v1', p_model: 'model', p_voice: 'voice',
        p_output_format: 'mp3_44100_128', p_voice_settings: { stability: 0.5 },
        p_fingerprint_schema_version: 'creative-audio-generation-v1',
        p_storage_bucket: 'revenue-lab-creative-audio', p_idempotency_key: uuid(99) },
    })
  })

  it('compiles ready measured audio into a layer manifest before the dedicated v2 composition RPC', async () => {
    const calls = []
    let schemaVersion = 'multi-product-shorts-plan-v5'
    const presentations = [1, 2, 3].map(index => ({ product_set_item_id: uuid(10 + index), presentation_order: index,
      display_name: `商品${index}`, short_appeal: '短い訴求', fact_badge: `事実${index}`,
      verified_fact_ref: 'summary', tts: `商品${index}です。` }))
    const plan = { id: uuid(70), request_id: uuid(60), revision_number: 1, project_id: uuid(1), campaign_id: uuid(2),
      campaign_iteration_id: uuid(3), product_set_id: uuid(4), archetype: 'three_picks_v2',
      output_json: { archetype: 'three_picks_v2', theme: '3選', hook: { display_text: 'Hook', tts: '紹介します。' },
        product_presentations: presentations, cta: { display_text: '詳細を見る', tts: '確認してください。' } } }
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body })
      if (url.includes('/creative_archetype_plans?')) return response([plan])
      if (url.includes('/creative_archetype_requests?')) return response([{ schema_version: schemaVersion }])
      if (url.includes('/campaign_product_set_items?')) return response([1, 2, 3].map(index => ({ id: uuid(10 + index), presentation_order: index })))
      if (url.includes('/campaign_product_set_item_assets?')) return response([1, 2, 3].map(index => ({ product_set_item_id: uuid(10 + index),
        product_asset_revision_id: uuid(20 + index), asset_order: 1, content_sha256_snapshot: 'b'.repeat(64) })))
      if (url.includes('/creative_audio_artifacts?')) return response(['hook-1', 'product-1-1', 'product-2-1', 'product-3-1', 'cta-1'].map((segmentId, index) => ({
        id: uuid(100 + index), segment_id: segmentId, segment_order: 1, status: 'ready', duration_seconds: 1.1,
        immutable_object_key: `creative-audio/${uuid(70)}/${segmentId}/${'a'.repeat(64)}.mp3`, audio_sha256: 'a'.repeat(64),
      })))
      if (url.includes('/rpc/enqueue_final_composition_v2')) return response({ compositionRequestId: uuid(80), created: true })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.enqueueFinalCompositionV2(plan.id, { idempotencyKey: uuid(90) })
    const rpc = calls.find(call => call.url.includes('/rpc/enqueue_final_composition_v2'))
    expect(rpc.body.p_provider_version).toBe('local-shorts-composer-v2')
    expect(rpc.body.p_render_manifest).toMatchObject({ manifest_version: 'three-picks-composition-manifest-v3',
      template_id: 'hero-carousel-v2', output: { audio: true } })
    expect(rpc.body.p_render_manifest.product_cards).toBeUndefined()
    schemaVersion = 'multi-product-shorts-plan-v4'; calls.length = 0
    await store.enqueueFinalCompositionV2(plan.id, { idempotencyKey: uuid(92) })
    const v4Rpc = calls.find(call => call.url.includes('/rpc/enqueue_final_composition_v2'))
    expect(v4Rpc.body.p_render_manifest).toMatchObject({ manifest_version: 'three-picks-composition-manifest-v3',
      layout_id: 'hero-product-layout-v2' })
    schemaVersion = 'multi-product-shorts-plan-v3'; calls.length = 0
    await store.enqueueFinalCompositionV2(plan.id, { idempotencyKey: uuid(91) })
    const legacyRpc = calls.find(call => call.url.includes('/rpc/enqueue_final_composition_v2'))
    expect(legacyRpc.body.p_render_manifest).toMatchObject({ manifest_version: 'three-picks-composition-manifest-v2',
      layout_id: 'hero-product-layout-v1' })
  })
})
