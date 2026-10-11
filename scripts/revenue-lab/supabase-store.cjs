'use strict'

const { inputFingerprint } = require('./canonical-json.cjs')
const { DEFAULT_MODEL, PROMPT_VERSION, SCHEMA_VERSION } = require('./analysis-schema.cjs')
const { SCORE_PARAMETERS: PRODUCT_SCORE_PARAMETERS, SCORE_VERSION: PRODUCT_SCORE_VERSION } = require('./product-ranking.cjs')
const { API_VERSION: RAKUTEN_API_VERSION, PROVIDER_ID: RAKUTEN_PROVIDER_ID } = require('./providers/rakuten-product-provider.cjs')

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
    const campaigns = await request(
      `campaigns?project_id=in.(${encodeURIComponent(projectIds.join(','))})&select=*&order=created_at.desc&limit=50`,
    )
    if (!campaigns.length) return []
    const campaignIds = campaigns.map(row => row.id)
    const [origins, iterations] = await Promise.all([
      request(`campaign_origins?campaign_id=in.(${encodeURIComponent(campaignIds.join(','))})&select=*&order=created_at.asc`),
      request(`campaign_iterations?campaign_id=in.(${encodeURIComponent(campaignIds.join(','))})&select=*&order=iteration_number.asc`),
    ])
    const productIds = [...new Set(iterations.map(row => row.curated_product_id).filter(Boolean))]
    const iterationIds = iterations.map(row => row.id)
    const [products, publications] = await Promise.all([
      productIds.length ? request(`curated_products?id=in.(${encodeURIComponent(productIds.join(','))})&select=*`) : [],
      iterationIds.length ? request(`campaign_publications?campaign_iteration_id=in.(${encodeURIComponent(iterationIds.join(','))})&select=*&order=created_at.asc`) : [],
    ])
    const productById = new Map(products.map(row => [row.id, row]))
    const publicationsByIteration = new Map()
    for (const row of publications) {
      const records = publicationsByIteration.get(row.campaign_iteration_id) || []
      records.push({
        id: row.id, platform: row.platform, youtubeVideoId: row.youtube_video_id,
        youtubeChannelId: row.youtube_channel_id, canonicalUrl: row.canonical_url,
        title: row.title, publishedAt: row.published_at, status: row.status,
        initialMetadata: row.initial_metadata, createdAt: row.created_at,
      })
      publicationsByIteration.set(row.campaign_iteration_id, records)
    }
    const originsByCampaign = new Map()
    for (const row of origins) {
      const records = originsByCampaign.get(row.campaign_id) || []
      records.push({
        id: row.id, contextKind: row.context_kind, opportunityId: row.opportunity_id,
        trackingOpportunityId: row.tracking_opportunity_id, sourceQueryId: row.source_query_id,
        rankPosition: row.rank_position, scoreVersion: row.score_version, originSnapshot: row.origin_snapshot,
      })
      originsByCampaign.set(row.campaign_id, records)
    }
    const iterationsByCampaign = new Map()
    for (const row of iterations) {
      const product = productById.get(row.curated_product_id)
      const records = iterationsByCampaign.get(row.campaign_id) || []
      records.push({
        id: row.id, iterationNumber: row.iteration_number, status: row.status,
        sourceAnalysisId: row.source_analysis_id,
        appealHypothesis: row.appeal_hypothesis, hookText: row.hook_text,
        contentOutline: row.content_outline, scriptText: row.script_text,
        treatmentFingerprint: row.treatment_fingerprint, lockedAt: row.locked_at,
        product: product ? {
          id: product.id, sourceKind: product.source_kind, discoveryChannel: product.discovery_channel,
          searchKeyword: product.search_keyword, merchant: product.merchant, productName: product.product_name,
          productUrl: product.product_url, affiliateUrl: product.affiliate_url,
          priceAmount: product.price_amount == null ? null : Number(product.price_amount),
          currency: product.currency, notes: product.notes, humanVerifiedAt: product.human_verified_at,
        } : null,
        publications: publicationsByIteration.get(row.id) || [],
        publication: (publicationsByIteration.get(row.id) || [])[0] || null,
      })
      iterationsByCampaign.set(row.campaign_id, records)
    }
    return campaigns.map(row => ({
      id: row.id, projectId: row.project_id, sourceItemId: row.source_item_id,
      analysisId: row.primary_analysis_id, name: row.name, objective: row.objective,
      status: row.status, analysisSnapshot: row.analysis_snapshot, createdAt: row.created_at,
      origins: originsByCampaign.get(row.id) || [],
      iterations: iterationsByCampaign.get(row.id) || [],
    }))
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

  async function getVideoGenerationScene(id) {
    const rows = await request(`video_generation_scenes?id=eq.${encodeURIComponent(id)}&select=*&limit=1`)
    const row = rows?.[0]
    return row ? {
      id: row.id, runId: row.run_id, planId: row.creative_production_plan_id,
      sceneNumber: row.creative_scene_number, attemptNumber: row.attempt_number,
      provider: row.provider, providerVersion: row.provider_version, requestedModel: row.requested_model,
      providerTaskId: row.provider_task_id, providerTaskStatus: row.provider_task_status,
      promptSnapshot: row.prompt_snapshot,
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

  async function registerCampaignPublication(iterationId, input) {
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
    persistProductSearchFailure, createProductDecision, createManualCampaign, registerCampaignPublication,
    getVideoGenerationScene, markVideoGenerationSubmitting, markVideoGenerationPollingResume,
    persistVideoGenerationTask, persistVideoGenerationPolling, persistVideoGenerationPollingInterrupted,
    persistVideoGenerationSuccess, persistVideoGenerationFailure,
    listQueries, listTrackingCandidates, recoverTimedOutVideoGenerations, markTrackingMissing, markTrackingSeen, failTrackingRuns,
    persistCollection, persistTrackingRun, persistTrackingSnapshots, previousVideoSnapshots,
    startRun, startTrackingRun, updateQuery,
  }
}

module.exports = { PROFILE, RevenueStoreError, analysisContext, createSupabaseStore, mergeAnalysisCandidates, opportunityFromRow, productSearchTerms, queryFromRow }
