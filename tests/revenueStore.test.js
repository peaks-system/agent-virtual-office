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
      if (url.includes('/product_search_runs?')) return response([])
      if (url.includes('/campaigns?')) return response([{ id: 'campaign-1', project_id: 'project-1', source_item_id: 'video-item', primary_analysis_id: 'analysis-1', name: 'Campaign', objective: 'Test', status: 'active', analysis_snapshot: { analysis_id: 'analysis-1' }, created_at: '2026-10-10T00:00:00Z' }])
      if (url.includes('/campaign_origins?')) return response([{ id: 'origin-1', campaign_id: 'campaign-1', context_kind: 'discovery', opportunity_id: 'opportunity-1', tracking_opportunity_id: null, source_query_id: 'query-1', rank_position: 1, score_version: 'youtube-v1', origin_snapshot: { opportunity_score: 69.75 } }])
      if (url.includes('/campaign_iterations?')) return response([{ id: 'iteration-1', campaign_id: 'campaign-1', iteration_number: 1, curated_product_id: 'product-1', source_analysis_id: 'analysis-1', status: 'published', appeal_hypothesis: 'appeal', hook_text: 'hook', content_outline: { text: 'outline' }, script_text: null, treatment_fingerprint: 'b'.repeat(64), locked_at: '2026-10-10T00:00:00Z' }])
      if (url.includes('/curated_products?')) return response([{ id: 'product-1', source_kind: 'manual', discovery_channel: 'google_search', search_keyword: 'keyword', merchant: 'Shop', product_name: 'Product', product_url: 'https://example.com/product', affiliate_url: null, price_amount: 1000, currency: 'JPY', notes: null, human_verified_at: '2026-10-10T00:00:00Z' }])
      if (url.includes('/campaign_publications?')) return response([{ id: 'publication-1', campaign_iteration_id: 'iteration-1', platform: 'youtube', youtube_video_id: 'video123', canonical_url: 'https://www.youtube.com/watch?v=video123', title: 'Published', published_at: '2026-10-10T00:00:00Z', status: 'published', initial_metadata: {}, created_at: '2026-10-10T00:00:00Z' }])
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
      origins: [{ contextKind: 'discovery', rankPosition: 1, scoreVersion: 'youtube-v1' }],
      iterations: [{ id: 'iteration-1', sourceAnalysisId: 'analysis-1', product: { productName: 'Product', discoveryChannel: 'google_search' }, publication: { youtubeVideoId: 'video123', status: 'published' } }],
    })
    expect(fetchImpl).toHaveBeenCalledTimes(15)
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
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) })
      return response(url.includes('register_campaign_publication')
        ? { publicationId: 'publication-1', iterationStatus: 'ready_to_publish' }
        : { campaignId: 'campaign-1', publicationId: null, iterationStatus: 'draft' })
    })
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-only', fetchImpl })
    const input = { idempotencyKey: '22222222-2222-4222-8222-222222222222', campaignName: 'Draft', objective: null, discoveryChannel: 'google_search', searchKeyword: 'keyword', merchant: 'Shop', productName: 'Product', productUrl: 'https://example.com/product', affiliateUrl: null, priceAmount: null, currency: 'JPY', productNotes: null, appealHypothesis: 'appeal', hookText: 'hook', contentOutline: 'outline', scriptText: null, youtubeVideoId: null, publicationTitle: null, publishedAt: null }
    expect(await store.createManualCampaign('analysis-1', input)).toMatchObject({ publicationId: null, iterationStatus: 'draft' })
    expect(calls[0].body.p_payload.publication).toBeNull()
    expect(await store.registerCampaignPublication('iteration-1', { youtubeVideoId: 'realVideo1', publicationTitle: null, publishedAt: null })).toMatchObject({ publicationId: 'publication-1', iterationStatus: 'ready_to_publish' })
    expect(calls[1]).toMatchObject({ body: { p_campaign_iteration_id: 'iteration-1', p_youtube_video_id: 'realVideo1', p_title: null, p_published_at: null } })
    expect(calls[1].url).toContain('/rpc/register_campaign_publication')
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
