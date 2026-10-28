import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createSupabaseStore, opportunityFromRow, queryFromRow } = require('../scripts/revenue-lab/supabase-store.cjs')

function response(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: body == null ? {} : { 'content-type': 'application/json' },
  })
}

describe('Revenue Lab Supabase store snapshots', () => {
  it('freezes metadata-only Commerce Translation input and delegates cache identity to its fingerprint RPC', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null
      calls.push({ url, body })
      if (url.includes('/ai_opportunity_analyses?')) return response([{ id: 'analysis-1', analysis_request_id: 'request-1', output_json: { product_or_theme_name: 'ダイソー便利品', similar_product_categories: ['収納'], product_search_keywords: ['100均 収納'] } }])
      if (url.includes('/ai_analysis_requests?')) return response([{ id: 'request-1', project_id: 'project-1', source_item_id: 'item-1', input_snapshot: { video: { title: 'ダイソー 収納' }, source_queries: [{ query_text: '100均 便利' }] } }])
      if (url.includes('/rpc/enqueue_commerce_translation')) return response({ id: 'translation-request-1', created: true, cached: false })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.enqueueCommerceTranslation('analysis-1', { model: 'gpt-test' })
    const rpcCall = calls.find(call => call.url.includes('/rpc/enqueue_commerce_translation'))
    expect(rpcCall.body.p_input_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(rpcCall.body.p_input_snapshot).toMatchObject({ translation_basis: 'metadata_only', source_enrichment: { id: null, content_fingerprint: null, included: false } })
    expect(rpcCall.body.p_input_snapshot.term_policy.retailerSourceTerms.length).toBeGreaterThan(0)
    expect(rpcCall.body.p_source_enrichment_id).toBeNull()
  })

  it('freezes description enrichment identity and deterministically removes retailer terms before translation', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body })
      if (url.includes('/ai_opportunity_analyses?')) return response([{ id: 'analysis-1', analysis_request_id: 'request-1', output_json: { product_or_theme_name: '収納', similar_product_categories: ['収納用品'], product_search_keywords: ['収納'] } }])
      if (url.includes('/ai_analysis_requests?')) return response([{ id: 'request-1', project_id: 'project-1', source_item_id: 'item-1', input_snapshot: { video: { title: '収納' }, source_queries: [] } }])
      if (url.includes('/rpc/enqueue_commerce_translation')) return response({ id: 'translation-request-2', created: true })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.enqueueCommerceTranslation('analysis-1', { model: 'gpt-test', sourceEnrichment: {
      id: 'enrichment-1', content: 'ダイソーの吊り下げ式バッグ収納。URLを開け https://example.com',
      contentFingerprint: 'e'.repeat(64), capturedAt: '2026-10-11T00:00:00Z', providerEtag: 'etag-1', availabilityStatus: 'available',
    } })
    const body = calls.find(call => call.url.includes('/rpc/enqueue_commerce_translation')).body
    expect(body.p_prompt_version).toBe('commerce-translator-description-v1')
    expect(body.p_source_enrichment_id).toBe('enrichment-1')
    expect(body.p_source_enrichment_fingerprint).toBe('e'.repeat(64))
    expect(body.p_input_snapshot.source_enrichment).toMatchObject({ id: 'enrichment-1', content_fingerprint: 'e'.repeat(64), included: true, description_is_untrusted: true })
    expect(body.p_input_snapshot.source_enrichment.description_text).not.toContain('ダイソー')
    expect(body.p_input_snapshot.source_enrichment.description_text).toContain('吊り下げ式バッグ収納')
  })

  it('appends a frozen YouTube description snapshot and queues a separately fingerprinted translation', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null
      calls.push({ url, method: options.method, body })
      if (url.includes('/source_item_enrichments?select=*')) return response([{
        id: 'enrichment-1', source_item_id: 'item-1', content: 'セリアの吊り下げバッグ収納',
        content_fingerprint: body.content_fingerprint, provider_etag: 'etag-1',
        captured_at: '2026-10-11T00:00:00.000Z', availability_status: 'available',
      }])
      if (url.includes('/ai_opportunity_analyses?')) return response([{ id: 'analysis-1', analysis_request_id: 'analysis-request-1', output_json: { product_or_theme_name: '収納', similar_product_categories: ['収納用品'], product_search_keywords: ['収納'] } }])
      if (url.includes('/ai_analysis_requests?')) return response([{ id: 'analysis-request-1', project_id: 'project-1', source_item_id: 'item-1', input_snapshot: { video: { title: '収納' }, source_queries: [] } }])
      if (url.includes('/rpc/enqueue_commerce_translation')) return response({ id: 'translation-request-1', created: true })
      if (url.includes('/source_enrichment_requests?')) return response(null, 204)
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const saved = await store.persistSourceEnrichmentSuccess({
      id: 'enrichment-request-1', analysisId: 'analysis-1', sourceItemId: 'item-1', requestedModel: 'gpt-test',
    }, {
      content: 'セリアの吊り下げバッグ収納', providerEtag: 'etag-1',
      capturedAt: '2026-10-11T00:00:00.000Z', availabilityStatus: 'available',
    })

    expect(saved).toEqual({ enrichmentId: 'enrichment-1', translationRequestId: 'translation-request-1', availabilityStatus: 'available' })
    const snapshot = calls.find(call => call.url.includes('/source_item_enrichments?select=*')).body
    expect(snapshot).toMatchObject({
      source_item_id: 'item-1', source_enrichment_request_id: 'enrichment-request-1',
      provider: 'youtube', enrichment_kind: 'video_description', provider_etag: 'etag-1',
      captured_at: '2026-10-11T00:00:00.000Z', availability_status: 'available',
    })
    expect(snapshot.content_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    const translation = calls.find(call => call.url.includes('/rpc/enqueue_commerce_translation')).body
    expect(translation.p_source_enrichment_id).toBe('enrichment-1')
    expect(translation.p_source_enrichment_fingerprint).toBe(snapshot.content_fingerprint)
    expect(translation.p_input_snapshot.translation_basis).toBe('metadata_plus_youtube_description')
    expect(translation.p_input_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    const completion = calls.find(call => call.url.includes('/source_enrichment_requests?')).body
    expect(completion).toMatchObject({ status: 'succeeded', enrichment_id: 'enrichment-1', translation_request_id: 'translation-request-1', availability_status: 'available' })
  })

  it('does not fall back to Analyst keywords for provider search', async () => {
    const fetchImpl = vi.fn(async url => {
      if (url.includes('/ai_opportunity_analyses?')) return response([{ id: 'analysis-1', output_json: { product_search_keywords: ['100均 収納'] } }])
      if (url.includes('/commerce_translation_requests?')) return response([])
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await expect(store.enqueueProductSearch('analysis-1', '2026-10-11')).rejects.toMatchObject({ code: 'COMMERCE_TRANSLATION_REQUIRED' })
  })

  it('keeps tracking relation IDs on opportunities instead of query records', () => {
    expect(opportunityFromRow({ source_item_id: 'item-1', tracking_run_id: 'tracking-run-1' })).toMatchObject({
      sourceItemId: 'item-1', trackingRunId: 'tracking-run-1',
    })
    expect(queryFromRow({ source_item_id: 'wrong-item', tracking_run_id: 'wrong-run' })).not.toHaveProperty('sourceItemId')
  })

  it('uses one uniform key set for mixed video and channel bulk inserts', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null })
      if (url.includes('/source_items?')) return response([
        { id: 'video-item', item_type: 'video', external_id: 'video-1' },
        { id: 'channel-item', item_type: 'channel', external_id: 'channel-1' },
      ])
      if (url.includes('/source_item_snapshots?')) return response([
        { id: 'video-snapshot', source_item_id: 'video-item' },
        { id: 'channel-snapshot', source_item_id: 'channel-item' },
      ])
      return response(null, 204)
    })
    const store = createSupabaseStore({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'test-only',
      fetchImpl,
    })
    await store.persistCollection({
      runId: 'run-1',
      jobId: 'job-1',
      query: { id: 'query-1', sourceId: 'source-1', maxResults: 25 },
      videos: [{
        youtubeVideoId: 'video-1', title: '動画', channelId: 'channel-1', channelTitle: 'チャンネル',
        publishedAt: '2026-10-07T00:00:00.000Z', capturedAt: '2026-10-08T00:00:00.000Z',
        viewCount: 100, likeCount: null, commentCount: 3, subscriberCount: 500,
        hiddenSubscriberCount: false, searchPosition: 1, thumbnailUrl: null,
      }],
      opportunities: [],
      excludedReason: null,
    })

    const snapshotCall = calls.find(call => call.url.includes('/source_item_snapshots?'))
    expect(snapshotCall.body).toHaveLength(2)
    const expectedKeys = [
      'capture_job_id', 'capture_kind', 'captured_at', 'comment_count', 'hidden_subscriber_count', 'like_count', 'metrics',
      'source_item_id', 'subscriber_count', 'view_count',
    ]
    for (const row of snapshotCall.body) expect(Object.keys(row).sort()).toEqual(expectedKeys)
    expect(snapshotCall.body[0]).toMatchObject({
      source_item_id: 'video-item', view_count: 100, like_count: null, comment_count: 3,
      subscriber_count: null, hidden_subscriber_count: false,
    })
    expect(snapshotCall.body[1]).toMatchObject({
      source_item_id: 'channel-item', view_count: null, like_count: null, comment_count: null,
      subscriber_count: 500, hidden_subscriber_count: false,
    })
  })

  it('retains a safe PostgREST diagnostic without request headers or credentials', async () => {
    const fetchImpl = vi.fn(async () => response({
      code: 'PGRST102', message: 'All object keys must match', details: null, hint: null,
    }, 400))
    const store = createSupabaseStore({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'secret-must-not-appear',
      fetchImpl,
    })
    await expect(store.listQueries()).rejects.toMatchObject({
      code: 'SUPABASE_HTTP_ERROR', status: 400, providerCode: 'PGRST102',
      providerMessage: 'All object keys must match',
    })
  })

  it('enriches dashboard opportunities from canonical URLs and latest snapshots', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.includes('/rpc/dashboard_snapshot')) return response({
        queries: [{ id: 'query-1', source_id: 'source-1', label: 'Theme', query_text: 'query', enabled: true }], latest_job: null, opportunities: [{
          id: 'opportunity-1', source_query_id: 'query-1', youtube_video_id: 'video-1',
          channel_id: 'channel-1', title: '動画', channel_title: 'チャンネル', published_at: '2026-10-07T00:00:00Z',
          score_version: 'youtube-v1', velocity_mode: 'estimated_lifetime', views_velocity: 12.5,
          channel_ratio: 2, engagement_rate: 0.1, freshness: 90, velocity_percentile: 50,
          channel_ratio_percentile: 50, engagement_percentile: 50, buyer_intent: 90,
          commerce_fit: 95, breakout_score: 60, opportunity_score: 69.75,
          percentile_population_size: 1, created_at: '2026-10-08T00:00:00Z',
        }],
      })
      if (url.includes('source_items?item_type=eq.video')) return response([{
        id: 'video-item', source_id: 'source-1', external_id: 'video-1',
        canonical_url: 'https://www.youtube.com/watch?v=video-1',
      }])
      if (url.includes('source_items?item_type=eq.channel')) return response([{
        id: 'channel-item', source_id: 'source-1', external_id: 'channel-1',
      }])
      if (url.includes('/source_item_snapshots?')) return response([
        { source_item_id: 'video-item', captured_at: '2026-10-08T00:00:00Z', view_count: 1234, subscriber_count: null, hidden_subscriber_count: false },
        { source_item_id: 'video-item', captured_at: '2026-10-07T22:00:00Z', view_count: 1000, subscriber_count: null, hidden_subscriber_count: false },
        { source_item_id: 'channel-item', captured_at: '2026-10-08T00:00:00Z', view_count: null, subscriber_count: 567, hidden_subscriber_count: false },
      ])
      if (url.includes('/collection_runs?')) return response([{
        id: 'run-1', source_query_id: 'query-1', status: 'succeeded', captured_at: '2026-10-08T00:00:00Z',
        requested_count: 25, received_count: 25, scored_count: 24, completed_at: '2026-10-08T00:01:00Z',
      }])
      if (url.includes('/tracking_runs?')) return response([])
      if (url.includes('/sources?')) return response([{ id: 'source-1', project_id: 'project-1' }])
      if (url.includes('/ai_analysis_requests?')) return response([{
        id: 'request-1', source_item_id: 'video-item', status: 'succeeded', prompt_version: 'opportunity-analyst-v1',
        schema_version: 'opportunity-analysis-v1', requested_model: 'gpt-test', resolved_model: 'gpt-test', generated_at: '2026-10-08T00:02:00Z',
        input_snapshot_id: 'snapshot-1', input_fingerprint: 'a'.repeat(64), input_tokens: 120, cached_input_tokens: 0,
        output_tokens: 80, reasoning_tokens: 20,
      }])
      if (url.includes('/ai_opportunity_analyses?')) return response([{
        id: 'analysis-1', analysis_request_id: 'request-1', output_json: { recommendation: 'hold' },
      }])
      if (url.includes('/commerce_translation_requests?')) return response([])
      if (url.includes('/product_search_runs?')) return response([])
      if (url.includes('/campaigns?')) return response([{ id: 'campaign-1', project_id: 'project-1', source_item_id: 'video-item', primary_analysis_id: 'analysis-1', name: 'Campaign', objective: 'Test', status: 'active', analysis_snapshot: { analysis_id: 'analysis-1' }, created_at: '2026-10-10T00:00:00Z' }])
      if (url.includes('/campaign_origins?')) return response([{ id: 'origin-1', campaign_id: 'campaign-1', context_kind: 'discovery', opportunity_id: 'opportunity-1', tracking_opportunity_id: null, source_query_id: 'query-1', rank_position: 1, score_version: 'youtube-v1', origin_snapshot: { opportunity_score: 69.75 } }])
      if (url.includes('/campaign_iterations?')) return response([{ id: 'iteration-1', campaign_id: 'campaign-1', iteration_number: 1, curated_product_id: 'product-1', source_analysis_id: 'analysis-1', status: 'published', appeal_hypothesis: 'appeal', hook_text: 'hook', content_outline: { text: 'outline' }, script_text: null, treatment_fingerprint: 'b'.repeat(64), locked_at: '2026-10-10T00:00:00Z' }])
      if (url.includes('/campaign_evidence_markers?')) return response([])
      if (url.includes('/curated_products?')) return response([{ id: 'product-1', source_kind: 'manual', discovery_channel: 'google_search', search_keyword: 'keyword', merchant: 'Shop', product_name: 'Product', product_url: 'https://example.com/product', affiliate_url: null, price_amount: 1000, currency: 'JPY', notes: null, human_verified_at: '2026-10-10T00:00:00Z' }])
      if (url.includes('/curated_product_translation_origins?')) return response([])
      if (url.includes('/product_assets?')) return response([])
      if (url.includes('/creative_production_requests?')) return response([{ id: 'production-request-1', campaign_iteration_id: 'iteration-1', revision_number: 1, status: 'succeeded', prompt_version: 'creative-production-planner-v1', schema_version: 'creative-production-plan-v1', requested_model: 'gpt-test', resolved_model: 'gpt-test', input_fingerprint: 'c'.repeat(64), generated_at: '2026-10-10T01:00:00Z' }])
      if (url.includes('/creative_production_plans?')) return response([{ id: 'production-plan-1', production_request_id: 'production-request-1', output_json: { scenes: [{ scene_number: 1, visual_source_type: 'ai_generated_scene', ai_generation_prompt: '[背景・演出のみ。商品本体を描写しない] 朝の机' }] }, provider_export: {} }])
      if (url.includes('/video_generation_scenes?')) return response([{ id: 'generation-1', run_id: 'generation-run-1', creative_production_plan_id: 'production-plan-1', creative_scene_number: 1, attempt_number: 1, provider: 'pollo', provider_version: 'platform-v1', requested_model: 'pollo-v2', provider_task_id: 'task-1', provider_task_status: 'succeeded', duration_seconds: 5, aspect_ratio: '9:16', resolution: '480p', status: 'succeeded', provider_cost_amount: '0.12', provider_cost_currency: 'USD', cost_provenance: 'actual', output_url: 'https://cdn.example/video.mp4', safe_error_code: null, created_at: '2026-10-10T01:01:00Z', completed_at: '2026-10-10T01:02:00Z' }])
      if (url.includes('/campaign_publications?')) return response([{ id: 'publication-1', campaign_iteration_id: 'iteration-1', platform: 'youtube', youtube_video_id: 'video123', canonical_url: 'https://www.youtube.com/watch?v=video123', title: 'Published', published_at: '2026-10-10T00:00:00Z', status: 'published', initial_metadata: {}, created_at: '2026-10-10T00:00:00Z' }])
      if (url.includes('/youtube_performance_snapshots?')) return response([{ id: 'performance-1', run_id: 'analytics-run-1', campaign_publication_id: 'publication-1', captured_at: '2026-10-10T02:00:00Z', requested_start_date: '2026-10-09', requested_end_date: '2026-10-10', data_through_date: '2026-10-09', query_version: 'youtube-analytics-v1', views: 42, estimated_minutes_watched: 21, average_view_duration: null, average_view_percentage: 50, subscribers_gained: 2, subscribers_lost: 0, likes: 5, comments: null, shares: 1 }])
      if (url.includes('/youtube_analytics_connections?')) return response([{ id: 'connection-1', project_id: 'project-1', channel_id: 'UC1234567890123456789012', channel_title: 'Owner Channel', scopes: ['scope-a'], credential_ref: 'local-dpapi:11111111-1111-4111-8111-111111111111', connection_status: 'connected', connected_at: '2026-10-10T00:00:00Z', last_verified_at: '2026-10-10T00:00:00Z' }])
      throw new Error(`Unexpected request: ${url} ${options?.method}`)
    })
    const store = createSupabaseStore({
      url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl,
    })
    const dashboard = await store.dashboard(3)
    expect(dashboard.opportunities[0]).toMatchObject({
      sourceUrl: 'https://www.youtube.com/watch?v=video-1',
      viewCount: 1234,
      subscriberCount: 567,
      hiddenSubscriberCount: false,
      previousViewCount: 1000,
      viewIncrease: 234,
      velocityElapsedHours: 2,
    })
    expect(dashboard.latestRun).toMatchObject({
      id: 'run-1', sourceQueryId: 'query-1', status: 'succeeded', receivedCount: 25, scoredCount: 24,
    })
    expect(dashboard.analyses[0]).toMatchObject({
      id: 'analysis-1', sourceItemId: 'video-item', status: 'succeeded', inputSnapshotId: 'snapshot-1',
      inputFingerprint: 'a'.repeat(64), requestedModel: 'gpt-test', resolvedModel: 'gpt-test',
      usage: { inputTokens: 120, cachedInputTokens: 0, outputTokens: 80, reasoningTokens: 20 },
      output: { recommendation: 'hold' },
    })
    expect(dashboard.campaigns[0]).toMatchObject({
      id: 'campaign-1', analysisId: 'analysis-1', status: 'active',
      hasEvidence: true, canHardDelete: false,
      origins: [{ contextKind: 'discovery', rankPosition: 1, scoreVersion: 'youtube-v1' }],
      iterations: [{ id: 'iteration-1', sourceAnalysisId: 'analysis-1', product: { productName: 'Product', discoveryChannel: 'google_search' }, publication: { youtubeVideoId: 'video123', status: 'published', latestPerformance: { views: 42, comments: null, queryVersion: 'youtube-analytics-v1' } }, productionPlans: [{ planId: 'production-plan-1', videoGenerations: [{ id: 'generation-1', sceneNumber: 1, provider: 'pollo', model: 'pollo-v2', providerCost: 0.12, costProvenance: 'actual' }] }] }],
    })
    expect(dashboard.youtubeAnalyticsConnection).toMatchObject({ channelTitle: 'Owner Channel', connectionStatus: 'connected' })
    expect(dashboard.youtubeAnalyticsConnection).not.toHaveProperty('credentialRef')
    expect(fetchImpl).toHaveBeenCalledTimes(24)
  })

  it('creates the manual product, Campaign, Iteration, and publication atomically with a deterministic fingerprint', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) })
      return response({ campaignId: 'campaign-1', iterationStatus: 'ready_to_publish' })
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const input = { idempotencyKey: '22222222-2222-4222-8222-222222222222', campaignName: 'Campaign', objective: null, discoveryChannel: 'google_search', searchKeyword: '卓上 ライト', merchant: 'Shop', productName: 'Light', productUrl: 'https://example.com/product', affiliateUrl: null, priceAmount: 3980, currency: 'JPY', productNotes: '確認済み', appealHypothesis: '省スペース', hookText: '机が変わる', contentOutline: '比較構成', scriptText: null, youtubeVideoId: 'video123', publicationTitle: null, publishedAt: null }
    const result = await store.createManualCampaign('analysis-1', input)
    expect(result).toMatchObject({ campaignId: 'campaign-1' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain('/rest/v1/rpc/create_manual_campaign')
    expect(calls[0].body.p_analysis_id).toBe('analysis-1')
    expect(calls[0].body.p_payload).toMatchObject({
      campaign: { name: 'Campaign', objective: null },
      product: { source_kind: 'manual', discovery_channel: 'google_search', search_keyword: '卓上 ライト', product_name: 'Light' },
      creative: { appeal_hypothesis: '省スペース', hook_text: '机が変わる', content_outline: { format: 'plain_text', text: '比較構成' } },
      publication: { youtube_video_id: 'video123' },
    })
    expect(calls[0].body.p_treatment_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(calls[0].body.p_request_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(calls[0].body.p_idempotency_key).toBe(input.idempotencyKey)
  })

  it('omits the publication payload for a pre-publication Campaign and can register it later', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null })
      if (url.includes('/campaign_iterations?')) return response([{ appeal_hypothesis: 'appeal', hook_text: 'hook', content_outline: { format: 'plain_text', text: 'outline' }, script_text: null }])
      return response(url.includes('register_campaign_publication')
        ? { publicationId: 'publication-1', iterationStatus: 'ready_to_publish' }
        : { campaignId: 'campaign-1', publicationId: null, iterationStatus: 'draft' })
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const input = { idempotencyKey: '22222222-2222-4222-8222-222222222222', campaignName: 'Draft', objective: null, discoveryChannel: 'google_search', searchKeyword: 'keyword', merchant: 'Shop', productName: 'Product', productUrl: 'https://example.com/product', affiliateUrl: null, priceAmount: null, currency: 'JPY', productNotes: null, appealHypothesis: 'appeal', hookText: 'hook', contentOutline: 'outline', scriptText: null, youtubeVideoId: null, publicationTitle: null, publishedAt: null }
    expect(await store.createManualCampaign('analysis-1', input)).toMatchObject({ publicationId: null, iterationStatus: 'draft' })
    expect(calls[0].body.p_payload.publication).toBeNull()
    expect(await store.registerCampaignPublication('iteration-1', { youtubeVideoId: 'realVideo1', publicationTitle: null, publishedAt: null })).toMatchObject({ publicationId: 'publication-1', iterationStatus: 'ready_to_publish' })
    const publicationCall = calls.find(call => call.url.includes('/rpc/register_campaign_publication'))
    expect(publicationCall).toMatchObject({ body: { p_campaign_iteration_id: 'iteration-1', p_youtube_video_id: 'realVideo1', p_title: null, p_published_at: null } })
  })

  it('creates Direct Product facts, assets, Campaign, and draft Iteration without analysis lineage', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, body: options?.body ? JSON.parse(options.body) : null })
      if (url.includes('/projects?')) return response([{ id: 'project-1', name: 'Revenue Lab' }])
      if (url.includes('/rpc/create_direct_product_campaign')) return response({ campaignId: 'campaign-direct', iterationStatus: 'draft', lineageKind: 'direct_product', created: true })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const result = await store.createDirectProductCampaign({
      idempotencyKey: '22222222-2222-4222-8222-222222222222', campaignName: '確認済み商品 · 商品登録', objective: null,
      merchant: '自社', productName: '確認済み商品', productUrl: 'https://example.com/product', affiliateUrl: null,
      priceAmount: 5000, currency: 'JPY', productCategory: '生活用品', verifiedFacts: '寸法と材質を確認済み',
      cautions: '火気厳禁', productNotes: null, isOwnProduct: true,
      assets: [{ assetKind: 'hero', assetUrl: 'https://example.com/hero.jpg', assetSource: 'self_owned', usagePermission: 'owned', label: '正面' }],
      appealHypothesis: '[INTERNAL:DIRECT_PRODUCT_REGISTRATION_ONLY]',
      hookText: '[INTERNAL:NO_CREATIVE_HOOK]', contentOutline: '[INTERNAL:NO_CREATIVE_OUTLINE]', scriptText: null,
    })
    expect(result).toMatchObject({ lineageKind: 'direct_product', iterationStatus: 'draft' })
    expect(calls[1].url).toContain('/rpc/create_direct_product_campaign')
    expect(calls[1].body).toMatchObject({
      p_project_id: 'project-1',
      p_payload: {
        campaign: { name: '確認済み商品 · 商品登録', objective: null },
        product: { product_name: '確認済み商品', verified_facts: { summary: '寸法と材質を確認済み' }, is_own_product: true, assets: [{ ordinal: 1, asset_kind: 'hero', asset_source: 'self_owned', usage_permission: 'owned' }] },
        creative: { appeal_hypothesis: '[INTERNAL:DIRECT_PRODUCT_REGISTRATION_ONLY]',
          hook_text: '[INTERNAL:NO_CREATIVE_HOOK]',
          content_outline: { format: 'internal_placeholder', text: '[INTERNAL:NO_CREATIVE_OUTLINE]', reusable: false },
          script_text: null },
      },
    })
    expect(calls[1].body.p_payload).not.toHaveProperty('analysis')
    expect(calls[1].body.p_request_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(calls[1].body.p_treatment_fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects registration-only placeholders at every server-side Creative and Publication boundary', async () => {
    const placeholder = {
      id: 'iteration-registration', campaign_id: 'campaign-direct', curated_product_id: 'product-direct', product_set_id: null,
      appeal_hypothesis: '[INTERNAL:DIRECT_PRODUCT_REGISTRATION_ONLY]', hook_text: '[INTERNAL:NO_CREATIVE_HOOK]',
      content_outline: { format: 'internal_placeholder', text: '[INTERNAL:NO_CREATIVE_OUTLINE]', reusable: false }, script_text: null,
    }
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null })
      if (url.includes('/campaign_iterations?')) return response([placeholder])
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const expected = { code: 'CAMPAIGN_REGISTRATION_ONLY', status: 409 }
    await expect(store.enqueueCreativeProduction(placeholder.id, { idempotencyKey: '22222222-2222-4222-8222-222222222222' })).rejects.toMatchObject(expected)
    await expect(store.registerCampaignPublication(placeholder.id, { youtubeVideoId: 'realVideo1' })).rejects.toMatchObject(expected)
    await expect(store.updateDraftCampaignIteration(placeholder.id, { appealHypothesis: 'x', hookText: 'x', contentOutline: 'x' })).rejects.toMatchObject(expected)
    await expect(store.createCampaignIteration('campaign-direct', placeholder.id, { appealHypothesis: 'x', hookText: 'x', contentOutline: 'x' })).rejects.toMatchObject(expected)
    expect(calls.some(call => call.url.includes('/rpc/'))).toBe(false)
  })

  it('refuses to persist a public Creative snapshot from a legacy queued placeholder request', async () => {
    const fetchImpl = vi.fn()
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const request = { id: 'request-placeholder', inputSnapshot: { iteration: {
      appeal_hypothesis: '[INTERNAL:DIRECT_PRODUCT_REGISTRATION_ONLY]', hook: '[INTERNAL:NO_CREATIVE_HOOK]',
      outline: { format: 'internal_placeholder', text: '[INTERNAL:NO_CREATIVE_OUTLINE]', reusable: false }, script: null,
    } }, schemaVersion: 'creative-production-plan-v2' }
    await expect(store.persistCreativeProductionSuccess(request, { productionPlan: { scenes: [] } }))
      .rejects.toMatchObject({ code: 'CAMPAIGN_REGISTRATION_ONLY', status: 409 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('freezes Campaign, verified facts, and asset metadata before queueing a production revision', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null
      calls.push({ url, body })
      if (url.includes('/campaign_iterations?')) return response([{ id: 'iteration-1', campaign_id: 'campaign-1', curated_product_id: 'product-1', iteration_number: 1, status: 'draft', appeal_hypothesis: '時短', hook_text: '片付けが変わる', content_outline: { text: '実商品を紹介' }, script_text: null }])
      if (url.includes('/campaigns?')) return response([{ id: 'campaign-1', name: 'Campaign', objective: '訴求を検証', status: 'active', lineage_kind: 'direct_product' }])
      if (url.includes('/curated_products?')) return response([{ id: 'product-1', source_kind: 'direct_product', product_name: '確認済み商品', merchant: '自社', price_amount: 3980, currency: 'JPY', product_category: '収納', verified_facts: { 容量: '500ml', 材質: '確認済み素材' }, facts_snapshot: {}, is_own_product: true }])
      if (url.includes('/product_assets?')) return response([
        { id: 'asset-1', ordinal: 1, asset_kind: 'hero', asset_source: 'self_owned', usage_permission: 'owned', label: '正面', asset_url: 'https://secret.example/asset.jpg' },
        { id: 'asset-2', ordinal: 2, asset_kind: 'detail', asset_source: 'merchant', usage_permission: 'licensed', label: '詳細', asset_url: 'https://secret.example/detail.jpg' },
        { id: 'asset-3', ordinal: 3, asset_kind: 'usage', asset_source: 'merchant', usage_permission: 'authorized_reference', registered_facts: { i2v_allowed: true }, label: '利用', asset_url: 'https://secret.example/use.jpg' },
      ])
      if (url.includes('/rpc/enqueue_creative_production_plan')) return response({ requestId: 'request-1', revisionNumber: 1, created: true })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await expect(store.enqueueCreativeProduction('iteration-1', { idempotencyKey: '22222222-2222-4222-8222-222222222222', model: 'gpt-test' })).resolves.toMatchObject({ revisionNumber: 1 })
    const payload = calls.find(call => call.url.includes('/rpc/enqueue_creative_production_plan')).body
    expect(payload).toMatchObject({
      p_campaign_iteration_id: 'iteration-1', p_prompt_version: 'creative-production-planner-v2.2',
      p_schema_version: 'creative-production-plan-v2', p_requested_model: 'gpt-test',
      p_idempotency_key: '22222222-2222-4222-8222-222222222222',
    })
    expect(payload.p_input_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.p_input_snapshot.contract.schema_version).toBe('creative-production-plan-v2')
    expect(payload.p_input_snapshot.product_assets[0]).toMatchObject({
      id: 'asset-1', static_eligible: true, i2v_eligible: true, i2v_permission_source: 'owned',
    })
    expect(payload.p_input_snapshot.product_assets[1]).toMatchObject({ id: 'asset-2', static_eligible: true, i2v_eligible: false, i2v_permission_source: 'not_confirmed' })
    expect(payload.p_input_snapshot.product_assets[2]).toMatchObject({ id: 'asset-3', static_eligible: true, i2v_eligible: true, i2v_permission_source: 'explicit' })
    expect(payload.p_input_snapshot.product_assets[0]).not.toHaveProperty('asset_url')
    expect(payload.p_input_snapshot.verified_product_facts.map(fact => fact.id)).toEqual(expect.arrayContaining(['product.name', 'product.price', 'verified.1.fact', 'verified.2.fact']))
    expect(new Set(payload.p_input_snapshot.verified_product_facts.map(fact => fact.id)).size).toBe(payload.p_input_snapshot.verified_product_facts.length)
  })

  it('persists an immutable provider-neutral plan and makes worker retries insert-safe', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => { calls.push({ url, method: options.method, prefer: options.headers?.prefer, body: options.body ? JSON.parse(options.body) : null }); return response(null, 204) })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const plan = { target_format: 'youtube_shorts', aspect_ratio: '9:16', target_duration_seconds: 30, scenes: [{ scene_number: 1, product_asset_id: 'asset-1', ai_generation_prompt: null }] }
    await store.persistCreativeProductionSuccess({ id: 'request-1', projectId: 'project-1', campaignId: 'campaign-1', iterationId: 'iteration-1', productId: 'product-1', revisionNumber: 2, schemaVersion: 'creative-production-plan-v1' }, { productionPlan: plan, resolvedModel: 'gpt-test', responseId: 'resp-1', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, reasoningTokens: 0 } })
    const insert = calls[0]
    expect(insert.url).toContain('creative_production_plans?on_conflict=production_request_id')
    expect(insert.prefer).toContain('resolution=ignore-duplicates')
    expect(insert.body).toMatchObject({ revision_number: 2, output_json: plan, provider_export: { export_version: 'provider-neutral-shorts-v1', generation_provider: null } })
    expect(calls[1].body).toMatchObject({ status: 'succeeded', resolved_model: 'gpt-test', openai_response_id: 'resp-1' })
  })

  it('stores a v2 provider-neutral rendering route without changing the v1 export', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => { calls.push({ url, body: options.body ? JSON.parse(options.body) : null }); return response(null, 204) })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const scene = { scene_number: 1, rendering_strategy: 'static_product_scene', visual_source_type: 'real_product_asset', product_asset_id: 'asset-1',
      requires_ai_generation: false, recommended_model_class: 'none', preserve_product_identity: true,
      motion_instruction: { mode: 'slow_zoom_in', description: '編集時にズーム' }, ai_generation_prompt: null }
    const plan = { target_format: 'youtube_shorts', aspect_ratio: '9:16', target_duration_seconds: 30, scenes: [scene] }
    await store.persistCreativeProductionSuccess({ id: 'request-v2', projectId: 'project-1', campaignId: 'campaign-1', iterationId: 'iteration-1', productId: 'product-1', revisionNumber: 3, schemaVersion: 'creative-production-plan-v2' }, { productionPlan: plan, resolvedModel: 'gpt-test', responseId: 'resp-v2', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 2, reasoningTokens: 0 } })
    expect(calls[0].body.provider_export).toMatchObject({
      export_version: 'provider-neutral-shorts-v2', generation_provider: null,
      rendering_routes: [{ scene_number: 1, rendering_strategy: 'static_product_scene', recommended_model_class: 'none', requires_ai_generation: false, preserve_product_identity: true }],
    })
  })

  it('queues only an immutable AI-generated scene with a deterministic provider fingerprint', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body })
      if (url.includes('/creative_production_plans?')) return response([{ id: 'plan-1', output_json: { scenes: [
        { scene_number: 1, visual_source_type: 'ai_generated_scene', ai_generation_prompt: '[背景・演出のみ。商品本体を描写しない] 朝の机', duration_seconds: 7 },
        { scene_number: 2, visual_source_type: 'real_product_asset', ai_generation_prompt: null, duration_seconds: 5 },
      ] } }])
      if (url.includes('/rpc/enqueue_video_generation_scene')) return response({ runId: 'run-1', sceneGenerationId: 'generation-1', created: true })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await expect(store.enqueueVideoGeneration('plan-1', 1, { idempotencyKey: '22222222-2222-4222-8222-222222222222' })).resolves.toMatchObject({ created: true })
    const payload = calls.find(call => call.url.includes('/rpc/enqueue_video_generation_scene')).body
    expect(payload).toMatchObject({
      p_creative_production_plan_id: 'plan-1', p_scene_number: 1, p_provider: 'pollo',
      p_provider_version: 'platform-v1', p_requested_model: 'pollo-v2', p_duration_seconds: 10,
      p_resolution: '480p', p_regenerate: false,
    })
    expect(payload.p_prompt_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.p_request_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    await expect(store.enqueueVideoGeneration('plan-1', 2, { idempotencyKey: '33333333-3333-4333-8333-333333333333' })).rejects.toMatchObject({ code: 'VIDEO_GENERATION_SCENE_INELIGIBLE' })
    expect(calls.filter(call => call.url.includes('/rpc/enqueue_video_generation_scene'))).toHaveLength(1)
  })

  it('defers polling without consuming a job attempt and revives the existing timed-out provider task', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null
      calls.push({ url, method: options.method, body })
      if (url.includes('/jobs?id=eq.job-live&status=eq.running')) return response([{ id: 'job-live' }])
      if (url.includes('/jobs?job_type=eq.video.generate.scene')) return response([{
        id: 'job-timeout', attempts: 1, status: 'failed', run_after: null, lease_expires_at: null,
        error_code: 'JOB_FAILED', payload: { video_generation_scene_id: 'scene-timeout' },
      }])
      if (url.includes('/video_generation_scenes?id=eq.scene-timeout&provider_task_id=not.is.null')) {
        return response([{
          id: 'scene-timeout', run_id: 'run-timeout', status: 'polling',
          provider_task_id: 'secret-task-id', provider_task_status: 'succeed',
          safe_error_code: 'VIDEO_GENERATION_POLL_TIMEOUT',
        }])
      }
      return response(null, 204)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.deferJob('job-live', 'worker-1', {
      retryAfterSeconds: 30, attempts: 2,
      error: { code: 'VIDEO_GENERATION_POLL_TIMEOUT', message: 'still pending' },
    })
    await expect(store.recoverTimedOutVideoGenerations()).resolves.toBe(1)
    expect(calls.find(call => call.url.includes('/jobs?job_type=eq.video.generate.scene')).url).toContain('error_code=in.(VIDEO_GENERATION_POLL_TIMEOUT,JOB_FAILED)')
    expect(calls.find(call => call.url.includes('/video_generation_scenes?id=eq.scene-timeout')).url).toContain('safe_error_code=eq.VIDEO_GENERATION_POLL_TIMEOUT')
    const deferred = calls.find(call => call.url.includes('/jobs?id=eq.job-live'))
    expect(deferred.body).toMatchObject({
      status: 'pending', attempts: 1, worker_id: null, lease_expires_at: null,
      completed_at: null, error_code: 'VIDEO_GENERATION_POLL_TIMEOUT',
    })
    const revivedJob = calls.find(call => call.url.includes('/jobs?id=eq.job-timeout'))
    expect(revivedJob.url).toContain('status=in.(pending,failed)')
    expect(revivedJob.body).toMatchObject({ status: 'pending', attempts: 0, completed_at: null })
    expect(calls.find(call => call.url.includes('/video_generation_scenes?id=eq.scene-timeout') && call.method === 'PATCH').body).toMatchObject({
      status: 'polling', safe_error_code: 'VIDEO_GENERATION_POLL_TIMEOUT', completed_at: null,
    })
    expect(calls.find(call => call.url.includes('/video_generation_runs?id=eq.run-timeout')).body).toMatchObject({
      status: 'running', safe_error_code: 'VIDEO_GENERATION_POLL_TIMEOUT', completed_at: null,
    })
  })

  it('finalizes the existing generation attempt and clears its prior polling timeout', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      calls.push({ url, body: options.body ? JSON.parse(options.body) : null })
      return response(null, 204)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.persistVideoGenerationSuccess({ id: 'attempt-5', runId: 'run-5' }, {
      providerTaskStatus: 'succeed', outputUrl: 'https://cdn.example/attempt-5.mp4',
      providerCost: null, costCurrency: null, costProvenance: 'unavailable',
    })
    expect(calls.find(call => call.url.includes('/video_generation_scenes?id=eq.attempt-5')).body).toMatchObject({
      status: 'succeeded', provider_task_status: 'succeed', output_url: 'https://cdn.example/attempt-5.mp4',
      provider_cost_amount: null, provider_cost_currency: null, cost_provenance: 'unavailable',
      safe_error_code: null,
    })
    expect(calls.find(call => call.url.includes('/video_generation_runs?id=eq.run-5')).body).toMatchObject({
      status: 'succeeded', safe_error_code: null,
    })
  })

  it('routes draft edits, successor Iterations, hard deletion, and voiding through guarded RPCs', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body })
      if (url.includes('/campaign_iterations?')) return response([{ appeal_hypothesis: 'appeal', hook_text: 'hook', content_outline: { format: 'plain_text', text: 'outline' }, script_text: null }])
      if (url.includes('update_draft_campaign_iteration')) return response({ iterationId: 'iteration-1', iterationStatus: 'draft' })
      if (url.includes('create_campaign_iteration')) return response({ iterationId: 'iteration-2', iterationNumber: 2, iterationStatus: 'draft' })
      if (url.includes('hard_delete_draft_campaign')) return response({ campaignId: 'campaign-1', deleted: true })
      if (url.includes('void_campaign')) return response({ campaignId: 'campaign-2', status: 'voided', voidReason: 'duplicate' })
      throw new Error(`Unexpected request: ${url}`)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const creative = { appealHypothesis: 'new appeal', hookText: 'new hook', contentOutline: 'new outline', scriptText: 'new script' }
    await store.updateDraftCampaignIteration('iteration-1', creative)
    await store.createCampaignIteration('campaign-1', 'iteration-1', creative)
    await store.hardDeleteDraftCampaign('campaign-1')
    await store.voidCampaign('campaign-2', { reason: 'duplicate', note: 'double click' })
    const rpcCalls = calls.filter(call => call.url.includes('/rpc/'))
    expect(rpcCalls[0].body).toMatchObject({ p_iteration_id: 'iteration-1', p_creative: { appeal_hypothesis: 'new appeal', hook_text: 'new hook', content_outline: { format: 'plain_text', text: 'new outline' }, script_text: 'new script' } })
    expect(rpcCalls[0].body.p_treatment_fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(rpcCalls[1].body).toMatchObject({ p_campaign_id: 'campaign-1', p_source_iteration_id: 'iteration-1' })
    expect(rpcCalls[2].body).toEqual({ p_campaign_id: 'campaign-1' })
    expect(rpcCalls[3].body).toEqual({ p_campaign_id: 'campaign-2', p_reason: 'duplicate', p_note: 'double click' })
  })

  it('persists Analytics connection and manual run transitions only through service-role RPCs', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : null
      calls.push({ url, body })
      if (url.includes('upsert_youtube_analytics_connection')) return response({ id: 'connection-1' })
      if (url.includes('start_youtube_analytics_run')) return response({ runId: 'run-1', youtubeVideoId: 'video123' })
      if (url.includes('finish_youtube_analytics_run')) return response({ id: 'snapshot-1', views: 42 })
      return response(null, 204)
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.upsertYouTubeAnalyticsConnection('project-1', { channelId: 'UC1234567890123456789012', channelTitle: 'Owner', scopes: ['scope-a'], credentialRef: 'local-dpapi:11111111-1111-4111-8111-111111111111' })
    await store.startYouTubeAnalyticsRun('publication-1', 'connection-1', { startDate: '2026-10-01', endDate: '2026-10-09', queryVersion: 'youtube-analytics-v1', metrics: ['views'] })
    await store.finishYouTubeAnalyticsRun('run-1', { views: 42, comments: null, raw_metrics: {} }, false)
    await store.failYouTubeAnalyticsRun('run-2', 'REFRESH_TOKEN_REVOKED', true)
    expect(calls.map(call => call.url)).toEqual(expect.arrayContaining([
      expect.stringContaining('/rpc/upsert_youtube_analytics_connection'),
      expect.stringContaining('/rpc/start_youtube_analytics_run'),
      expect.stringContaining('/rpc/finish_youtube_analytics_run'),
      expect.stringContaining('/rpc/fail_youtube_analytics_run'),
    ]))
    expect(calls[3].body).toEqual({ p_run_id: 'run-2', p_error_code: 'REFRESH_TOKEN_REVOKED', p_reauth_required: true })
  })

  it('restricts Discovery previous snapshots to discovery capture kind', async () => {
    const calls = []
    const fetchImpl = vi.fn(async url => {
      calls.push(url)
      if (url.includes('/source_items?')) return response([{ id: 'video-item', external_id: 'video-1' }])
      return response([{ source_item_id: 'video-item', captured_at: '2026-10-08T00:00:00Z', view_count: 100 }])
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    await store.previousVideoSnapshots('source-1', ['video-1'])
    expect(calls.find(url => url.includes('/source_item_snapshots?'))).toContain('capture_kind=eq.discovery')
  })
})
