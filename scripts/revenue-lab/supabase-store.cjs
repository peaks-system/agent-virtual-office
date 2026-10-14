'use strict'

const { inputFingerprint } = require('./canonical-json.cjs')
const { DEFAULT_MODEL, PROMPT_VERSION, SCHEMA_VERSION } = require('./analysis-schema.cjs')
const { SCORE_PARAMETERS: PRODUCT_SCORE_PARAMETERS, SCORE_VERSION: PRODUCT_SCORE_VERSION } = require('./product-ranking.cjs')
const { API_VERSION: RAKUTEN_API_VERSION, PROVIDER_ID: RAKUTEN_PROVIDER_ID } = require('./providers/rakuten-product-provider.cjs')
const { DEFAULT_MODEL: CREATIVE_DEFAULT_MODEL, EXPORT_VERSION: CREATIVE_EXPORT_VERSION,
  PROMPT_VERSION: CREATIVE_PROMPT_VERSION, SCHEMA_VERSION: CREATIVE_SCHEMA_VERSION } = require('./creative-production-schema-v2.cjs')
const { DEFAULT_MODEL: POLLO_DEFAULT_MODEL, DEFAULT_RESOLUTION: POLLO_DEFAULT_RESOLUTION, PROVIDER_ID: POLLO_PROVIDER_ID, PROVIDER_VERSION: POLLO_PROVIDER_VERSION, normalizedDuration, validatedModel } = require('./providers/pollo-video-generation-provider.cjs')
const { ADAPTER_VERSION: WAN_ADAPTER_VERSION, MODEL: WAN_MODEL,
  PROVIDER_ID: WAN_PROVIDER_ID, PROVIDER_VERSION: WAN_PROVIDER_VERSION } = require('./providers/pollo-wan-video-generation-provider.cjs')
const { buildProductIdentityPrompt } = require('./product-i2v-prompt-builder.cjs')
const { DEFAULT_MODEL: THREE_PICKS_DEFAULT_MODEL, PROMPT_VERSION: THREE_PICKS_PROMPT_VERSION,
  SCHEMA_VERSION: THREE_PICKS_SCHEMA_VERSION, compactDisplayName, compactFactBadge } = require('./multi-product-shorts-schema.cjs')
const { COMPOSITION_VERSION, buildProductCards, buildRenderManifest } = require('./multi-product-shorts-composition.cjs')
const { ARCHETYPE: THREE_PICKS_V2_ARCHETYPE, DEFAULT_MODEL: THREE_PICKS_V2_DEFAULT_MODEL,
  PROMPT_VERSION: THREE_PICKS_V2_PROMPT_VERSION, SCHEMA_VERSION: THREE_PICKS_V2_SCHEMA_VERSION,
  TEMPLATE_ID: THREE_PICKS_V2_TEMPLATE_ID, planNarrationSegments } = require('./multi-product-shorts-v2-schema.cjs')
const { COMPOSITION_VERSION: COMPOSITION_V2_VERSION,
  compileThreePicksV2Manifest } = require('./multi-product-shorts-v2-composition.cjs')
const { directProductCreativeSnapshot, isDirectProductRegistrationPlaceholder } = require('./direct-product-contract.cjs')

const PROFILE = 'revenue_lab'

class RevenueStoreError extends Error {
  constructor(code, message, status = null, provider = null) {
    super(message)
    this.name = 'RevenueStoreError'
    this.code = code
    this.status = status
    this.providerCode = typeof provider?.code === 'string' ? provider.code.slice(0, 80) : null
    this.providerMessage = typeof provider?.message === 'string' ? provider.message.slice(0, 300) : null
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, status: this.status,
      providerCode: this.providerCode, providerMessage: this.providerMessage }
  }
}

function queryFromRow(row) {
  if (!row) return null
  const source = Array.isArray(row.sources) ? row.sources[0] : row.sources
  return {
    id: row.id,
    sourceId: row.source_id,
    projectId: source?.project_id ?? row.project_id ?? null,
    label: row.label,
    queryText: row.query_text,
    buyerIntent: row.buyer_intent,
    commerceFit: row.commerce_fit,
    enabled: row.enabled,
    maxResults: row.max_results,
    lookbackDays: row.lookback_days,
    regionCode: row.region_code,
    relevanceLanguage: row.relevance_language,
    updatedAt: row.updated_at,
  }
}

function opportunityFromRow(row) {
  return {
    id: row.id,
    sourceItemId: row.source_item_id,
    trackingRunId: row.tracking_run_id,
    sourceQueryId: row.source_query_id,
    youtubeVideoId: row.youtube_video_id,
    title: row.title,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    thumbnailUrl: row.thumbnail_url,
    publishedAt: row.published_at,
    scoreVersion: row.score_version,
    velocityMode: row.velocity_mode,
    viewsVelocity: Number(row.views_velocity),
    channelRatio: row.channel_ratio == null ? null : Number(row.channel_ratio),
    engagementRate: Number(row.engagement_rate),
    freshness: Number(row.freshness),
    velocityPercentile: Number(row.velocity_percentile),
    channelRatioPercentile: row.channel_ratio_percentile == null ? null : Number(row.channel_ratio_percentile),
    engagementPercentile: Number(row.engagement_percentile),
    buyerIntent: row.buyer_intent,
    commerceFit: row.commerce_fit,
    breakoutScore: Number(row.breakout_score),
    opportunityScore: Number(row.opportunity_score),
    percentilePopulationSize: row.percentile_population_size,
    createdAt: row.created_at,
  }
}

function assertCreativeReusable(iteration) {
  if (isDirectProductRegistrationPlaceholder(iteration)) {
    throw new RevenueStoreError('CAMPAIGN_REGISTRATION_ONLY', 'Direct Product registration placeholders cannot become Creative or Publication evidence', 409)
  }
}

function creativeProductFacts(product) {
  const facts = []
  const add = (id, label, value, source = 'curated_product') => {
    if (value == null || value === '') return
    facts.push({ id, label, value, source })
  }
  add('product.name', '商品名', product.product_name)
  add('product.merchant', '販売元・ブランド', product.merchant)
  add('product.price', '確認価格', product.price_amount == null ? null : {
    amount: Number(product.price_amount), currency: product.currency,
    display: product.currency === 'JPY' ? `${Number(product.price_amount)}円` : `${Number(product.price_amount)} ${product.currency || ''}`.trim(),
  }, 'curated_product_price')
  add('product.category', '商品カテゴリ', product.product_category)
  for (const [index, [key, value]] of Object.entries(product.verified_facts || {}).entries()) {
    const slug = String(key).replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'fact'
    add(`verified.${index + 1}.${slug}`, `確認済み事実: ${key}`, value, 'human_verified')
  }
  const reserved = new Set(['product_name', 'merchant', 'product_url', 'affiliate_url', 'price_amount', 'currency', 'notes', 'assets'])
  for (const [index, [key, value]] of Object.entries(product.facts_snapshot || {}).entries()) {
    if (reserved.has(key) || value == null || typeof value === 'object') continue
    const slug = String(key).replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'fact'
    add(`snapshot.${index + 1}.${slug}`, `保存済み商品事実: ${key}`, value, 'curated_product_snapshot')
    if (facts.length >= 30) break
  }
  return facts
}

function analysisContext(item, kind, rankPosition) {
  return {
    kind, source_query_id: item.sourceQueryId,
    opportunity_id: kind === 'discovery' ? item.id : null,
    tracking_opportunity_id: kind === 'tracking' ? item.id : null,
    rank_position: rankPosition, score_version: item.scoreVersion, velocity_mode: item.velocityMode,
    views_velocity: item.viewsVelocity, channel_ratio: item.channelRatio, engagement_rate: item.engagementRate,
    freshness: item.freshness, velocity_percentile: item.velocityPercentile,
    channel_ratio_percentile: item.channelRatioPercentile, engagement_percentile: item.engagementPercentile,
    buyer_intent: item.buyerIntent, commerce_fit: item.commerceFit, breakout_score: item.breakoutScore,
    opportunity_score: item.opportunityScore, percentile_population_size: item.percentilePopulationSize,
    previous_view_count: item.previousViewCount ?? null, current_view_count: item.viewCount ?? null,
    current_captured_at: item.currentCapturedAt ?? null, previous_captured_at: item.previousCapturedAt ?? null,
    view_delta: item.viewIncrease ?? null, elapsed_hours: item.velocityElapsedHours ?? null,
    growth_ratio: item.growthRatio ?? null, growth_percent: item.growthPercent ?? null,
  }
}

function mergeAnalysisCandidates(discovery = [], tracking = [], limit = 1) {
  const candidates = new Map()
  for (const [kind, items] of [['discovery', discovery], ['tracking', tracking]]) {
    items.forEach((item, index) => {
      if (!item.sourceItemId) return
      const existing = candidates.get(item.sourceItemId) || { item, contexts: [] }
      existing.contexts.push(analysisContext(item, kind, index + 1))
      candidates.set(item.sourceItemId, existing)
    })
  }
  return [...candidates.values()].slice(0, Math.max(1, Math.min(Number(limit) || 1, 6)))
}

function productSearchTerms(output) {
  const ordered = [
    ...(Array.isArray(output?.product_search_keywords) ? output.product_search_keywords : []),
    output?.product_or_theme_name,
    ...(Array.isArray(output?.similar_product_categories) ? output.similar_product_categories : []),
  ]
  const seen = new Set()
  const terms = []
  for (const value of ordered) {
    const term = String(value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
    if (!term || term.length > 128 || seen.has(term)) continue
    seen.add(term); terms.push(term)
    if (terms.length === 3) break
  }
  return terms
}

function createSupabaseStore({
  url = process.env.SUPABASE_URL,
  serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const base = String(url).replace(/\/+$/, '')

  async function request(path, { method = 'GET', body, prefer } = {}) {
    let response
    try {
      response = await fetchImpl(`${base}/rest/v1/${path}`, {
        method,
        headers: {
          accept: 'application/json',
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'accept-profile': PROFILE,
          'content-profile': PROFILE,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(prefer ? { prefer } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      console.error('[revenue-lab] Supabase transport failure', { method, resource: path.split('?')[0] })
      throw new RevenueStoreError('SUPABASE_TRANSPORT_ERROR', 'Revenue Lab storage request failed')
    }
    const text = response.status === 204 ? '' : await response.text()
    let parsed = null
    if (text) {
      try { parsed = JSON.parse(text) }
      catch {
        console.error('[revenue-lab] Supabase returned invalid JSON', { method, resource: path.split('?')[0], status: response.status })
        throw new RevenueStoreError('SUPABASE_INVALID_RESPONSE', 'Revenue Lab storage response was invalid', response.status)
      }
    }
    if (!response.ok) {
      const providerCode = typeof parsed?.code === 'string' ? parsed.code.slice(0, 80) : null
      const providerMessage = typeof parsed?.message === 'string' ? parsed.message.slice(0, 300) : null
      console.error('[revenue-lab] Supabase request rejected', {
        method, resource: path.split('?')[0], status: response.status,
        ...(providerCode ? { providerCode } : {}),
        ...(providerMessage ? { providerMessage } : {}),
      })
      throw new RevenueStoreError('SUPABASE_HTTP_ERROR', 'Revenue Lab storage request was rejected', response.status, parsed)
    }
    return parsed
  }

  const rpc = (name, body) => request(`rpc/${name}`, { method: 'POST', body })

  async function getQuery(id) {
    const rows = await request(`source_queries?id=eq.${encodeURIComponent(id)}&select=*,sources(project_id)&limit=1`)
    return queryFromRow(rows?.[0])
  }

  async function listQueries() {
    const rows = await request('source_queries?select=*,sources(project_id)&order=created_at.asc&limit=3')
    return (rows || []).map(queryFromRow)
  }

  async function updateQuery(id, patch) {
    const rows = await request(`source_queries?id=eq.${encodeURIComponent(id)}&select=*`, {
      method: 'PATCH', body: patch, prefer: 'return=representation',
    })
    return queryFromRow(rows?.[0])
  }

  async function enqueueQuery(sourceQueryId, requestedDay) {
    return rpc('enqueue_youtube_job', { p_source_query_id: sourceQueryId, p_requested_day: requestedDay })
  }

  async function enqueueTracking(requestedDay) {
    const createdCount = await rpc('enqueue_tracking_jobs', { p_day: requestedDay })
    return { createdCount: Number(createdCount || 0) }
  }

  const inFilter = values => encodeURIComponent([...new Set(values)].map(value => `"${String(value).replace(/["\\]/g, '')}"`).join(','))

  async function enrichOpportunityReview(opportunities) {
    if (!opportunities.length) return opportunities
    const videoIds = opportunities.map(item => item.youtubeVideoId).filter(Boolean)
    const videoItems = videoIds.length ? await request(
      `source_items?item_type=eq.video&external_id=in.(${inFilter(videoIds)})&select=id,source_id,external_id,canonical_url`,
    ) : []
    const channelIds = opportunities.map(item => item.channelId).filter(Boolean)
    const channelItems = channelIds.length ? await request(
      `source_items?item_type=eq.channel&external_id=in.(${inFilter(channelIds)})&select=id,source_id,external_id`,
    ) : []
    const itemIds = [...videoItems, ...channelItems].map(item => item.id)
    const snapshots = itemIds.length ? await request(
      `source_item_snapshots?source_item_id=in.(${encodeURIComponent(itemIds.join(','))})&select=source_item_id,captured_at,view_count,subscriber_count,hidden_subscriber_count&order=captured_at.desc`,
    ) : []
    const videoByExternalId = new Map(videoItems.map(item => [item.external_id, item]))
    const channelBySourceAndExternalId = new Map(channelItems.map(item => [`${item.source_id}:${item.external_id}`, item]))
    const snapshotsByItemId = new Map()
    for (const snapshot of snapshots || []) {
      const itemSnapshots = snapshotsByItemId.get(snapshot.source_item_id) || []
      if (itemSnapshots.length < 2) itemSnapshots.push(snapshot)
      snapshotsByItemId.set(snapshot.source_item_id, itemSnapshots)
    }
    return opportunities.map(opportunity => {
      const videoItem = videoByExternalId.get(opportunity.youtubeVideoId)
      const channelItem = videoItem && opportunity.channelId
        ? channelBySourceAndExternalId.get(`${videoItem.source_id}:${opportunity.channelId}`)
        : null
      const videoSnapshots = videoItem ? snapshotsByItemId.get(videoItem.id) || [] : []
      const videoSnapshot = videoSnapshots[0]
      const previousVideoSnapshot = videoSnapshots[1]
      const channelSnapshot = channelItem ? snapshotsByItemId.get(channelItem.id)?.[0] : null
      const viewCount = videoSnapshot?.view_count == null ? null : Number(videoSnapshot.view_count)
      const previousViewCount = previousVideoSnapshot?.view_count == null ? null : Number(previousVideoSnapshot.view_count)
      const elapsedMilliseconds = new Date(videoSnapshot?.captured_at).getTime() - new Date(previousVideoSnapshot?.captured_at).getTime()
      const velocityElapsedHours = Number.isFinite(elapsedMilliseconds) && elapsedMilliseconds >= 0
        ? Math.max(elapsedMilliseconds / 3_600_000, 1)
        : null
      return {
        ...opportunity,
        sourceItemId: opportunity.sourceItemId || videoItem?.id || null,
        sourceUrl: videoItem?.canonical_url || null,
        viewCount,
        currentCapturedAt: videoSnapshot?.captured_at || null,
        previousViewCount,
        previousCapturedAt: previousVideoSnapshot?.captured_at || null,
        viewIncrease: viewCount == null || previousViewCount == null ? null : Math.max(viewCount - previousViewCount, 0),
        velocityElapsedHours,
        subscriberCount: channelSnapshot?.subscriber_count == null ? null : Number(channelSnapshot.subscriber_count),
        hiddenSubscriberCount: channelSnapshot?.hidden_subscriber_count === true,
      }
    })
  }

  async function productSearchesForAnalyses(analysisIds) {
    if (!analysisIds.length) return []
    const runs = await request(
      `product_search_runs?analysis_id=in.(${encodeURIComponent(analysisIds.join(','))})&select=*&order=created_at.desc&limit=30`,
    )
    const latestByAnalysis = new Map()
    for (const run of runs || []) if (!latestByAnalysis.has(run.analysis_id)) latestByAnalysis.set(run.analysis_id, run)
    const latestRuns = [...latestByAnalysis.values()]
    const runIds = latestRuns.map(run => run.id)
    const candidateRows = runIds.length ? await request(
      `product_candidates?product_search_run_id=in.(${encodeURIComponent(runIds.join(','))})&rank_position=lte.5&select=*&order=rank_position.asc`,
    ) : []
    const snapshotIds = candidateRows.map(row => row.offer_snapshot_id)
    const snapshots = snapshotIds.length ? await request(
      `product_offer_snapshots?id=in.(${encodeURIComponent(snapshotIds.join(','))})&select=*`,
    ) : []
    const snapshotById = new Map(snapshots.map(row => [row.id, row]))
    const candidateIds = candidateRows.map(row => row.id)
    const decisions = candidateIds.length ? await request(
      `product_candidate_decisions?product_candidate_id=in.(${encodeURIComponent(candidateIds.join(','))})&select=*&order=created_at.desc`,
    ) : []
    const latestDecisionByCandidate = new Map()
    for (const decision of decisions || []) if (!latestDecisionByCandidate.has(decision.product_candidate_id)) latestDecisionByCandidate.set(decision.product_candidate_id, decision)
    const candidatesByRun = new Map()
    for (const row of candidateRows || []) {
      const snapshot = snapshotById.get(row.offer_snapshot_id)
      if (!snapshot) continue
      const records = candidatesByRun.get(row.product_search_run_id) || []
      records.push({
        id: row.id, rankPosition: row.rank_position, scoreVersion: row.score_version,
        candidateScore: Number(row.candidate_score), keywordMatchScore: Number(row.keyword_match_score),
        searchCoverageScore: Number(row.search_coverage_score), providerRankScore: Number(row.provider_rank_score),
        reviewCountScore: Number(row.review_count_score), reviewAverageScore: Number(row.review_average_score),
        affiliateRateScore: Number(row.affiliate_rate_score), matchedKeywordCount: row.matched_keyword_count,
        scoreParameters: row.score_parameters, matchEvidence: row.match_evidence,
        title: snapshot.title, catchcopy: snapshot.catchcopy, productUrl: snapshot.product_url,
        affiliateUrl: snapshot.affiliate_url, imageUrls: snapshot.image_urls || [],
        priceAmount: snapshot.price_amount == null ? null : Number(snapshot.price_amount), currency: snapshot.currency,
        availability: snapshot.availability, shopId: snapshot.shop_id, shopName: snapshot.shop_name,
        shopUrl: snapshot.shop_url, genreId: snapshot.genre_id,
        reviewCount: snapshot.review_count == null ? null : Number(snapshot.review_count),
        reviewAverage: snapshot.review_average == null ? null : Number(snapshot.review_average),
        affiliateRate: snapshot.affiliate_rate == null ? null : Number(snapshot.affiliate_rate),
        capturedAt: snapshot.captured_at, decision: latestDecisionByCandidate.get(row.id) || null,
      })
      candidatesByRun.set(row.product_search_run_id, records)
    }
    return latestRuns.map(run => ({
      id: run.id, analysisId: run.analysis_id, status: run.status, provider: run.provider,
      providerApiVersion: run.provider_api_version, scoreVersion: run.score_version,
      inputFingerprint: run.input_fingerprint, keywords: run.input_snapshot?.keywords || [],
      requestedCount: run.requested_count, receivedCount: run.received_count,
      candidateCount: run.candidate_count, cacheExpiresAt: run.cache_expires_at,
      fetchedAt: run.fetched_at, errorCode: run.error_code,
      candidates: (candidatesByRun.get(run.id) || []).sort((a, b) => a.rankPosition - b.rankPosition),
    }))
  }

  async function manualCampaignsForProjects(projectIds) {
    if (!projectIds.length) return []
    const campaigns = await request(`campaigns?project_id=in.(${encodeURIComponent(projectIds.join(','))})&select=*&order=created_at.desc&limit=50`)
    if (!campaigns.length) return []
    const campaignIds = campaigns.map(row => row.id)
    const [origins, iterations] = await Promise.all([
      request(`campaign_origins?campaign_id=in.(${encodeURIComponent(campaignIds.join(','))})&select=*&order=created_at.asc`),
      request(`campaign_iterations?campaign_id=in.(${encodeURIComponent(campaignIds.join(','))})&select=*&order=iteration_number.asc`),
    ])
    const productSetIds = [...new Set(iterations.map(row => row.product_set_id).filter(Boolean))]
    const [productSets, productSetItems] = await Promise.all([
      productSetIds.length ? request(`campaign_product_sets?id=in.(${encodeURIComponent(productSetIds.join(','))})&select=*`) : [],
      productSetIds.length ? request(`campaign_product_set_items?product_set_id=in.(${encodeURIComponent(productSetIds.join(','))})&select=*&order=presentation_order.asc`) : [],
    ])
    const productSetItemIds = productSetItems.map(row => row.id)
    const productSetItemAssets = productSetItemIds.length ? await request(
      `campaign_product_set_item_assets?product_set_item_id=in.(${encodeURIComponent(productSetItemIds.join(','))})&select=*&order=asset_order.asc`,
    ) : []
    const productIds = [...new Set([...iterations.map(row => row.curated_product_id), ...productSetItems.map(row => row.curated_product_id)].filter(Boolean))]
    const iterationIds = iterations.map(row => row.id)
    const multiIterationIds = iterations.filter(row => row.product_set_id).map(row => row.id)
    const [products, publications, productAssets, productionRequests, productDestinations, archetypeRequests, compositionRequests] = await Promise.all([
      productIds.length ? request(`curated_products?id=in.(${encodeURIComponent(productIds.join(','))})&select=*`) : [],
      iterationIds.length ? request(`campaign_publications?campaign_iteration_id=in.(${encodeURIComponent(iterationIds.join(','))})&select=*&order=created_at.asc`) : [],
      productIds.length ? request(`product_assets?curated_product_id=in.(${encodeURIComponent(productIds.join(','))})&select=*&order=ordinal.asc`) : [],
      iterationIds.length ? request(`creative_production_requests?campaign_iteration_id=in.(${encodeURIComponent(iterationIds.join(','))})&select=*&order=revision_number.desc`) : [],
      productSetItemIds.length ? request(`campaign_product_destinations?product_set_item_id=in.(${encodeURIComponent(productSetItemIds.join(','))})&select=*`) : [],
      multiIterationIds.length ? request(`creative_archetype_requests?campaign_iteration_id=in.(${encodeURIComponent(multiIterationIds.join(','))})&select=*&order=revision_number.desc`) : [],
      multiIterationIds.length ? request(`final_composition_requests?campaign_iteration_id=in.(${encodeURIComponent(multiIterationIds.join(','))})&select=*&order=created_at.desc`) : [],
    ])
    const productAssetIds = productAssets.map(row => row.id)
    const productAssetRevisions = productAssetIds.length ? await request(
      `product_asset_revisions?product_asset_id=in.(${encodeURIComponent(productAssetIds.join(','))})&select=*&order=revision_number.desc`,
    ) : []
    const requestIds = productionRequests.map(row => row.id)
    const plans = requestIds.length ? await request(`creative_production_plans?production_request_id=in.(${encodeURIComponent(requestIds.join(','))})&select=*`) : []
    const planIds = plans.map(row => row.id)
    const generations = planIds.length ? await request(`video_generation_scenes?creative_production_plan_id=in.(${encodeURIComponent(planIds.join(','))})&select=*&order=attempt_number.desc`) : []
    const generationsByPlan = new Map()
    for (const row of generations) {
      const records = generationsByPlan.get(row.creative_production_plan_id) || []
      records.push({ id: row.id, runId: row.run_id, planId: row.creative_production_plan_id, sceneNumber: row.creative_scene_number,
        attemptNumber: row.attempt_number, provider: row.provider, providerVersion: row.provider_version, model: row.requested_model,
        providerTaskStatus: row.provider_task_status, durationSeconds: row.duration_seconds, aspectRatio: row.aspect_ratio,
        providerAdapterVersion: row.provider_adapter_version,
        generationMode: row.generation_mode || 'text_to_video', inputAssetId: row.input_asset_id,
        inputAssetRevisionId: row.input_asset_revision_id,
        inputAssetSnapshot: row.input_asset_snapshot ? {
          product_asset_id: row.input_asset_snapshot.product_asset_id,
          asset_revision_id: row.input_asset_snapshot.asset_revision_id,
          revision_number: row.input_asset_snapshot.revision_number,
          content_sha256: row.input_asset_snapshot.content_sha256,
          content_type: row.input_asset_snapshot.content_type,
          byte_size: row.input_asset_snapshot.byte_size,
          pixel_width: row.input_asset_snapshot.pixel_width,
          pixel_height: row.input_asset_snapshot.pixel_height,
          permission_snapshot: row.input_asset_snapshot.permission_snapshot,
          i2v_allowed_snapshot: row.input_asset_snapshot.i2v_allowed_snapshot,
          parent_revision_id: row.input_asset_snapshot.parent_revision_id,
          derivation_type: row.input_asset_snapshot.derivation_type,
          transformation_fingerprint: row.input_asset_snapshot.transformation_fingerprint,
        } : null,
        resolution: row.resolution, status: row.status, providerCost: row.provider_cost_amount == null ? null : Number(row.provider_cost_amount),
        costCurrency: row.provider_cost_currency, costProvenance: row.cost_provenance, outputUrl: row.output_url,
        promptBuilderVersion: row.prompt_builder_version, generationInputFingerprint: row.generation_input_fingerprint,
        submissionUncertain: row.submission_uncertain === true,
        safeErrorCode: row.safe_error_code, createdAt: row.created_at, submittedAt: row.submitted_at, completedAt: row.completed_at })
      generationsByPlan.set(row.creative_production_plan_id, records)
    }
    const planByRequest = new Map(plans.map(row => [row.production_request_id, row]))
    const productionByIteration = new Map()
    for (const row of productionRequests) {
      const plan = planByRequest.get(row.id); const records = productionByIteration.get(row.campaign_iteration_id) || []
      records.push({ requestId: row.id, archetype: row.archetype, revisionNumber: row.revision_number, status: row.status, promptVersion: row.prompt_version,
        archetype: row.archetype, schemaVersion: row.schema_version, requestedModel: row.requested_model, resolvedModel: row.resolved_model,
        inputFingerprint: row.input_fingerprint, generatedAt: row.generated_at, errorCode: row.error_code,
        planId: plan?.id || null, output: plan?.output_json || null, providerExport: plan?.provider_export || null,
        videoGenerations: plan ? generationsByPlan.get(plan.id) || [] : [] })
      productionByIteration.set(row.campaign_iteration_id, records)
    }
    const archetypeRequestIds = archetypeRequests.map(row => row.id)
    const archetypePlans = archetypeRequestIds.length ? await request(
      `creative_archetype_plans?request_id=in.(${encodeURIComponent(archetypeRequestIds.join(','))})&select=*`,
    ) : []
    const archetypePlanIds = archetypePlans.map(row => row.id)
    const creativeAudioArtifacts = archetypePlanIds.length ? await request(
      `creative_audio_artifacts?creative_archetype_plan_id=in.(${encodeURIComponent(archetypePlanIds.join(','))})&select=*&order=scene_id.asc,segment_order.asc`,
    ) : []
    const productCards = archetypePlanIds.length ? await request(
      `creative_product_cards?creative_archetype_plan_id=in.(${encodeURIComponent(archetypePlanIds.join(','))})&select=*&order=pick_number.asc`,
    ) : []
    const compositionRequestIds = compositionRequests.map(row => row.id)
    const compositionOutputs = compositionRequestIds.length ? await request(
      `final_composition_outputs?composition_request_id=in.(${encodeURIComponent(compositionRequestIds.join(','))})&select=*`,
    ) : []
    const cardsByPlan = new Map()
    for (const row of productCards) {
      const records = cardsByPlan.get(row.creative_archetype_plan_id) || []
      records.push({ id: row.id, productSetItemId: row.product_set_item_id,
        productAssetRevisionId: row.product_asset_revision_id, pickNumber: row.pick_number,
        rankPosition: row.rank_position, productName: row.product_name_snapshot,
        shortAppeal: row.short_appeal, verifiedFactRef: row.verified_fact_ref,
        verifiedFact: row.verified_fact_snapshot, price: row.price_snapshot,
        cardSnapshot: row.card_snapshot || null,
        cardTemplateVersion: row.card_template_version })
      cardsByPlan.set(row.creative_archetype_plan_id, records)
    }
    const outputByCompositionRequest = new Map(compositionOutputs.map(row => [row.composition_request_id, {
      id: row.id, contentSha256: row.content_sha256, byteSize: Number(row.byte_size),
      durationSeconds: Number(row.duration_seconds), pixelWidth: row.pixel_width,
      pixelHeight: row.pixel_height, fps: Number(row.fps), compositionFingerprint: row.composition_fingerprint,
    }]))
    const compositionsByPlan = new Map()
    for (const row of compositionRequests) {
      const records = compositionsByPlan.get(row.creative_archetype_plan_id) || []
      records.push({ id: row.id, status: row.status, provider: row.provider,
        providerVersion: row.provider_version, compositionFingerprint: row.composition_fingerprint,
        safeErrorCode: row.safe_error_code, createdAt: row.created_at, completedAt: row.completed_at,
        output: outputByCompositionRequest.get(row.id) || null })
      compositionsByPlan.set(row.creative_archetype_plan_id, records)
    }
    const archetypePlanByRequest = new Map(archetypePlans.map(row => [row.request_id, row]))
    const audioByPlan = new Map()
    for (const row of creativeAudioArtifacts) {
      const records = audioByPlan.get(row.creative_archetype_plan_id) || []
      records.push({ id: row.id, sceneId: row.scene_id, segmentId: row.segment_id,
        segmentOrder: row.segment_order, inputText: row.input_text, status: row.status,
        provider: row.provider, model: row.model, voice: row.voice,
        durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
        safeErrorCode: row.safe_error_code })
      audioByPlan.set(row.creative_archetype_plan_id, records)
    }
    const archetypesByIteration = new Map()
    for (const row of archetypeRequests) {
      const plan = archetypePlanByRequest.get(row.id)
      const records = archetypesByIteration.get(row.campaign_iteration_id) || []
      records.push({ requestId: row.id, revisionNumber: row.revision_number, status: row.status,
        promptVersion: row.prompt_version, schemaVersion: row.schema_version,
        requestedModel: row.requested_model, resolvedModel: row.resolved_model,
        safeErrorCode: row.safe_error_code, generatedAt: row.generated_at,
        planId: plan?.id || null, output: plan?.output_json || null,
        audioArtifacts: plan ? audioByPlan.get(plan.id) || [] : [],
        productCards: plan ? cardsByPlan.get(plan.id) || [] : [],
        compositions: plan ? compositionsByPlan.get(plan.id) || [] : [] })
      archetypesByIteration.set(row.campaign_iteration_id, records)
    }
    const revisionsByAsset = new Map()
    for (const row of productAssetRevisions) {
      const records = revisionsByAsset.get(row.product_asset_id) || []
      records.push({
        id: row.id, revisionNumber: row.revision_number, contentSha256: row.content_sha256,
        contentType: row.content_type, byteSize: Number(row.byte_size), pixelWidth: row.pixel_width,
        pixelHeight: row.pixel_height, permissionSnapshot: row.permission_snapshot,
        i2vAllowed: row.i2v_allowed_snapshot === true, parentRevisionId: row.parent_revision_id,
        derivationType: row.derivation_type, derivationSpec: row.derivation_spec,
        transformationFingerprint: row.transformation_fingerprint,
        availabilityStatus: row.availability_status, capturedAt: row.captured_at,
      })
      revisionsByAsset.set(row.product_asset_id, records)
    }
    const assetsByProduct = new Map()
    for (const row of productAssets) {
      const records = assetsByProduct.get(row.curated_product_id) || []
      records.push({ id: row.id, ordinal: row.ordinal, assetRole: row.asset_role, assetKind: row.asset_kind,
        assetUrl: row.asset_url, assetSource: row.asset_source, usagePermission: row.usage_permission, label: row.label,
        humanVerifiedAt: row.human_verified_at, creativeEligible: ['owned', 'licensed', 'authorized_reference'].includes(row.usage_permission),
        revisions: revisionsByAsset.get(row.id) || [] })
      assetsByProduct.set(row.curated_product_id, records)
    }
    const revisionById = new Map(productAssetRevisions.map(row => [row.id, row]))
    const destinationByItem = new Map(productDestinations.map(row => [row.product_set_item_id, row]))
    const itemAssetsByItem = new Map()
    for (const row of productSetItemAssets) {
      const records = itemAssetsByItem.get(row.product_set_item_id) || []
      const revision = revisionById.get(row.product_asset_revision_id)
      records.push({ id: row.id, assetOrder: row.asset_order, permissionSnapshot: row.permission_snapshot,
        assetRevision: revision ? { id: revision.id, revisionNumber: revision.revision_number,
          contentSha256: revision.content_sha256, availabilityStatus: revision.availability_status } : null })
      itemAssetsByItem.set(row.product_set_item_id, records)
    }
    const itemsBySet = new Map()
    for (const row of productSetItems) {
      const records = itemsBySet.get(row.product_set_id) || []
      const product = productById.get(row.curated_product_id)
      const revision = revisionById.get(row.product_asset_revision_id)
      const destination = destinationByItem.get(row.id)
      records.push({ id: row.id, presentationOrder: row.presentation_order,
        rankPosition: row.rank_position, productName: row.product_name_snapshot,
        verifiedFactRef: row.verified_fact_ref, verifiedFact: row.verified_fact_snapshot,
        price: row.price_snapshot, productSnapshot: row.product_snapshot,
        product: product ? { id: product.id, productName: product.product_name, merchant: product.merchant,
          productUrl: product.product_url, affiliateUrl: product.affiliate_url } : null,
        assetRevision: revision ? { id: revision.id, revisionNumber: revision.revision_number,
          contentSha256: revision.content_sha256, contentType: revision.content_type,
          byteSize: Number(revision.byte_size), pixelWidth: revision.pixel_width, pixelHeight: revision.pixel_height,
          permissionSnapshot: revision.permission_snapshot, availabilityStatus: revision.availability_status } : null,
        assetRevisions: itemAssetsByItem.get(row.id) || [],
        destination: destination ? { id: destination.id, kind: destination.destination_kind,
          url: destination.destination_url, snapshot: destination.lineage_snapshot } : null })
      itemsBySet.set(row.product_set_id, records)
    }
    const productSetById = new Map(productSets.map(row => [row.id, {
      id: row.id, archetype: row.archetype, selectionMode: row.selection_mode,
      status: row.status, selectionFingerprint: row.selection_fingerprint,
      createdAt: row.created_at, lockedAt: row.locked_at, items: itemsBySet.get(row.id) || [],
    }]))
    const productById = new Map(products.map(row => [row.id, row]))
    const publicationsByIteration = new Map()
    for (const row of publications) {
      const records = publicationsByIteration.get(row.campaign_iteration_id) || []
      records.push({ id: row.id, platform: row.platform, youtubeVideoId: row.youtube_video_id, youtubeChannelId: row.youtube_channel_id,
        canonicalUrl: row.canonical_url, title: row.title, publishedAt: row.published_at, status: row.status,
        initialMetadata: row.initial_metadata, createdAt: row.created_at })
      publicationsByIteration.set(row.campaign_iteration_id, records)
    }
    const originsByCampaign = new Map()
    for (const row of origins) { const records = originsByCampaign.get(row.campaign_id) || []; records.push({ id: row.id,
      contextKind: row.context_kind, opportunityId: row.opportunity_id, trackingOpportunityId: row.tracking_opportunity_id,
      sourceQueryId: row.source_query_id, rankPosition: row.rank_position, scoreVersion: row.score_version,
      originSnapshot: row.origin_snapshot }); originsByCampaign.set(row.campaign_id, records) }
    const iterationsByCampaign = new Map()
    for (const row of iterations) {
      const product = productById.get(row.curated_product_id); const records = iterationsByCampaign.get(row.campaign_id) || []
      records.push({ id: row.id, iterationNumber: row.iteration_number, status: row.status, sourceAnalysisId: row.source_analysis_id, productSetId: row.product_set_id,
        appealHypothesis: row.appeal_hypothesis, hookText: row.hook_text, contentOutline: row.content_outline,
        scriptText: row.script_text, registrationOnly: row.content_outline?.format === 'internal_placeholder'
          && row.content_outline?.reusable === false, treatmentFingerprint: row.treatment_fingerprint, lockedAt: row.locked_at,
        product: product ? { id: product.id, sourceKind: product.source_kind, discoveryChannel: product.discovery_channel,
          searchKeyword: product.search_keyword, merchant: product.merchant, productName: product.product_name,
          productUrl: product.product_url, affiliateUrl: product.affiliate_url, priceAmount: product.price_amount == null ? null : Number(product.price_amount),
          currency: product.currency, notes: product.notes, humanVerifiedAt: product.human_verified_at,
          productCategory: product.product_category, verifiedFacts: product.verified_facts || {}, cautions: product.cautions,
          isOwnProduct: product.is_own_product === true, factsSnapshot: product.facts_snapshot || {}, assets: assetsByProduct.get(product.id) || [] } : null,
        publications: publicationsByIteration.get(row.id) || [], publication: (publicationsByIteration.get(row.id) || [])[0] || null,
        productionPlans: productionByIteration.get(row.id) || [],
        productSet: row.product_set_id ? productSetById.get(row.product_set_id) || null : null,
        archetypePlans: archetypesByIteration.get(row.id) || [] })
      iterationsByCampaign.set(row.campaign_id, records)
    }
    return campaigns.map(row => ({ id: row.id, projectId: row.project_id, sourceItemId: row.source_item_id,
      analysisId: row.primary_analysis_id, lineageKind: row.lineage_kind || 'opportunity', name: row.name, objective: row.objective, status: row.status,
      analysisSnapshot: row.analysis_snapshot, createdAt: row.created_at, origins: originsByCampaign.get(row.id) || [],
      iterations: iterationsByCampaign.get(row.id) || [] }))
  }

  async function dashboard(limit = 3) {
    const data = await rpc('dashboard_snapshot', { p_limit: limit })
    const querySourceIds = [...new Set((data?.queries || []).map(row => row.source_id).filter(Boolean))]
    const [opportunities, runs, trackingRuns, projectSources] = await Promise.all([
      enrichOpportunityReview((data?.opportunities || []).map(opportunityFromRow)),
      request('collection_runs?select=id,source_query_id,status,captured_at,requested_count,received_count,scored_count,excluded_reason,error_code,completed_at&order=captured_at.desc&limit=1'),
      request('tracking_runs?status=eq.succeeded&select=*&order=captured_at.desc&limit=20'),
      querySourceIds.length ? request(`sources?id=in.(${encodeURIComponent(querySourceIds.join(','))})&select=id,project_id`) : [],
    ])
    const latestRun = runs?.[0]
    const latestTrackingByQuery = new Map()
    for (const run of trackingRuns || []) {
      if (!latestTrackingByQuery.has(run.source_query_id)) latestTrackingByQuery.set(run.source_query_id, run)
    }
    const latestTrackingRuns = [...latestTrackingByQuery.values()]
    const trackingRunIds = latestTrackingRuns.map(run => run.id)
    const trackingRows = trackingRunIds.length ? await request(
      `tracking_opportunities?tracking_run_id=in.(${encodeURIComponent(trackingRunIds.join(','))})&select=*&order=opportunity_score_raw.desc,breakout_score_raw.desc,published_at.desc,youtube_video_id.asc&limit=${Math.max(1, Math.min(limit, 3))}`,
    ) : []
    let trackingOpportunities = await enrichOpportunityReview((trackingRows || []).map(opportunityFromRow))
    const trackingItemIds = trackingOpportunities.map(item => item.sourceItemId).filter(Boolean)
    const trackingDetails = trackingItemIds.length ? await request(
      `tracking_run_items?tracking_run_id=in.(${encodeURIComponent(trackingRunIds.join(','))})&source_item_id=in.(${encodeURIComponent(trackingItemIds.join(','))})&select=tracking_run_id,source_item_id,previous_view_count,current_view_count,view_delta,elapsed_hours,views_velocity,growth_ratio,growth_percent,status`,
    ) : []
    const detailByRunAndItem = new Map((trackingDetails || []).map(row => [`${row.tracking_run_id}:${row.source_item_id}`, row]))
    trackingOpportunities = trackingOpportunities.map(item => {
      const detail = detailByRunAndItem.get(`${item.trackingRunId}:${item.sourceItemId}`)
      return detail ? {
        ...item,
        previousViewCount: detail.previous_view_count == null ? null : Number(detail.previous_view_count),
        viewCount: detail.current_view_count == null ? item.viewCount : Number(detail.current_view_count),
        viewIncrease: detail.view_delta == null ? null : Number(detail.view_delta),
        velocityElapsedHours: detail.elapsed_hours == null ? null : Number(detail.elapsed_hours),
        growthRatio: detail.growth_ratio == null ? null : Number(detail.growth_ratio),
        growthPercent: detail.growth_percent == null ? null : Number(detail.growth_percent),
      } : item
    })
    const analysisItemIds = [...new Set([...opportunities, ...trackingOpportunities].map(item => item.sourceItemId).filter(Boolean))]
    const analysisRequests = analysisItemIds.length ? await request(
      `ai_analysis_requests?source_item_id=in.(${encodeURIComponent(analysisItemIds.join(','))})&select=*&order=created_at.desc&limit=30`,
    ) : []
    const requestIds = analysisRequests.map(row => row.id)
    const analysisRows = requestIds.length ? await request(
      `ai_opportunity_analyses?analysis_request_id=in.(${encodeURIComponent(requestIds.join(','))})&select=*&limit=30`,
    ) : []
    const outputByRequest = new Map(analysisRows.map(row => [row.analysis_request_id, row]))
    const latestRequestByItem = new Map()
    for (const row of analysisRequests) if (!latestRequestByItem.has(row.source_item_id)) latestRequestByItem.set(row.source_item_id, row)
    const analyses = [...latestRequestByItem.values()].map(row => {
      const output = outputByRequest.get(row.id)
      return {
        id: output?.id || null, requestId: row.id, sourceItemId: row.source_item_id, status: row.status,
        inputSnapshotId: row.input_snapshot_id, inputFingerprint: row.input_fingerprint,
        promptVersion: row.prompt_version, schemaVersion: row.schema_version, requestedModel: row.requested_model,
        resolvedModel: row.resolved_model, generatedAt: row.generated_at,
        usage: {
          inputTokens: row.input_tokens, cachedInputTokens: row.cached_input_tokens,
          outputTokens: row.output_tokens, reasoningTokens: row.reasoning_tokens,
        },
        output: output?.output_json || null,
      }
    })
    const analysisIds = analyses.map(analysis => analysis.id).filter(Boolean)
    const projectIds = [...new Set((projectSources || []).map(row => row.project_id).filter(Boolean))]
    const [productSearches, campaigns] = await Promise.all([
      productSearchesForAnalyses(analysisIds), manualCampaignsForProjects(projectIds),
    ])
    return {
      queries: (data?.queries || []).map(queryFromRow),
      opportunities,
      trackingOpportunities,
      analyses,
      productSearches,
      campaigns,
      latestJob: data?.latest_job ? {
        id: data.latest_job.id,
        jobType: data.latest_job.job_type,
        status: data.latest_job.status,
        attempts: data.latest_job.attempts,
        errorCode: data.latest_job.error_code,
        errorMessage: data.latest_job.error_message,
        createdAt: data.latest_job.created_at,
        updatedAt: data.latest_job.updated_at,
        completedAt: data.latest_job.completed_at,
      } : null,
      latestRun: latestRun ? {
        id: latestRun.id,
        sourceQueryId: latestRun.source_query_id,
        status: latestRun.status,
        capturedAt: latestRun.captured_at,
        requestedCount: latestRun.requested_count,
        receivedCount: latestRun.received_count,
        scoredCount: latestRun.scored_count,
        excludedReason: latestRun.excluded_reason,
        errorCode: latestRun.error_code,
        completedAt: latestRun.completed_at,
      } : null,
      latestTrackingRun: latestTrackingRuns[0] ? {
        id: latestTrackingRuns[0].id,
        sourceQueryId: latestTrackingRuns[0].source_query_id,
        status: latestTrackingRuns[0].status,
        capturedAt: latestTrackingRuns[0].captured_at,
        targetCount: latestTrackingRuns[0].target_count,
        receivedCount: latestTrackingRuns[0].received_count,
        scoredCount: latestTrackingRuns[0].scored_count,
        waitingCount: latestTrackingRuns[0].waiting_count,
        missingCount: latestTrackingRuns[0].missing_count,
      } : null,
    }
  }

  async function enqueueAnalysisCandidates(limit = 1, { model = DEFAULT_MODEL } = {}) {
    const bounded = Math.max(1, Math.min(Number(limit) || 1, 6))
    const data = await dashboard(3)
    const queryById = new Map(data.queries.map(query => [query.id, query]))
    const selected = mergeAnalysisCandidates(data.opportunities, data.trackingOpportunities, bounded)
    const results = []
    for (const candidate of selected) {
      const { item, contexts } = candidate
      const querySummaries = [...new Map(contexts.map(context => [context.source_query_id, queryById.get(context.source_query_id)]).filter(([, query]) => query)).values()]
      const query = querySummaries[0] ? await getQuery(querySummaries[0].id) : null
      const snapshots = await request(
        `source_item_snapshots?source_item_id=eq.${encodeURIComponent(item.sourceItemId)}&select=id,captured_at&order=captured_at.desc&limit=1`,
      )
      const input = {
        analysis_basis: 'metadata_only',
        video: {
          source_item_id: item.sourceItemId, youtube_video_id: item.youtubeVideoId, title: item.title,
          channel_title: item.channelTitle || null, published_at: item.publishedAt, url: item.sourceUrl || null,
        },
        source_queries: querySummaries.map(value => ({ id: value.id, label: value.label, query_text: value.queryText })),
        contexts,
        limitations: [
          'No video description, transcript, audio, frames, product links, or affiliate links were provided.',
          'Growth explanations must remain metadata-based hypotheses.',
          'Saved deterministic scores and ranks are immutable inputs.',
        ],
      }
      const response = await rpc('enqueue_ai_analysis', {
        p_project_id: query?.projectId, p_source_item_id: item.sourceItemId,
        p_input_snapshot_id: snapshots?.[0]?.id || null, p_input_fingerprint: inputFingerprint(input),
        p_input_snapshot: input, p_prompt_version: PROMPT_VERSION, p_schema_version: SCHEMA_VERSION,
        p_requested_model: model, p_contexts: contexts,
      })
      results.push(response)
    }
    return { requestedCount: bounded, selectedCount: selected.length, records: results }
  }

  async function getAnalysisRequest(id) {
    const rows = await request(`ai_analysis_requests?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
    const row = rows?.[0]
    return row ? { id: row.id, inputSnapshot: row.input_snapshot, requestedModel: row.requested_model } : null
  }

  async function markAnalysisRunning(id) {
    await request(`ai_analysis_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status: 'running', updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function persistAnalysisSuccess(id, result) {
    const now = new Date().toISOString()
    await request('ai_opportunity_analyses?on_conflict=analysis_request_id', {
      method: 'POST', body: { analysis_request_id: id, recommendation: result.analysis.recommendation,
        evidence_quality: result.analysis.evidence_quality, product_or_theme_name: result.analysis.product_or_theme_name,
        output_json: result.analysis, updated_at: now }, prefer: 'resolution=merge-duplicates,return=minimal',
    })
    await request(`ai_analysis_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status: 'succeeded', resolved_model: result.resolvedModel,
        openai_response_id: result.responseId, input_tokens: result.usage.inputTokens,
        cached_input_tokens: result.usage.cachedInputTokens, output_tokens: result.usage.outputTokens,
        reasoning_tokens: result.usage.reasoningTokens, generated_at: now, updated_at: now, error_code: null },
      prefer: 'return=minimal',
    })
  }

  async function persistAnalysisFailure(id, error) {
    const status = error?.code === 'OPENAI_REFUSED' ? 'refused' : error?.code === 'OPENAI_INCOMPLETE' ? 'incomplete' : 'failed'
    await request(`ai_analysis_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status, error_code: String(error?.code || 'ANALYSIS_FAILED').slice(0, 80), updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    })
  }

  async function createAnalysisReview(analysisId, review) {
    const rows = await request('human_analysis_reviews?select=*', {
      method: 'POST', body: { analysis_id: analysisId, decision: review.decision, agreement: review.agreement, notes: review.notes || null },
      prefer: 'return=representation',
    })
    return rows?.[0] || null
  }

  async function enqueueProductSearch(analysisId, requestedDay) {
    const analyses = await request(`ai_opportunity_analyses?id=eq.${encodeURIComponent(analysisId)}&select=id,output_json&limit=1`)
    const analysis = analyses?.[0]
    if (!analysis?.output_json) {
      const error = new RevenueStoreError('ANALYSIS_NOT_FOUND', 'Successful AI analysis was not found', 404)
      throw error
    }
    const keywords = productSearchTerms(analysis.output_json)
    if (!keywords.length) throw new RevenueStoreError('PRODUCT_KEYWORDS_MISSING', 'AI analysis has no usable product search terms', 400)
    const input = {
      analysis_id: analysis.id,
      provider: RAKUTEN_PROVIDER_ID,
      provider_api_version: RAKUTEN_API_VERSION,
      score_version: PRODUCT_SCORE_VERSION,
      availability: 1,
      hits_per_keyword: 10,
      keywords,
      analysis_output: {
        product_or_theme_name: analysis.output_json.product_or_theme_name,
        similar_product_categories: analysis.output_json.similar_product_categories || [],
        product_search_keywords: analysis.output_json.product_search_keywords || [],
      },
    }
    return rpc('enqueue_product_search', {
      p_analysis_id: analysis.id, p_input_fingerprint: inputFingerprint(input), p_input_snapshot: input,
      p_provider: RAKUTEN_PROVIDER_ID, p_provider_api_version: RAKUTEN_API_VERSION,
      p_score_version: PRODUCT_SCORE_VERSION, p_requested_day: requestedDay,
    })
  }

  async function getProductSearchRun(id) {
    const rows = await request(`product_search_runs?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
    const row = rows?.[0]
    return row ? { id: row.id, analysisId: row.analysis_id, projectId: row.project_id, inputSnapshot: row.input_snapshot,
      provider: row.provider, providerApiVersion: row.provider_api_version, scoreVersion: row.score_version } : null
  }

  async function markProductSearchRunning(id) {
    await request(`product_search_runs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status: 'running', error_code: null, updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function persistProductSearchSuccess(id, searches, ranked) {
    const requestRows = await request('product_search_requests?select=id,keyword_index', {
      method: 'POST', body: searches.map((search, index) => ({
        product_search_run_id: id, keyword: search.keyword, keyword_index: index + 1,
        requested_hits: search.requestedHits, received_count: search.result.items.length,
        status: 'succeeded', provider_metadata: search.result.requestMetadata || {}, fetched_at: search.result.fetchedAt,
      })), prefer: 'return=representation',
    })
    const requestIdByIndex = new Map(requestRows.map(row => [Number(row.keyword_index), row.id]))
    const products = [...new Map(searches.flatMap(search => search.result.items).map(product => [product.providerProductId, product])).values()]
    const productRows = await request('catalog_products?on_conflict=provider,provider_product_id&select=id,provider_product_id', {
      method: 'POST', body: products.map(product => ({ provider: product.provider, provider_product_id: product.providerProductId, updated_at: new Date().toISOString() })),
      prefer: 'resolution=merge-duplicates,return=representation',
    })
    const productIdByExternal = new Map(productRows.map(row => [row.provider_product_id, row.id]))
    const snapshotInputs = []
    searches.forEach((search, searchIndex) => search.result.items.forEach(product => snapshotInputs.push({
      catalog_product_id: productIdByExternal.get(product.providerProductId), product_search_request_id: requestIdByIndex.get(searchIndex + 1),
      provider_api_version: search.result.apiVersion, captured_at: product.capturedAt, title: product.title,
      catchcopy: product.catchcopy, product_url: product.productUrl, affiliate_url: product.affiliateUrl,
      image_urls: product.imageUrls, price_amount: product.priceAmount, currency: product.currency,
      availability: product.availability, shop_id: product.shop.id, shop_name: product.shop.name, shop_url: product.shop.url,
      genre_id: product.genreId, review_count: product.reviewCount, review_average: product.reviewAverage,
      affiliate_rate: product.affiliateRate, provider_facts: product.providerFacts,
    })))
    const snapshotRows = await request('product_offer_snapshots?select=id,catalog_product_id', {
      method: 'POST', body: snapshotInputs, prefer: 'return=representation',
    })
    const firstSnapshotByProduct = new Map()
    for (const snapshot of snapshotRows) if (!firstSnapshotByProduct.has(snapshot.catalog_product_id)) firstSnapshotByProduct.set(snapshot.catalog_product_id, snapshot.id)
    await request('product_candidates', {
      method: 'POST', body: ranked.map(candidate => {
        const productId = productIdByExternal.get(candidate.product.providerProductId)
        return {
          product_search_run_id: id, catalog_product_id: productId, offer_snapshot_id: firstSnapshotByProduct.get(productId),
          score_version: candidate.scoreVersion, keyword_match_score: candidate.savedComponents.keywordMatch,
          search_coverage_score: candidate.savedComponents.searchCoverage, provider_rank_score: candidate.savedComponents.providerRank,
          review_count_score: candidate.savedComponents.reviewCount, review_average_score: candidate.savedComponents.reviewAverage,
          affiliate_rate_score: candidate.savedComponents.affiliateRate, candidate_score: candidate.candidateScore,
          candidate_score_raw: candidate.candidateScoreRaw, matched_keyword_count: candidate.matchedKeywordCount,
          rank_position: candidate.rankPosition, score_parameters: PRODUCT_SCORE_PARAMETERS,
          match_evidence: { matched_keywords: candidate.matchedKeywords, matches: candidate.matches },
        }
      }), prefer: 'return=minimal',
    })
    const fetchedAt = searches.map(search => search.result.fetchedAt).sort().at(-1) || new Date().toISOString()
    await request(`product_search_runs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status: 'succeeded', received_count: snapshotInputs.length, candidate_count: ranked.length,
        fetched_at: fetchedAt, cache_expires_at: new Date(new Date(fetchedAt).getTime() + 86_400_000).toISOString(),
        completed_at: new Date().toISOString(), updated_at: new Date().toISOString(), error_code: null }, prefer: 'return=minimal',
    })
  }

  async function persistProductSearchFailure(id, error) {
    await request(`product_search_runs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status: 'failed', error_code: String(error?.code || 'PRODUCT_SEARCH_FAILED').slice(0, 80),
        completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function createProductDecision(candidateId, analysisId, decision) {
    return rpc('record_product_candidate_decision', {
      p_candidate_id: candidateId, p_analysis_id: analysisId,
      p_decision: decision.decision, p_notes: decision.notes || null,
    })
  }

  async function createManualCampaign(analysisId, input) {
    const payload = {
      campaign: { name: input.campaignName, objective: input.objective || null },
      product: {
        source_kind: 'manual', discovery_channel: input.discoveryChannel,
        search_keyword: input.searchKeyword, merchant: input.merchant,
        product_name: input.productName, product_url: input.productUrl,
        affiliate_url: input.affiliateUrl || null, price_amount: input.priceAmount,
        currency: input.currency, notes: input.productNotes || null,
      },
      creative: {
        appeal_hypothesis: input.appealHypothesis, hook_text: input.hookText,
        content_outline: { format: 'plain_text', text: input.contentOutline },
        script_text: input.scriptText || null,
      },
      publication: input.youtubeVideoId ? {
        youtube_video_id: input.youtubeVideoId, title: input.publicationTitle || null,
        published_at: input.publishedAt || null,
      } : null,
    }
    const treatment = { product: payload.product, creative: payload.creative }
    return rpc('create_manual_campaign', {
      p_analysis_id: analysisId, p_payload: payload, p_treatment_fingerprint: inputFingerprint(treatment),
      p_request_fingerprint: inputFingerprint(payload),
      p_idempotency_key: input.idempotencyKey,
    })
  }

  async function getDefaultProject() {
    const rows = await request('projects?select=id,name&order=created_at.asc&limit=1')
    return rows?.[0] || null
  }

  async function createDirectProductCampaign(input) {
    const project = await getDefaultProject()
    if (!project?.id) throw new RevenueStoreError('DIRECT_PRODUCT_PROJECT_NOT_FOUND', 'Revenue Lab project was not found', 404)
    const product = {
      merchant: input.merchant, product_name: input.productName, product_url: input.productUrl,
      affiliate_url: input.affiliateUrl || null, price_amount: input.priceAmount,
      currency: input.currency, product_category: input.productCategory || null,
      verified_facts: { summary: input.verifiedFacts }, cautions: input.cautions || null,
      notes: input.productNotes || null, is_own_product: input.isOwnProduct,
      assets: input.assets.map((asset, index) => ({
        ordinal: index + 1, asset_kind: asset.assetKind, asset_url: asset.assetUrl,
        asset_source: asset.assetSource, usage_permission: asset.usagePermission,
        label: asset.label || null,
      })),
    }
    const creative = directProductCreativeSnapshot()
    const payload = {
      campaign: { name: input.campaignName, objective: input.objective || null },
      product,
      creative,
    }
    return rpc('create_direct_product_campaign', {
      p_project_id: project.id, p_payload: payload,
      p_treatment_fingerprint: inputFingerprint({
        lineage_kind: 'direct_product', product_facts: product, creative_hypotheses: creative,
      }),
      p_request_fingerprint: inputFingerprint(payload), p_idempotency_key: input.idempotencyKey,
    })
  }

  async function createThreePicksCampaign(input) {
    const project = await getDefaultProject()
    if (!project) throw new RevenueStoreError('PROJECT_NOT_FOUND', 'Revenue Lab project was not found', 404)
    if (!Array.isArray(input.items) || input.items.length !== 3
      || new Set(input.items.map(item => item.curatedProductId)).size !== 3) {
      throw new RevenueStoreError('THREE_PICKS_VALIDATION_ERROR', 'Exactly three distinct products are required', 400)
    }
    const payload = {
      archetype: 'three_picks_v1', selection_mode: 'human',
      campaign: { name: input.campaignName, objective: input.objective || null },
      creative: { appeal_hypothesis: input.appealHypothesis || null },
      items: input.items.map((item, index) => ({
        curated_product_id: item.curatedProductId,
        product_asset_revision_id: item.productAssetRevisionId,
        verified_fact_ref: item.verifiedFactRef,
        presentation_order: index + 1,
        rank_position: null,
      })),
    }
    return rpc('create_three_picks_campaign', {
      p_project_id: project.id, p_payload: payload,
      p_selection_fingerprint: inputFingerprint({ archetype: payload.archetype, selection_mode: payload.selection_mode, items: payload.items }),
      p_treatment_fingerprint: inputFingerprint({ archetype: payload.archetype, campaign: payload.campaign, creative: payload.creative, items: payload.items }),
      p_idempotency_key: input.idempotencyKey,
    })
  }

  async function createThreePicksV2Campaign(input) {
    const project = await getDefaultProject()
    if (!project) throw new RevenueStoreError('PROJECT_NOT_FOUND', 'Revenue Lab project was not found', 404)
    if (!Array.isArray(input.items) || input.items.length !== 3
      || new Set(input.items.map(item => item.curatedProductId)).size !== 3
      || input.items.some(item => !Array.isArray(item.productAssetRevisionIds)
        || item.productAssetRevisionIds.length < 1 || item.productAssetRevisionIds.length > 4
        || new Set(item.productAssetRevisionIds).size !== item.productAssetRevisionIds.length)) {
      throw new RevenueStoreError('THREE_PICKS_V2_VALIDATION_ERROR', 'Exactly three products with one to four distinct revisions are required', 400)
    }
    const payload = {
      archetype: THREE_PICKS_V2_ARCHETYPE, selection_mode: 'human',
      campaign: { name: input.campaignName, objective: input.objective || null },
      items: input.items.map((item, index) => ({ curated_product_id: item.curatedProductId,
        asset_revision_ids: item.productAssetRevisionIds, verified_fact_ref: item.verifiedFactRef,
        presentation_order: index + 1, rank_position: null })),
    }
    return rpc('create_three_picks_v2_campaign', {
      p_project_id: project.id, p_payload: payload,
      p_selection_fingerprint: inputFingerprint({ archetype: payload.archetype, selection_mode: payload.selection_mode, items: payload.items }),
      p_treatment_fingerprint: inputFingerprint({ archetype: payload.archetype, campaign: payload.campaign, items: payload.items }),
      p_idempotency_key: input.idempotencyKey,
    })
  }

  async function enqueueThreePicksPlan(iterationId, { idempotencyKey, model = THREE_PICKS_DEFAULT_MODEL } = {}) {
    const iterations = await request(`campaign_iterations?id=eq.${encodeURIComponent(iterationId)}&select=*&limit=1`)
    const iteration = iterations?.[0]
    if (!iteration?.product_set_id || iteration.curated_product_id) throw new RevenueStoreError('THREE_PICKS_ITERATION_NOT_FOUND', 'Three Picks iteration was not found', 404)
    const [campaignRows, setRows, itemRows] = await Promise.all([
      request(`campaigns?id=eq.${encodeURIComponent(iteration.campaign_id)}&select=*&limit=1`),
      request(`campaign_product_sets?id=eq.${encodeURIComponent(iteration.product_set_id)}&select=*&limit=1`),
      request(`campaign_product_set_items?product_set_id=eq.${encodeURIComponent(iteration.product_set_id)}&select=*&order=presentation_order.asc`),
    ])
    const campaign = campaignRows?.[0]; const set = setRows?.[0]
    if (!campaign || !set || set.status !== 'locked' || itemRows.length !== 3) throw new RevenueStoreError('THREE_PICKS_LINEAGE_INVALID', 'Three Picks lineage is incomplete', 409)
    const input = {
      contract: { archetype: 'three_picks_v1', ranking_allowed: false,
        prompt_version: THREE_PICKS_PROMPT_VERSION, schema_version: THREE_PICKS_SCHEMA_VERSION },
      campaign: { id: campaign.id, name: campaign.name, objective: campaign.objective },
      iteration: { id: iteration.id, appeal_hypothesis: iteration.appeal_hypothesis },
      products: itemRows.map(row => ({
        product_set_item_id: row.id, product_name: row.product_name_snapshot,
        display_name: compactDisplayName(row.product_name_snapshot),
        fact_badge: compactFactBadge(row.verified_fact_snapshot?.value),
        allowed_verified_fact_refs: [row.verified_fact_ref], verified_fact: row.verified_fact_snapshot,
        price: row.price_snapshot, original_presentation_order: row.presentation_order,
      })),
    }
    return rpc('enqueue_three_picks_plan', {
      p_campaign_iteration_id: iteration.id, p_input_snapshot: input,
      p_input_fingerprint: inputFingerprint(input), p_prompt_version: THREE_PICKS_PROMPT_VERSION,
      p_schema_version: THREE_PICKS_SCHEMA_VERSION, p_requested_model: model,
      p_idempotency_key: idempotencyKey,
    })
  }

  async function enqueueThreePicksV2Plan(iterationId, { idempotencyKey, model = THREE_PICKS_V2_DEFAULT_MODEL } = {}) {
    const iterations = await request(`campaign_iterations?id=eq.${encodeURIComponent(iterationId)}&select=*&limit=1`)
    const iteration = iterations?.[0]
    if (!iteration?.product_set_id || iteration.curated_product_id) throw new RevenueStoreError('THREE_PICKS_V2_ITERATION_NOT_FOUND', 'Creative Archetype v2 iteration was not found', 404)
    const [campaignRows, setRows, itemRows] = await Promise.all([
      request(`campaigns?id=eq.${encodeURIComponent(iteration.campaign_id)}&select=*&limit=1`),
      request(`campaign_product_sets?id=eq.${encodeURIComponent(iteration.product_set_id)}&select=*&limit=1`),
      request(`campaign_product_set_items?product_set_id=eq.${encodeURIComponent(iteration.product_set_id)}&select=*&order=presentation_order.asc`),
    ])
    const campaign = campaignRows?.[0]; const set = setRows?.[0]
    if (!campaign || set?.archetype !== THREE_PICKS_V2_ARCHETYPE || set.status !== 'locked' || itemRows.length !== 3) {
      throw new RevenueStoreError('THREE_PICKS_V2_LINEAGE_INVALID', 'Creative Archetype v2 lineage is incomplete', 409)
    }
    const itemAssets = await request(`campaign_product_set_item_assets?product_set_item_id=in.(${encodeURIComponent(itemRows.map(row => row.id).join(','))})&select=*&order=asset_order.asc`)
    const assetsByItem = new Map()
    for (const asset of itemAssets) {
      const records = assetsByItem.get(asset.product_set_item_id) || []
      records.push({ product_asset_revision_id: asset.product_asset_revision_id, asset_order: asset.asset_order,
        content_sha256: asset.content_sha256_snapshot })
      assetsByItem.set(asset.product_set_item_id, records)
    }
    if (itemRows.some(row => !(assetsByItem.get(row.id)?.length))) throw new RevenueStoreError('THREE_PICKS_V2_ASSET_INVALID', 'Every product requires an immutable asset revision', 409)
    const compact = (value, maximum) => Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, maximum).join('')
    const input = {
      contract: { archetype: THREE_PICKS_V2_ARCHETYPE, ranking_allowed: false,
        prompt_version: THREE_PICKS_V2_PROMPT_VERSION, schema_version: THREE_PICKS_V2_SCHEMA_VERSION,
        template_id: THREE_PICKS_V2_TEMPLATE_ID, template_selection: 'server_fixed' },
      campaign: { id: campaign.id, name: campaign.name, objective: campaign.objective },
      iteration: { id: iteration.id },
      products: itemRows.map(row => ({ product_set_item_id: row.id, presentation_order: row.presentation_order,
        product_name: row.product_name_snapshot, display_name: compact(row.product_name_snapshot, 18),
        fact_badge: compact(row.verified_fact_snapshot?.value, 18),
        allowed_verified_fact_refs: [row.verified_fact_ref], verified_fact: row.verified_fact_snapshot,
        price: row.price_snapshot, asset_revisions: assetsByItem.get(row.id) })),
    }
    return rpc('enqueue_three_picks_v2_plan', { p_campaign_iteration_id: iteration.id,
      p_input_snapshot: input, p_input_fingerprint: inputFingerprint(input),
      p_prompt_version: THREE_PICKS_V2_PROMPT_VERSION, p_schema_version: THREE_PICKS_V2_SCHEMA_VERSION,
      p_requested_model: model, p_idempotency_key: idempotencyKey })
  }

  async function getThreePicksRequest(id) {
    const rows = await request(`creative_archetype_requests?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
    const row = rows?.[0]
    return row ? { id: row.id, projectId: row.project_id, campaignId: row.campaign_id,
      iterationId: row.campaign_iteration_id, productSetId: row.product_set_id,
      revisionNumber: row.revision_number, promptVersion: row.prompt_version,
      schemaVersion: row.schema_version, requestedModel: row.requested_model,
      inputSnapshot: row.input_snapshot } : null
  }

  async function markThreePicksRunning(id) {
    await request(`creative_archetype_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status: 'running', safe_error_code: null, updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function persistThreePicksSuccess(requestRow, result) {
    const itemRows = await request(`campaign_product_set_items?product_set_id=eq.${encodeURIComponent(requestRow.productSetId)}&select=*&order=presentation_order.asc`)
    const itemIds = itemRows.map(row => row.id)
    const [destinations, revisions] = await Promise.all([
      request(`campaign_product_destinations?product_set_item_id=in.(${encodeURIComponent(itemIds.join(','))})&select=*`),
      request(`product_asset_revisions?id=in.(${encodeURIComponent(itemRows.map(row => row.product_asset_revision_id).join(','))})&select=*`),
    ])
    const destinationByItem = new Map(destinations.map(row => [row.product_set_item_id, row]))
    const revisionById = new Map(revisions.map(row => [row.id, row]))
    const items = itemRows.map(row => {
      const destination = destinationByItem.get(row.id); const revision = revisionById.get(row.product_asset_revision_id)
      return { id: row.id, productName: row.product_name_snapshot, verifiedFactRef: row.verified_fact_ref,
        verifiedFact: row.verified_fact_snapshot, price: row.price_snapshot,
        destination: { id: destination.id, snapshot: destination.lineage_snapshot },
        assetRevision: { id: revision.id, contentSha256: revision.content_sha256 } }
    })
    const cards = buildProductCards(result.productionPlan, items)
    const rendered = buildRenderManifest({ requestId: requestRow.id, planRevision: requestRow.revisionNumber,
      campaignId: requestRow.campaignId, iterationId: requestRow.iterationId,
      productSetId: requestRow.productSetId, plan: result.productionPlan, cards })
    const inserted = await request('creative_archetype_plans', {
      method: 'POST', body: { request_id: requestRow.id, project_id: requestRow.projectId,
        campaign_id: requestRow.campaignId, campaign_iteration_id: requestRow.iterationId,
        product_set_id: requestRow.productSetId, revision_number: requestRow.revisionNumber,
        archetype: 'three_picks_v1', schema_version: requestRow.schemaVersion,
        output_json: result.productionPlan, composition_manifest: rendered.manifest }, prefer: 'return=representation',
    })
    const plan = inserted?.[0]
    await request('creative_product_cards', {
      method: 'POST', body: cards.map(card => ({ creative_archetype_plan_id: plan.id,
        product_set_item_id: card.product_set_item_id, product_destination_id: card.product_destination_id,
        product_asset_revision_id: card.product_asset_revision_id, pick_number: card.pick_number,
        rank_position: null, product_name_snapshot: card.product_name, short_appeal: card.short_appeal,
        verified_fact_ref: card.verified_fact_ref, verified_fact_snapshot: card.verified_fact,
        price_snapshot: card.price, card_template_version: card.card_template_version, card_snapshot: card })),
      prefer: 'return=minimal',
    })
    const now = new Date().toISOString()
    await request(`creative_archetype_requests?id=eq.${encodeURIComponent(requestRow.id)}`, {
      method: 'PATCH', body: { status: 'succeeded', resolved_model: result.resolvedModel,
        openai_response_id: result.responseId, input_tokens: result.usage.inputTokens,
        cached_input_tokens: result.usage.cachedInputTokens, output_tokens: result.usage.outputTokens,
        reasoning_tokens: result.usage.reasoningTokens, generated_at: now, updated_at: now, safe_error_code: null }, prefer: 'return=minimal',
    })
    return { planId: plan.id, compositionFingerprint: rendered.compositionFingerprint }
  }

  async function persistThreePicksV2Success(requestRow, result) {
    const segments = planNarrationSegments(result.productionPlan)
    const preparationManifest = { manifest_version: 'three-picks-composition-manifest-v2-preparation',
      archetype: THREE_PICKS_V2_ARCHETYPE, template_id: THREE_PICKS_V2_TEMPLATE_ID,
      audio_status: 'planned', narration_segments: segments }
    const inserted = await request('creative_archetype_plans', { method: 'POST', body: {
      request_id: requestRow.id, project_id: requestRow.projectId, campaign_id: requestRow.campaignId,
      campaign_iteration_id: requestRow.iterationId, product_set_id: requestRow.productSetId,
      revision_number: requestRow.revisionNumber, archetype: THREE_PICKS_V2_ARCHETYPE,
      schema_version: requestRow.schemaVersion, output_json: result.productionPlan,
      composition_manifest: preparationManifest,
    }, prefer: 'return=representation' })
    const plan = inserted?.[0]
    if (!plan?.id) throw new RevenueStoreError('THREE_PICKS_V2_PLAN_PERSIST_FAILED', 'Creative Archetype v2 plan could not be persisted', 500)
    await request('creative_audio_artifacts', { method: 'POST', body: segments.map(segment => ({
      creative_archetype_plan_id: plan.id, scene_id: segment.scene, segment_id: segment.segment_id,
      segment_order: segment.segment_order, input_text: segment.text,
      input_sha256: inputFingerprint({ text: segment.text }), status: 'planned',
      request_fingerprint: inputFingerprint({ plan_id: plan.id, segment_id: segment.segment_id, text: segment.text }),
    })), prefer: 'return=minimal' })
    const now = new Date().toISOString()
    await request(`creative_archetype_requests?id=eq.${encodeURIComponent(requestRow.id)}`, {
      method: 'PATCH', body: { status: 'succeeded', resolved_model: result.resolvedModel,
        openai_response_id: result.responseId, input_tokens: result.usage.inputTokens,
        cached_input_tokens: result.usage.cachedInputTokens, output_tokens: result.usage.outputTokens,
        reasoning_tokens: result.usage.reasoningTokens, generated_at: now, updated_at: now, safe_error_code: null }, prefer: 'return=minimal',
    })
    return { planId: plan.id, audioArtifactCount: segments.length, audioStatus: 'planned' }
  }

  async function persistThreePicksFailure(id, error) {
    const status = error?.code === 'OPENAI_REFUSED' ? 'refused' : error?.code === 'OPENAI_INCOMPLETE' ? 'incomplete' : 'failed'
    await request(`creative_archetype_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status, safe_error_code: String(error?.code || 'THREE_PICKS_PLAN_FAILED').slice(0, 80),
        updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function enqueueFinalComposition(planId, { idempotencyKey } = {}) {
    const plans = await request(`creative_archetype_plans?id=eq.${encodeURIComponent(planId)}&select=*&limit=1`)
    const plan = plans?.[0]
    if (!plan?.composition_manifest) throw new RevenueStoreError('COMPOSITION_PLAN_NOT_FOUND', 'Three Picks plan was not found', 404)
    const compositionFingerprint = inputFingerprint({ version: COMPOSITION_VERSION, manifest: plan.composition_manifest })
    return rpc('enqueue_final_composition', { p_creative_archetype_plan_id: plan.id,
      p_provider: 'local_ffmpeg', p_provider_version: COMPOSITION_VERSION,
      p_composition_fingerprint: compositionFingerprint, p_render_manifest: plan.composition_manifest,
      p_idempotency_key: idempotencyKey })
  }

  async function enqueueFinalCompositionV2(planId, { idempotencyKey } = {}) {
    const plans = await request(`creative_archetype_plans?id=eq.${encodeURIComponent(planId)}&select=*&limit=1`)
    const plan = plans?.[0]
    if (!plan || plan.archetype !== THREE_PICKS_V2_ARCHETYPE) throw new RevenueStoreError('COMPOSITION_V2_PLAN_NOT_FOUND', 'Creative Archetype v2 plan was not found', 404)
    const itemRows = await request(`campaign_product_set_items?product_set_id=eq.${encodeURIComponent(plan.product_set_id)}&select=*&order=presentation_order.asc`)
    const itemIds = itemRows.map(row => row.id)
    const [links, artifacts] = await Promise.all([
      request(`campaign_product_set_item_assets?product_set_item_id=in.(${encodeURIComponent(itemIds.join(','))})&select=*&order=asset_order.asc`),
      request(`creative_audio_artifacts?creative_archetype_plan_id=eq.${encodeURIComponent(plan.id)}&select=*&order=scene_id.asc,segment_order.asc`),
    ])
    const items = itemRows.map(row => ({ id: row.id, presentationOrder: row.presentation_order,
      assetRevisions: links.filter(link => link.product_set_item_id === row.id).map(link => ({ id: link.product_asset_revision_id,
        assetOrder: link.asset_order, contentSha256: link.content_sha256_snapshot })) }))
    const audioArtifacts = artifacts.map(row => ({ id: row.id, segmentId: row.segment_id,
      segmentOrder: row.segment_order, status: row.status, durationSeconds: row.duration_seconds,
      immutableObjectKey: row.immutable_object_key, audioSha256: row.audio_sha256 }))
    let compiled
    try {
      compiled = compileThreePicksV2Manifest({ requestId: plan.request_id, planRevision: plan.revision_number,
        campaignId: plan.campaign_id, iterationId: plan.campaign_iteration_id, productSetId: plan.product_set_id,
        plan: plan.output_json, items, audioArtifacts })
    } catch (error) {
      throw new RevenueStoreError(error?.code || 'COMPOSITION_V2_MANIFEST_INVALID', 'Creative Archetype v2 composition is not ready', 409)
    }
    return rpc('enqueue_final_composition_v2', { p_creative_archetype_plan_id: plan.id,
      p_provider: 'local_ffmpeg', p_provider_version: COMPOSITION_V2_VERSION,
      p_composition_fingerprint: compiled.compositionFingerprint, p_render_manifest: compiled.manifest,
      p_idempotency_key: idempotencyKey })
  }

  async function getFinalCompositionRequest(id) {
    const rows = await request(`final_composition_requests?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
    const row = rows?.[0]
    if (!row) return null
    const plans = await request(`creative_archetype_plans?id=eq.${encodeURIComponent(row.creative_archetype_plan_id)}&select=*&limit=1`)
    const plan = plans?.[0]
    let revisionIds = []; let audioAssets = []
    if (plan?.archetype === THREE_PICKS_V2_ARCHETYPE) {
      const items = await request(`campaign_product_set_items?product_set_id=eq.${encodeURIComponent(plan.product_set_id)}&select=id`)
      const links = items.length ? await request(`campaign_product_set_item_assets?product_set_item_id=in.(${encodeURIComponent(items.map(item => item.id).join(','))})&select=*`) : []
      revisionIds = links.map(link => link.product_asset_revision_id)
      const artifacts = await request(`creative_audio_artifacts?creative_archetype_plan_id=eq.${encodeURIComponent(plan.id)}&status=eq.ready&select=*&order=scene_id.asc,segment_order.asc`)
      audioAssets = artifacts.map(artifact => ({ id: artifact.id, segmentId: artifact.segment_id,
        immutableObjectKey: artifact.immutable_object_key, contentSha256: artifact.audio_sha256 }))
    } else {
      const cards = await request(`creative_product_cards?creative_archetype_plan_id=eq.${encodeURIComponent(row.creative_archetype_plan_id)}&select=*`)
      revisionIds = cards.map(card => card.product_asset_revision_id)
    }
    const revisions = revisionIds.length
      ? await request(`product_asset_revisions?id=in.(${encodeURIComponent(revisionIds.join(','))})&select=*`) : []
    return { id: row.id, projectId: row.project_id, campaignId: row.campaign_id,
      iterationId: row.campaign_iteration_id, planId: row.creative_archetype_plan_id,
      archetype: plan?.archetype || 'three_picks_v1',
      provider: row.provider, providerVersion: row.provider_version,
      compositionFingerprint: row.composition_fingerprint, renderManifest: row.render_manifest,
      assets: revisions.map(revision => ({ id: revision.id, immutableObjectKey: revision.immutable_object_key,
        contentSha256: revision.content_sha256 })), audioAssets }
  }

  async function markFinalCompositionRendering(id) {
    await request(`final_composition_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status: 'rendering', safe_error_code: null, started_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function persistFinalCompositionSuccess(composition, output) {
    const now = new Date().toISOString()
    await request('final_composition_outputs', { method: 'POST', body: {
      composition_request_id: composition.id, project_id: composition.projectId,
      campaign_id: composition.campaignId, campaign_iteration_id: composition.iterationId,
      storage_provider: output.storageProvider, storage_bucket: output.storageBucket,
      immutable_object_key: output.immutableObjectKey, content_sha256: output.contentSha256,
      content_type: 'video/mp4', byte_size: output.byteSize,
      duration_seconds: output.durationSeconds, pixel_width: output.pixelWidth,
      pixel_height: output.pixelHeight, fps: output.fps,
      composition_fingerprint: composition.compositionFingerprint, render_manifest: composition.renderManifest,
    }, prefer: 'return=minimal' })
    await request(`final_composition_requests?id=eq.${encodeURIComponent(composition.id)}`, {
      method: 'PATCH', body: { status: 'succeeded', safe_error_code: null, completed_at: now }, prefer: 'return=minimal',
    })
  }

  async function persistFinalCompositionFailure(id, error) {
    await request(`final_composition_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status: 'failed', safe_error_code: String(error?.code || 'COMPOSITION_FAILED').slice(0, 80),
        completed_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function getFinalCompositionOutput(id) {
    const rows = await request(`final_composition_outputs?id=eq.${encodeURIComponent(id)}&select=id,immutable_object_key&limit=1`)
    return rows?.[0] ? { id: rows[0].id, immutableObjectKey: rows[0].immutable_object_key } : null
  }

  async function enqueueCreativeProduction(iterationId, { idempotencyKey, model = CREATIVE_DEFAULT_MODEL } = {}) {
    const iterations = await request(`campaign_iterations?id=eq.${encodeURIComponent(iterationId)}&select=*&limit=1`)
    const iteration = iterations?.[0]
    if (!iteration) throw new RevenueStoreError('CAMPAIGN_ITERATION_NOT_FOUND', 'Campaign iteration was not found', 404)
    assertCreativeReusable(iteration)
    if (!iteration.curated_product_id || iteration.product_set_id) {
      throw new RevenueStoreError('CREATIVE_PRODUCTION_SINGLE_PRODUCT_REQUIRED', 'Legacy Creative Production requires a single-product iteration', 409)
    }
    const [campaignRows, productRows, assetRows] = await Promise.all([
      request(`campaigns?id=eq.${encodeURIComponent(iteration.campaign_id)}&select=*&limit=1`),
      request(`curated_products?id=eq.${encodeURIComponent(iteration.curated_product_id)}&select=*&limit=1`),
      request(`product_assets?curated_product_id=eq.${encodeURIComponent(iteration.curated_product_id)}&select=*&order=ordinal.asc`),
    ])
    const campaign = campaignRows?.[0]
    const product = productRows?.[0]
    if (!campaign || !product) throw new RevenueStoreError('CREATIVE_PRODUCTION_LINEAGE_NOT_FOUND', 'Campaign product lineage was not found', 404)
    if (campaign.status === 'voided') throw new RevenueStoreError('CAMPAIGN_IMMUTABLE', 'Voided Campaign cannot create production plans', 409)
    const facts = creativeProductFacts(product)
    const input = {
      contract: { target_format: 'youtube_shorts', aspect_ratio: '9:16', provider_neutral: true, schema_version: CREATIVE_SCHEMA_VERSION },
      campaign: { id: campaign.id, name: campaign.name, objective: campaign.objective, lineage_kind: campaign.lineage_kind || 'opportunity' },
      iteration: {
        id: iteration.id, iteration_number: iteration.iteration_number, status: iteration.status,
        purpose: campaign.objective || null, appeal_hypothesis: iteration.appeal_hypothesis,
        hook: iteration.hook_text, outline: iteration.content_outline, script: iteration.script_text,
      },
      product: {
        id: product.id, source_kind: product.source_kind, product_name: product.product_name,
        merchant: product.merchant, product_category: product.product_category,
        is_own_product: product.is_own_product === true, cautions: product.cautions || null,
      },
      verified_product_facts: facts,
      product_assets: assetRows.map(row => {
        const explicitI2v = row.registered_facts?.i2v_allowed === true
        const owned = row.usage_permission === 'owned'
        return {
          id: row.id, ordinal: row.ordinal, asset_kind: row.asset_kind,
          asset_source: row.asset_source, usage_permission: row.usage_permission,
          label: row.label,
          static_eligible: ['owned', 'licensed', 'authorized_reference'].includes(row.usage_permission),
          i2v_eligible: owned || explicitI2v,
          i2v_permission_source: owned ? 'owned' : explicitI2v ? 'explicit' : 'not_confirmed',
        }
      }),
      constraints: [
        'Use only verified_product_facts for product claims and cite fact IDs.',
        'Never infer or generate the product body appearance.',
        'Use static_product_scene as the first choice for accurate product display.',
        'Use image_motion_scene only when i2v_eligible is true and preserve product identity.',
        'Use stylized or realistic AI scenes only when accurate product depiction is not required.',
      ],
    }
    return rpc('enqueue_creative_production_plan', {
      p_campaign_iteration_id: iterationId, p_input_snapshot: input,
      p_input_fingerprint: inputFingerprint(input), p_prompt_version: CREATIVE_PROMPT_VERSION,
      p_schema_version: CREATIVE_SCHEMA_VERSION, p_requested_model: model,
      p_idempotency_key: idempotencyKey,
    })
  }

  async function getCreativeProductionRequest(id) {
    const rows = await request(`creative_production_requests?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
    const row = rows?.[0]
    return row ? { id: row.id, projectId: row.project_id, campaignId: row.campaign_id,
      iterationId: row.campaign_iteration_id, productId: row.curated_product_id,
      revisionNumber: row.revision_number, schemaVersion: row.schema_version,
      inputSnapshot: row.input_snapshot, requestedModel: row.requested_model } : null
  }

  async function markCreativeProductionRunning(id) {
    await request(`creative_production_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status: 'running', error_code: null, updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function persistCreativeProductionSuccess(requestRow, result) {
    assertCreativeReusable(requestRow.inputSnapshot?.iteration)
    const now = new Date().toISOString()
    const plan = result.productionPlan
    const isV2 = requestRow.schemaVersion === CREATIVE_SCHEMA_VERSION
    const providerExport = {
      export_version: isV2 ? CREATIVE_EXPORT_VERSION : 'provider-neutral-shorts-v1', generation_provider: null,
      target: { format: plan.target_format, aspect_ratio: plan.aspect_ratio, duration_seconds: plan.target_duration_seconds },
      asset_bindings: plan.scenes.filter(scene => scene.product_asset_id).map(scene => ({ scene_number: scene.scene_number, product_asset_id: scene.product_asset_id })),
      generation_prompts: plan.scenes.filter(scene => scene.ai_generation_prompt).map(scene => ({ scene_number: scene.scene_number, prompt: scene.ai_generation_prompt })),
      timeline: plan.scenes,
    }
    if (isV2) {
      providerExport.rendering_routes = plan.scenes.map(scene => ({
        scene_number: scene.scene_number, rendering_strategy: scene.rendering_strategy,
        recommended_model_class: scene.recommended_model_class,
        requires_ai_generation: scene.requires_ai_generation,
        preserve_product_identity: scene.preserve_product_identity,
        motion_instruction: scene.motion_instruction,
      }))
    }
    await request('creative_production_plans?on_conflict=production_request_id', {
      method: 'POST', body: {
        production_request_id: requestRow.id, project_id: requestRow.projectId,
        campaign_id: requestRow.campaignId, campaign_iteration_id: requestRow.iterationId,
        curated_product_id: requestRow.productId, revision_number: requestRow.revisionNumber,
        schema_version: requestRow.schemaVersion, output_json: plan, provider_export: providerExport,
      }, prefer: 'resolution=ignore-duplicates,return=minimal',
    })
    await request(`creative_production_requests?id=eq.${encodeURIComponent(requestRow.id)}`, {
      method: 'PATCH', body: { status: 'succeeded', resolved_model: result.resolvedModel,
        openai_response_id: result.responseId, input_tokens: result.usage.inputTokens,
        cached_input_tokens: result.usage.cachedInputTokens, output_tokens: result.usage.outputTokens,
        reasoning_tokens: result.usage.reasoningTokens, generated_at: now, updated_at: now, error_code: null },
      prefer: 'return=minimal',
    })
  }

  async function persistCreativeProductionFailure(id, error) {
    const status = error?.code === 'OPENAI_REFUSED' ? 'refused' : error?.code === 'OPENAI_INCOMPLETE' ? 'incomplete' : 'failed'
    await request(`creative_production_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { status, error_code: String(error?.code || 'CREATIVE_PRODUCTION_FAILED').slice(0, 80),
        updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function enqueueVideoGeneration(planId, sceneNumber, {
    idempotencyKey, regenerate = false, model = POLLO_DEFAULT_MODEL,
    provider = POLLO_PROVIDER_ID, providerVersion = POLLO_PROVIDER_VERSION,
    resolution = POLLO_DEFAULT_RESOLUTION,
  } = {}) {
    const rows = await request(`creative_production_plans?id=eq.${encodeURIComponent(planId)}&select=*&limit=1`)
    const plan = rows?.[0]
    if (!plan) throw new RevenueStoreError('VIDEO_GENERATION_PLAN_NOT_FOUND', 'Creative Production plan was not found', 404)
    const scene = (plan.output_json?.scenes || []).find(item => Number(item.scene_number) === Number(sceneNumber))
    if (!scene) throw new RevenueStoreError('VIDEO_GENERATION_SCENE_NOT_FOUND', 'Creative scene was not found', 404)
    if (scene.visual_source_type !== 'ai_generated_scene' || !scene.ai_generation_prompt) {
      throw new RevenueStoreError('VIDEO_GENERATION_SCENE_INELIGIBLE', 'Only AI-generated scenes can use a video provider', 409)
    }
    const requestedModel = validatedModel(model)
    const durationSeconds = normalizedDuration(scene.duration_seconds)
    const promptFingerprint = inputFingerprint({ prompt: scene.ai_generation_prompt })
    const requestFingerprint = inputFingerprint({
      plan_id: planId, scene_number: Number(sceneNumber), provider, provider_version: providerVersion,
      model: requestedModel, prompt_fingerprint: promptFingerprint, duration_seconds: durationSeconds,
      aspect_ratio: '9:16', resolution, audio_enabled: false,
    })
    return rpc('enqueue_video_generation_scene', {
      p_creative_production_plan_id: planId, p_scene_number: Number(sceneNumber),
      p_provider: provider, p_provider_version: providerVersion, p_requested_model: requestedModel,
      p_prompt_fingerprint: promptFingerprint, p_request_fingerprint: requestFingerprint,
      p_duration_seconds: durationSeconds, p_resolution: resolution,
      p_idempotency_key: idempotencyKey, p_regenerate: regenerate === true,
    })
  }

  async function getProductAsset(id) {
    const rows = await request(`product_assets?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
    const row = rows?.[0]
    return row ? {
      id: row.id, curatedProductId: row.curated_product_id, assetUrl: row.asset_url,
      usagePermission: row.usage_permission, assetKind: row.asset_kind, label: row.label,
    } : null
  }

  async function registerProductAssetRevision(assetId, revision) {
    const row = await rpc('register_product_asset_revision', {
      p_product_asset_id: assetId, p_source_url_snapshot: revision.sourceUrl,
      p_storage_provider: revision.storageProvider, p_storage_bucket: revision.storageBucket,
      p_immutable_object_key: revision.immutableObjectKey, p_content_sha256: revision.contentSha256,
      p_content_type: revision.contentType, p_byte_size: revision.byteSize,
      p_pixel_width: revision.pixelWidth, p_pixel_height: revision.pixelHeight,
      p_i2v_allowed: revision.i2vAllowed === true, p_parent_revision_id: revision.parentRevisionId,
      p_derivation_type: revision.derivationType, p_derivation_spec: revision.derivationSpec,
      p_transformation_fingerprint: revision.derivationFingerprint,
    })
    return {
      id: row.id, productAssetId: row.product_asset_id, revisionNumber: row.revision_number,
    }
  }

  async function enqueueImageVideoGeneration(planId, sceneNumber, assetRevisionId, {
    idempotencyKey, regenerate = false, model = WAN_MODEL, provider = WAN_PROVIDER_ID,
    providerVersion = WAN_PROVIDER_VERSION, providerAdapterVersion = WAN_ADAPTER_VERSION,
  } = {}) {
    if (model !== WAN_MODEL || provider !== WAN_PROVIDER_ID || providerVersion !== WAN_PROVIDER_VERSION) {
      throw new RevenueStoreError('VIDEO_GENERATION_PROVIDER_MISMATCH', 'Unsupported I2V provider configuration', 409)
    }
    const [plans, revisions] = await Promise.all([
      request(`creative_production_plans?id=eq.${encodeURIComponent(planId)}&select=*&limit=1`),
      request(`product_asset_revisions?id=eq.${encodeURIComponent(assetRevisionId)}&select=*&limit=1`),
    ])
    const plan = plans?.[0]; const revision = revisions?.[0]
    if (!plan) throw new RevenueStoreError('VIDEO_GENERATION_PLAN_NOT_FOUND', 'Creative Production plan was not found', 404)
    if (!revision) throw new RevenueStoreError('PRODUCT_ASSET_REVISION_NOT_FOUND', 'Product Asset revision was not found', 404)
    const scene = (plan.output_json?.scenes || []).find(item => Number(item.scene_number) === Number(sceneNumber))
    if (!scene || scene.rendering_strategy !== 'image_motion_scene' || scene.visual_source_type !== 'real_product_asset') {
      throw new RevenueStoreError('VIDEO_GENERATION_SCENE_INELIGIBLE', 'Only image-motion scenes can use I2V', 409)
    }
    if (scene.product_asset_id !== revision.product_asset_id || revision.permission_snapshot !== 'owned'
      || revision.i2v_allowed_snapshot !== true || revision.pixel_width * 16 !== revision.pixel_height * 9) {
      throw new RevenueStoreError('ASSET_I2V_PERMISSION_DENIED', 'A verified owned 9:16 revision with explicit I2V permission is required', 409)
    }
    const prompts = buildProductIdentityPrompt()
    const promptFingerprint = inputFingerprint({ positive_prompt: prompts.positivePrompt, negative_prompt: prompts.negativePrompt })
    const generationInput = {
      plan_revision: plan.revision_number, plan_id: planId, scene_number: Number(sceneNumber),
      provider, provider_version: providerVersion, adapter_version: providerAdapterVersion, model,
      asset_revision_id: revision.id, asset_sha256: revision.content_sha256,
      derivation_fingerprint: revision.transformation_fingerprint,
      prompt_builder_version: prompts.version, positive_prompt: prompts.positivePrompt,
      negative_prompt: prompts.negativePrompt, duration_seconds: 5, resolution: '720p',
      aspect_ratio: '9:16', audio_enabled: false,
    }
    const generationInputFingerprint = inputFingerprint(generationInput)
    const requestFingerprint = inputFingerprint({ ...generationInput, generation_input_fingerprint: generationInputFingerprint })
    return rpc('enqueue_image_video_generation_scene', {
      p_creative_production_plan_id: planId, p_scene_number: Number(sceneNumber), p_provider: provider,
      p_provider_version: providerVersion, p_provider_adapter_version: providerAdapterVersion,
      p_requested_model: model, p_asset_revision_id: assetRevisionId,
      p_positive_prompt: prompts.positivePrompt, p_negative_prompt: prompts.negativePrompt,
      p_prompt_builder_version: prompts.version, p_prompt_fingerprint: promptFingerprint,
      p_generation_input_fingerprint: generationInputFingerprint, p_request_fingerprint: requestFingerprint,
      p_duration_seconds: 5, p_resolution: '720p', p_idempotency_key: idempotencyKey,
      p_regenerate: regenerate === true,
    })
  }

  async function getVideoGenerationScene(id) {
    const rows = await request(`video_generation_scenes?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
    const row = rows?.[0]
    return row ? {
      id: row.id, runId: row.run_id, planId: row.creative_production_plan_id,
      sceneNumber: row.creative_scene_number, attemptNumber: row.attempt_number,
      provider: row.provider, providerVersion: row.provider_version, requestedModel: row.requested_model,
      providerTaskId: row.provider_task_id, providerTaskStatus: row.provider_task_status,
      promptSnapshot: row.prompt_snapshot,
      negativePromptSnapshot: row.negative_prompt_snapshot, promptBuilderVersion: row.prompt_builder_version,
      generationMode: row.generation_mode || 'text_to_video', inputAssetId: row.input_asset_id,
      inputAssetRevisionId: row.input_asset_revision_id, inputAssetSnapshot: row.input_asset_snapshot,
      providerAdapterVersion: row.provider_adapter_version, submissionUncertain: row.submission_uncertain === true,
      durationSeconds: row.duration_seconds, aspectRatio: row.aspect_ratio, resolution: row.resolution,
      status: row.status,
    } : null
  }

  async function markVideoGenerationSubmitting(scene) {
    const now = new Date().toISOString()
    await Promise.all([
      request(`video_generation_scenes?id=eq.${encodeURIComponent(scene.id)}`, { method: 'PATCH', body: { status: 'submitting', safe_error_code: null, updated_at: now }, prefer: 'return=minimal' }),
      request(`video_generation_runs?id=eq.${encodeURIComponent(scene.runId)}`, { method: 'PATCH', body: { status: 'running', safe_error_code: null }, prefer: 'return=minimal' }),
    ])
  }

  async function persistVideoGenerationTask(sceneId, receipt) {
    await request(`video_generation_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
      method: 'PATCH', body: { provider_task_id: receipt.providerTaskId, provider_task_status: receipt.providerTaskStatus,
        status: 'polling', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function persistVideoGenerationPolling(sceneId, result) {
    await request(`video_generation_scenes?id=eq.${encodeURIComponent(sceneId)}`, {
      method: 'PATCH', body: { status: 'polling', provider_task_status: result.providerTaskStatus,
        updated_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function markVideoGenerationPollingResume(scene) {
    const now = new Date().toISOString()
    await Promise.all([
      request(`video_generation_scenes?id=eq.${encodeURIComponent(scene.id)}`, {
        method: 'PATCH', body: { status: 'polling', safe_error_code: null, completed_at: null, updated_at: now }, prefer: 'return=minimal',
      }),
      request(`video_generation_runs?id=eq.${encodeURIComponent(scene.runId)}`, {
        method: 'PATCH', body: { status: 'running', safe_error_code: null, completed_at: null }, prefer: 'return=minimal',
      }),
    ])
  }

  async function persistVideoGenerationPollingInterrupted(scene, error) {
    const now = new Date().toISOString()
    const code = String(error?.code || 'VIDEO_GENERATION_POLL_INTERRUPTED').slice(0, 80)
    await Promise.all([
      request(`video_generation_scenes?id=eq.${encodeURIComponent(scene.id)}`, {
        method: 'PATCH', body: { status: 'polling', safe_error_code: code, completed_at: null, updated_at: now }, prefer: 'return=minimal',
      }),
      request(`video_generation_runs?id=eq.${encodeURIComponent(scene.runId)}`, {
        method: 'PATCH', body: { status: 'running', safe_error_code: code, completed_at: null }, prefer: 'return=minimal',
      }),
    ])
  }

  async function persistVideoGenerationSuccess(scene, result) {
    const now = new Date().toISOString()
    await request(`video_generation_scenes?id=eq.${encodeURIComponent(scene.id)}`, {
      method: 'PATCH', body: { status: 'succeeded', provider_task_status: result.providerTaskStatus,
        provider_cost_amount: result.providerCost, provider_cost_currency: result.costCurrency,
        cost_provenance: result.costProvenance, output_url: result.outputUrl,
        safe_error_code: null, completed_at: now, updated_at: now }, prefer: 'return=minimal',
    })
    await request(`video_generation_runs?id=eq.${encodeURIComponent(scene.runId)}`, {
      method: 'PATCH', body: { status: 'succeeded', safe_error_code: null, completed_at: now }, prefer: 'return=minimal',
    })
  }

  async function persistVideoGenerationFailure(scene, error) {
    const now = new Date().toISOString()
    const code = String(error?.code || 'VIDEO_GENERATION_FAILED').slice(0, 80)
    await request(`video_generation_scenes?id=eq.${encodeURIComponent(scene.id)}`, {
      method: 'PATCH', body: { status: 'failed', safe_error_code: code, completed_at: now, updated_at: now }, prefer: 'return=minimal',
    })
    await request(`video_generation_runs?id=eq.${encodeURIComponent(scene.runId)}`, {
      method: 'PATCH', body: { status: 'failed', safe_error_code: code, completed_at: now }, prefer: 'return=minimal',
    })
  }

  async function persistVideoGenerationSubmissionUncertain(scene, error) {
    const now = new Date().toISOString()
    const code = String(error?.code || 'VIDEO_GENERATION_SUBMISSION_UNCERTAIN').slice(0, 80)
    await Promise.all([
      request(`video_generation_scenes?id=eq.${encodeURIComponent(scene.id)}`, {
        method: 'PATCH', body: { status: 'submission_uncertain', submission_uncertain: true,
          safe_error_code: code, completed_at: null, updated_at: now }, prefer: 'return=minimal',
      }),
      request(`video_generation_runs?id=eq.${encodeURIComponent(scene.runId)}`, {
        method: 'PATCH', body: { status: 'submission_uncertain', safe_error_code: code, completed_at: null }, prefer: 'return=minimal',
      }),
    ])
  }

  async function registerCampaignPublication(iterationId, input) {
    const rows = await request(`campaign_iterations?id=eq.${encodeURIComponent(iterationId)}&select=appeal_hypothesis,hook_text,content_outline,script_text&limit=1`)
    if (!rows?.[0]) throw new RevenueStoreError('CAMPAIGN_ITERATION_NOT_FOUND', 'Campaign iteration was not found', 404)
    assertCreativeReusable(rows[0])
    return rpc('register_campaign_publication', {
      p_campaign_iteration_id: iterationId,
      p_youtube_video_id: input.youtubeVideoId,
      p_title: input.publicationTitle || null,
      p_published_at: input.publishedAt || null,
    })
  }

  async function claimNext(workerId, leaseSeconds) {
    const rows = await rpc('claim_next_job', { p_worker_id: workerId, p_lease_seconds: leaseSeconds })
    const row = Array.isArray(rows) ? rows[0] : rows
    return row ? {
      id: row.id,
      projectId: row.project_id,
      jobType: row.job_type,
      payload: row.payload || {},
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    } : null
  }

  function finishJob(jobId, workerId, succeeded, error = null) {
    return rpc('finish_job', {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_succeeded: succeeded,
      p_error_code: error?.code || null,
      p_error_message: error?.message || null,
    })
  }

  async function startRun(queryId, jobId, capturedAt) {
    const rows = await request('collection_runs?select=id', {
      method: 'POST',
      body: { source_query_id: queryId, job_id: jobId, captured_at: capturedAt, status: 'running' },
      prefer: 'return=representation',
    })
    return rows[0].id
  }

  async function previousVideoSnapshots(sourceId, externalIds) {
    if (!externalIds.length) return new Map()
    const encodedIds = externalIds.map(id => `"${String(id).replace(/["\\]/g, '')}"`).join(',')
    const items = await request(`source_items?source_id=eq.${encodeURIComponent(sourceId)}&item_type=eq.video&external_id=in.(${encodeURIComponent(encodedIds)})&select=id,external_id`)
    if (!items?.length) return new Map()
    const itemIds = items.map(item => item.id).join(',')
    const snapshots = await request(`source_item_snapshots?source_item_id=in.(${encodeURIComponent(itemIds)})&capture_kind=eq.discovery&select=source_item_id,captured_at,view_count&order=captured_at.desc`)
    const externalByItem = new Map(items.map(item => [item.id, item.external_id]))
    const result = new Map()
    for (const snapshot of snapshots || []) {
      const externalId = externalByItem.get(snapshot.source_item_id)
      if (externalId && !result.has(externalId)) result.set(externalId, { capturedAt: snapshot.captured_at, viewCount: Number(snapshot.view_count) })
    }
    return result
  }

  async function upsertItems(sourceId, videos) {
    const itemRows = []
    const channelSeen = new Set()
    for (const video of videos) {
      itemRows.push({
        source_id: sourceId, item_type: 'video', external_id: video.youtubeVideoId,
        title: video.title, canonical_url: `https://www.youtube.com/watch?v=${video.youtubeVideoId}`,
        metadata: { channel_id: video.channelId, channel_title: video.channelTitle, published_at: video.publishedAt, thumbnail_url: video.thumbnailUrl },
      })
      if (video.channelId && !channelSeen.has(video.channelId)) {
        channelSeen.add(video.channelId)
        itemRows.push({
          source_id: sourceId, item_type: 'channel', external_id: video.channelId,
          title: video.channelTitle, canonical_url: `https://www.youtube.com/channel/${video.channelId}`,
          metadata: {},
        })
      }
    }
    const rows = await request('source_items?on_conflict=source_id,item_type,external_id&select=id,item_type,external_id', {
      method: 'POST', body: itemRows, prefer: 'resolution=merge-duplicates,return=representation',
    })
    return new Map(rows.map(row => [`${row.item_type}:${row.external_id}`, row.id]))
  }

  async function persistCollection({ runId, jobId, query, videos, opportunities, excludedReason }) {
    const itemIds = await upsertItems(query.sourceId, videos)
    const snapshotRows = []
    const channelSeen = new Set()
    for (const video of videos) {
      snapshotRows.push({
        source_item_id: itemIds.get(`video:${video.youtubeVideoId}`),
        captured_at: video.capturedAt,
        view_count: video.viewCount ?? null,
        like_count: video.likeCount ?? null,
        comment_count: video.commentCount ?? null,
        subscriber_count: null,
        hidden_subscriber_count: false,
        capture_kind: 'discovery',
        capture_job_id: jobId,
        metrics: { search_position: video.searchPosition },
      })
      if (video.channelId && !channelSeen.has(video.channelId)) {
        channelSeen.add(video.channelId)
        snapshotRows.push({
          source_item_id: itemIds.get(`channel:${video.channelId}`),
          captured_at: video.capturedAt,
          view_count: null,
          like_count: null,
          comment_count: null,
          subscriber_count: video.subscriberCount ?? null,
          hidden_subscriber_count: video.hiddenSubscriberCount === true,
          capture_kind: 'discovery',
          capture_job_id: jobId,
          metrics: {},
        })
      }
    }
    const snapshots = snapshotRows.length ? await request('source_item_snapshots?on_conflict=source_item_id,capture_job_id&select=id,source_item_id', {
      method: 'POST', body: snapshotRows, prefer: 'resolution=merge-duplicates,return=representation',
    }) : []
    const snapshotByItem = new Map(snapshots.map(row => [row.source_item_id, row.id]))
    const runItems = videos.map(video => {
      const itemId = itemIds.get(`video:${video.youtubeVideoId}`)
      return { collection_run_id: runId, source_item_id: itemId, snapshot_id: snapshotByItem.get(itemId), search_position: video.searchPosition }
    })
    if (runItems.length) await request('collection_run_items', { method: 'POST', body: runItems, prefer: 'return=minimal' })
    if (runItems.length) await rpc('upsert_tracking_targets', {
      p_source_query_id: query.id,
      p_source_item_ids: runItems.map(item => item.source_item_id),
      p_discovered_at: videos[0]?.capturedAt,
      p_collection_run_id: runId,
    })
    if (opportunities.length) {
      await request('opportunities', { method: 'POST', body: opportunities.map((item, index) => ({
        collection_run_id: runId,
        source_query_id: query.id,
        source_item_id: itemIds.get(`video:${item.youtubeVideoId}`),
        youtube_video_id: item.youtubeVideoId,
        title: item.title,
        channel_id: item.channelId,
        channel_title: item.channelTitle,
        thumbnail_url: item.thumbnailUrl,
        published_at: item.publishedAt,
        score_version: item.scoreVersion,
        velocity_mode: item.velocityMode,
        views_velocity: item.viewsVelocity,
        channel_ratio: item.channelRatio,
        engagement_rate: item.engagementRate,
        freshness: item.freshness,
        velocity_percentile: item.velocityPercentile,
        channel_ratio_percentile: item.channelRatioPercentile,
        engagement_percentile: item.engagementPercentile,
        buyer_intent: item.buyerIntent,
        commerce_fit: item.commerceFit,
        breakout_score: item.breakoutScore,
        opportunity_score: item.opportunityScore,
        breakout_score_raw: item._breakoutRaw,
        opportunity_score_raw: item._opportunityRaw,
        percentile_population_size: item.percentilePopulationSize,
        score_parameters: item.scoreParameters,
        rank_position: index + 1,
      })), prefer: 'return=minimal' })
    }
    await request(`collection_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: 'PATCH',
      body: { status: excludedReason ? 'skipped' : 'succeeded', requested_count: query.maxResults, received_count: videos.length, scored_count: opportunities.length, excluded_reason: excludedReason, completed_at: new Date().toISOString() },
      prefer: 'return=minimal',
    })
  }

  async function failRun(runId, error) {
    await request(`collection_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: 'PATCH',
      body: { status: 'failed', error_code: String(error?.code || 'COLLECTION_FAILED').slice(0, 80), completed_at: new Date().toISOString() },
      prefer: 'return=minimal',
    })
  }

  async function deferJob(jobId, workerId, { retryAfterSeconds = 30, attempts = 1, error = null } = {}) {
    const delaySeconds = Math.max(30, Math.min(Number(retryAfterSeconds) || 30, 300))
    const runAfter = new Date(Date.now() + delaySeconds * 1000).toISOString()
    const rows = await request(`jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.running&worker_id=eq.${encodeURIComponent(workerId)}&select=id`, {
      method: 'PATCH',
      body: {
        status: 'pending', run_after: runAfter, attempts: Math.max(0, Number(attempts || 1) - 1),
        lease_expires_at: null, worker_id: null, completed_at: null,
        error_code: String(error?.code || 'JOB_DEFERRED').slice(0, 80),
        error_message: String(error?.message || 'Job deferred').slice(0, 500),
        updated_at: new Date().toISOString(),
      },
      prefer: 'return=representation',
    })
    if (!rows?.length) throw new RevenueStoreError('JOB_LEASE_LOST', 'Revenue Lab job lease is no longer owned')
    return rows[0]
  }

  async function recoverTimedOutVideoGenerations() {
    const jobs = await request('jobs?job_type=eq.video.generate.scene&status=in.(pending,failed)&error_code=in.(VIDEO_GENERATION_POLL_TIMEOUT,JOB_FAILED)&select=id,payload,attempts,status,run_after,lease_expires_at')
    console.log('[revenue-lab] Video polling recovery scan', { recoveryCandidatesCount: jobs?.length || 0 })
    let recovered = 0
    for (const job of jobs || []) {
      const sceneId = job?.payload?.video_generation_scene_id
      if (!sceneId) continue
      const scenes = await request(`video_generation_scenes?id=eq.${encodeURIComponent(sceneId)}&provider_task_id=not.is.null&safe_error_code=eq.VIDEO_GENERATION_POLL_TIMEOUT&select=id,run_id,status,provider_task_id,provider_task_status,safe_error_code&limit=1`)
      const scene = scenes?.[0]
      if (!scene) continue
      const now = new Date().toISOString()
      const nowMs = Date.now()
      console.log('[revenue-lab] Video polling recovery candidate', {
        jobStatusBefore: job.status,
        hasProviderTaskId: Boolean(scene.provider_task_id),
        sceneStatus: scene.status,
        providerTaskStatus: scene.provider_task_status || null,
        runAfterDue: !job.run_after || Date.parse(job.run_after) <= nowMs,
        leaseActive: Boolean(job.lease_expires_at && Date.parse(job.lease_expires_at) > nowMs),
      })
      await Promise.all([
        request(`video_generation_scenes?id=eq.${encodeURIComponent(scene.id)}`, {
          method: 'PATCH', body: { status: 'polling', safe_error_code: 'VIDEO_GENERATION_POLL_TIMEOUT', completed_at: null, updated_at: now }, prefer: 'return=minimal',
        }),
        request(`video_generation_runs?id=eq.${encodeURIComponent(scene.run_id)}`, {
          method: 'PATCH', body: { status: 'running', safe_error_code: 'VIDEO_GENERATION_POLL_TIMEOUT', completed_at: null }, prefer: 'return=minimal',
        }),
        request(`jobs?id=eq.${encodeURIComponent(job.id)}&status=in.(pending,failed)`, {
          method: 'PATCH', body: {
            status: 'pending', run_after: now, attempts: 0,
            lease_expires_at: null, worker_id: null, completed_at: null, updated_at: now,
          }, prefer: 'return=minimal',
        }),
      ])
      recovered += 1
    }
    console.log('[revenue-lab] Video polling recovery complete', { recoveredJobCount: recovered, jobStatusAfter: recovered ? 'pending' : null })
    return recovered
  }

  async function listTrackingCandidates(sourceId, requestedDay, capturedAt) {
    const rows = await rpc('tracking_candidates', {
      p_source_id: sourceId, p_requested_day: requestedDay, p_captured_at: capturedAt,
    })
    return (rows || []).map(row => ({
      targetId: row.target_id,
      sourceQueryId: row.source_query_id,
      sourceItemId: row.source_item_id,
      youtubeVideoId: row.youtube_video_id,
      title: row.title,
      channelId: row.channel_id,
      channelTitle: row.channel_title,
      publishedAt: row.published_at,
      thumbnailUrl: row.thumbnail_url,
      buyerIntent: row.buyer_intent,
      commerceFit: row.commerce_fit,
      previousSnapshot: row.previous_snapshot_id ? {
        id: row.previous_snapshot_id,
        capturedAt: row.previous_captured_at,
        viewCount: row.previous_view_count == null ? null : Number(row.previous_view_count),
      } : null,
    }))
  }

  async function startTrackingRun(queryId, jobId, requestedDay, capturedAt, targetCount) {
    const rows = await request('tracking_runs?on_conflict=job_id,source_query_id&select=id', {
      method: 'POST',
      body: { source_query_id: queryId, job_id: jobId, requested_day: requestedDay, captured_at: capturedAt, target_count: targetCount, status: 'running' },
      prefer: 'resolution=merge-duplicates,return=representation',
    })
    return rows[0].id
  }

  async function persistTrackingSnapshots({ sourceId, jobId, videos }) {
    if (!videos.length) return new Map()
    const itemIds = await upsertItems(sourceId, videos)
    const rows = []
    const channels = new Set()
    for (const video of videos) {
      rows.push({
        source_item_id: itemIds.get(`video:${video.youtubeVideoId}`), captured_at: video.capturedAt,
        view_count: video.viewCount ?? null, like_count: video.likeCount ?? null, comment_count: video.commentCount ?? null,
        subscriber_count: null, hidden_subscriber_count: false, capture_kind: 'tracking', capture_job_id: jobId, metrics: {},
      })
      if (video.channelId && !channels.has(video.channelId)) {
        channels.add(video.channelId)
        rows.push({
          source_item_id: itemIds.get(`channel:${video.channelId}`), captured_at: video.capturedAt,
          view_count: null, like_count: null, comment_count: null, subscriber_count: video.subscriberCount ?? null,
          hidden_subscriber_count: video.hiddenSubscriberCount === true, capture_kind: 'tracking', capture_job_id: jobId, metrics: {},
        })
      }
    }
    const snapshots = await request('source_item_snapshots?on_conflict=source_item_id,capture_job_id&select=id,source_item_id', {
      method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation',
    })
    return new Map(snapshots.map(row => [row.source_item_id, row.id]))
  }

  async function persistTrackingRun({ runId, queryId, records, opportunities }) {
    if (records.length) await request('tracking_run_items?on_conflict=tracking_run_id,source_item_id', {
      method: 'POST', body: records.map(record => ({
        tracking_run_id: runId, tracking_target_id: record.targetId, source_item_id: record.sourceItemId,
        previous_snapshot_id: record.previousSnapshotId, current_snapshot_id: record.currentSnapshotId,
        status: record.status, previous_view_count: record.previousViewCount, current_view_count: record.currentViewCount,
        view_delta: record.viewDelta, elapsed_hours: record.elapsedHours, views_velocity: record.viewsVelocity,
        growth_ratio: record.growthRatio, growth_percent: record.growthPercent,
      })), prefer: 'resolution=merge-duplicates,return=minimal',
    })
    if (opportunities.length) await request('tracking_opportunities?on_conflict=tracking_run_id,source_item_id,score_version', {
      method: 'POST', body: opportunities.map((item, index) => ({
        tracking_run_id: runId, source_query_id: queryId, source_item_id: item.sourceItemId,
        youtube_video_id: item.youtubeVideoId, title: item.title, channel_id: item.channelId,
        channel_title: item.channelTitle, thumbnail_url: item.thumbnailUrl, published_at: item.publishedAt,
        score_version: item.scoreVersion, velocity_mode: item.velocityMode, views_velocity: item.viewsVelocity,
        channel_ratio: item.channelRatio, engagement_rate: item.engagementRate, freshness: item.freshness,
        velocity_percentile: item.velocityPercentile, channel_ratio_percentile: item.channelRatioPercentile,
        engagement_percentile: item.engagementPercentile, buyer_intent: item.buyerIntent, commerce_fit: item.commerceFit,
        breakout_score: item.breakoutScore, opportunity_score: item.opportunityScore,
        breakout_score_raw: item._breakoutRaw, opportunity_score_raw: item._opportunityRaw,
        percentile_population_size: item.percentilePopulationSize, score_parameters: item.scoreParameters, rank_position: index + 1,
      })), prefer: 'resolution=merge-duplicates,return=minimal',
    })
    const counts = {
      received_count: records.filter(record => record.status !== 'missing').length,
      scored_count: opportunities.length,
      waiting_count: records.filter(record => record.status === 'waiting_interval').length,
      missing_count: records.filter(record => record.status === 'missing').length,
    }
    await request(`tracking_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: 'PATCH', body: { ...counts, status: 'succeeded', completed_at: new Date().toISOString() }, prefer: 'return=minimal',
    })
  }

  async function failTrackingRuns(runIds, error) {
    if (!runIds.length) return
    await request(`tracking_runs?id=in.(${encodeURIComponent(runIds.join(','))})`, {
      method: 'PATCH',
      body: { status: 'failed', error_code: String(error?.code || 'TRACKING_FAILED').slice(0, 80), completed_at: new Date().toISOString() },
      prefer: 'return=minimal',
    })
  }

  const markTrackingMissing = targetIds => targetIds.length
    ? rpc('mark_tracking_targets_missing', { p_target_ids: targetIds }) : Promise.resolve(0)
  const markTrackingSeen = (targetIds, seenAt) => targetIds.length
    ? rpc('mark_tracking_targets_seen', { p_target_ids: targetIds, p_seen_at: seenAt }) : Promise.resolve(0)

  return {
    claimNext, dashboard, deferJob, enqueueQuery, enqueueTracking, enqueueAnalysisCandidates, failRun, finishJob, getQuery,
    getAnalysisRequest, markAnalysisRunning, persistAnalysisSuccess, persistAnalysisFailure, createAnalysisReview,
    enqueueProductSearch, getProductSearchRun, markProductSearchRunning, persistProductSearchSuccess,
    persistProductSearchFailure, createProductDecision, createManualCampaign, createDirectProductCampaign,
    createThreePicksCampaign, createThreePicksV2Campaign, enqueueThreePicksPlan, enqueueThreePicksV2Plan, getThreePicksRequest, markThreePicksRunning,
    persistThreePicksSuccess, persistThreePicksV2Success, persistThreePicksFailure, enqueueFinalComposition, enqueueFinalCompositionV2,
    getFinalCompositionRequest, markFinalCompositionRendering, persistFinalCompositionSuccess,
    persistFinalCompositionFailure, getFinalCompositionOutput, registerCampaignPublication,
    enqueueCreativeProduction, getCreativeProductionRequest, markCreativeProductionRunning, persistCreativeProductionSuccess,
    persistCreativeProductionFailure, enqueueVideoGeneration, enqueueImageVideoGeneration, getVideoGenerationScene, markVideoGenerationSubmitting, markVideoGenerationPollingResume,
    persistVideoGenerationTask, persistVideoGenerationPolling, persistVideoGenerationPollingInterrupted,
    persistVideoGenerationSuccess, persistVideoGenerationFailure, persistVideoGenerationSubmissionUncertain,
    getProductAsset, registerProductAssetRevision,
    listQueries, listTrackingCandidates, recoverTimedOutVideoGenerations, markTrackingMissing, markTrackingSeen, failTrackingRuns,
    persistCollection, persistTrackingRun, persistTrackingSnapshots, previousVideoSnapshots,
    startRun, startTrackingRun, updateQuery,
  }
}

module.exports = { PROFILE, RevenueStoreError, analysisContext, creativeProductFacts, createSupabaseStore, mergeAnalysisCandidates, opportunityFromRow, productSearchTerms, queryFromRow }
