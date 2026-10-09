'use strict'

const { scoreYouTubePopulation, scoreYouTubeTrackingPopulation } = require('./scoring.cjs')
const { rankProductCandidates } = require('./product-ranking.cjs')

class RevenueJobError extends Error {
  constructor(code, message) { super(message); this.name = 'RevenueJobError'; this.code = code }
}

function createJobHandlers({ store, youtube, analyst, productProvider, clock = () => new Date(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!store || !youtube) throw new TypeError('store and youtube are required')

  async function collectYouTube(job) {
    const queryId = job?.payload?.source_query_id
    if (!queryId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'source_query_id is required')
    const query = await store.getQuery(queryId)
    if (!query) throw new RevenueJobError('QUERY_NOT_FOUND', 'Source query was not found')
    if (!query.enabled) throw new RevenueJobError('QUERY_DISABLED', 'Source query is disabled')
    const capturedAt = clock().toISOString()
    const runId = await store.startRun(query.id, job.id, capturedAt)
    try {
      const videos = await youtube.collect({
        queryText: query.queryText,
        maxResults: Math.min(query.maxResults, 25),
        lookbackDays: 7,
        regionCode: 'JP',
        relevanceLanguage: 'ja',
        capturedAt,
      })
      const previous = await store.previousVideoSnapshots(query.sourceId, videos.map(video => video.youtubeVideoId))
      const population = videos.map(video => ({ ...video, previousSnapshot: previous.get(video.youtubeVideoId) || null }))
      const scored = scoreYouTubePopulation(population, { buyerIntent: query.buyerIntent, commerceFit: query.commerceFit })
      await store.persistCollection({
        runId,
        jobId: job.id,
        query,
        videos,
        opportunities: scored.opportunities,
        excludedReason: scored.excludedReason,
      })
      return { runId, received: videos.length, scored: scored.opportunities.length, excludedReason: scored.excludedReason }
    } catch (error) {
      console.error('[revenue-lab] YouTube collection failed', { jobId: job.id, queryId, code: error?.code || 'COLLECTION_FAILED' })
      try { await store.failRun(runId, error) }
      catch { console.error('[revenue-lab] Collection run failure state could not be persisted', { runId }) }
      throw error instanceof RevenueJobError ? error : new RevenueJobError(error?.code || 'COLLECTION_FAILED', 'YouTube collection failed')
    }
  }

  async function trackYouTube(job) {
    const sourceId = job?.payload?.source_id
    const requestedDay = job?.payload?.requested_day
    if (!sourceId || !requestedDay) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'source_id and requested_day are required')
    const capturedAt = clock().toISOString()
    const targets = await store.listTrackingCandidates(sourceId, requestedDay, capturedAt)
    if (!targets.length) return { received: 0, scored: 0, waiting: 0, missing: 0, runs: 0 }
    const startedRunIds = []
    try {
      const ids = [...new Set(targets.map(target => target.youtubeVideoId))]
      const result = await youtube.track(ids, capturedAt)
      const videoById = new Map(result.videos.map(video => [video.youtubeVideoId, video]))
      const missingIds = new Set(result.missingVideoIds)
      const missingTargets = targets.filter(target => missingIds.has(target.youtubeVideoId))
      const seenTargets = targets.filter(target => videoById.has(target.youtubeVideoId))
      await store.markTrackingMissing(missingTargets.map(target => target.targetId))
      await store.markTrackingSeen(seenTargets.map(target => target.targetId), capturedAt)

      const eligibleTargets = seenTargets.filter(target => {
        const video = videoById.get(target.youtubeVideoId)
        if (!target.previousSnapshot?.capturedAt || target.previousSnapshot.viewCount == null) return false
        if (video?.viewCount == null || !Number.isFinite(Date.parse(video.publishedAt))) return false
        return (Date.parse(capturedAt) - Date.parse(target.previousSnapshot.capturedAt)) / 3_600_000 >= 6
      })
      const eligibleIds = new Set(eligibleTargets.map(target => target.youtubeVideoId))
      const snapshots = await store.persistTrackingSnapshots({
        sourceId, jobId: job.id, videos: result.videos.filter(video => eligibleIds.has(video.youtubeVideoId)),
      })
      const groups = new Map()
      for (const target of targets) {
        const group = groups.get(target.sourceQueryId) || []
        group.push(target)
        groups.set(target.sourceQueryId, group)
      }
      let scoredCount = 0
      let waitingCount = 0
      for (const [queryId, queryTargets] of groups) {
        const runId = await store.startTrackingRun(queryId, job.id, requestedDay, capturedAt, queryTargets.length)
        startedRunIds.push(runId)
        const scoreInputs = []
        const records = []
        for (const target of queryTargets) {
          const video = videoById.get(target.youtubeVideoId)
          const previous = target.previousSnapshot
          if (!video) {
            records.push({
              targetId: target.targetId, sourceItemId: target.sourceItemId, previousSnapshotId: previous?.id || null,
              currentSnapshotId: null, status: 'missing', previousViewCount: previous?.viewCount ?? null,
              currentViewCount: null, viewDelta: null, elapsedHours: null, viewsVelocity: null,
              growthRatio: null, growthPercent: null,
            })
            continue
          }
          if (video.viewCount == null || !Number.isFinite(Date.parse(video.publishedAt)) || previous?.viewCount == null) {
            records.push({
              targetId: target.targetId, sourceItemId: target.sourceItemId, previousSnapshotId: previous?.id || null,
              currentSnapshotId: null, status: 'unscored', previousViewCount: previous?.viewCount ?? null,
              currentViewCount: video.viewCount, viewDelta: null, elapsedHours: null, viewsVelocity: null,
              growthRatio: null, growthPercent: null,
            })
            continue
          }
          const elapsedHours = previous?.capturedAt
            ? (Date.parse(capturedAt) - Date.parse(previous.capturedAt)) / 3_600_000 : null
          if (!previous || !Number.isFinite(elapsedHours) || elapsedHours < 6) {
            waitingCount += 1
            records.push({
              targetId: target.targetId, sourceItemId: target.sourceItemId, previousSnapshotId: previous?.id || null,
              currentSnapshotId: null, status: 'waiting_interval', previousViewCount: previous?.viewCount ?? null,
              currentViewCount: video.viewCount, viewDelta: null, elapsedHours: elapsedHours == null ? null : Math.max(elapsedHours, 0),
              viewsVelocity: null, growthRatio: null, growthPercent: null,
            })
            continue
          }
          const viewDelta = Math.max((video.viewCount ?? 0) - previous.viewCount, 0)
          const growthRatio = previous.viewCount > 0 ? video.viewCount / previous.viewCount : null
          const growthPercent = previous.viewCount > 0 ? viewDelta / previous.viewCount * 100 : null
          scoreInputs.push({ ...video, previousSnapshot: previous, sourceItemId: target.sourceItemId })
          records.push({
            targetId: target.targetId, sourceItemId: target.sourceItemId, previousSnapshotId: previous.id,
            currentSnapshotId: snapshots.get(target.sourceItemId), status: 'scored', previousViewCount: previous.viewCount,
            currentViewCount: video.viewCount, viewDelta, elapsedHours, viewsVelocity: viewDelta / elapsedHours,
            growthRatio, growthPercent,
          })
        }
        const first = queryTargets[0]
        const scored = scoreYouTubeTrackingPopulation(scoreInputs, {
          buyerIntent: first.buyerIntent, commerceFit: first.commerceFit,
        })
        const sourceItemByVideo = new Map(scoreInputs.map(video => [video.youtubeVideoId, video.sourceItemId]))
        const opportunities = scored.opportunities.map(item => ({ ...item, sourceItemId: sourceItemByVideo.get(item.youtubeVideoId) }))
        scoredCount += opportunities.length
        await store.persistTrackingRun({ runId, queryId, records, opportunities })
      }
      return {
        received: result.videos.length, scored: scoredCount, waiting: waitingCount,
        missing: missingTargets.length, runs: groups.size,
      }
    } catch (error) {
      console.error('[revenue-lab] YouTube tracking failed', { jobId: job.id, sourceId, code: error?.code || 'TRACKING_FAILED' })
      try { await store.failTrackingRuns(startedRunIds, error) }
      catch { console.error('[revenue-lab] Tracking run failure state could not be persisted', { jobId: job.id }) }
      throw error instanceof RevenueJobError ? error : new RevenueJobError(error?.code || 'TRACKING_FAILED', 'YouTube tracking failed')
    }
  }

  async function analyzeOpportunity(job) {
    const requestId = job?.payload?.analysis_request_id
    if (!requestId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'analysis_request_id is required')
    if (!analyst) throw new RevenueJobError('OPENAI_NOT_CONFIGURED', 'OpenAI analysis is not configured')
    const request = await store.getAnalysisRequest(requestId)
    if (!request) throw new RevenueJobError('ANALYSIS_REQUEST_NOT_FOUND', 'Analysis request was not found')
    await store.markAnalysisRunning(requestId)
    try {
      const result = await analyst.analyze(request.inputSnapshot)
      await store.persistAnalysisSuccess(requestId, result)
      return { analysisRequestId: requestId, recommendation: result.analysis.recommendation }
    } catch (error) {
      try { await store.persistAnalysisFailure(requestId, error) }
      catch { console.error('[revenue-lab] Analysis failure state could not be persisted', { requestId }) }
      throw error instanceof RevenueJobError ? error : new RevenueJobError(error?.code || 'ANALYSIS_FAILED', 'Opportunity analysis failed')
    }
  }

  async function searchProducts(job) {
    const runId = job?.payload?.product_search_run_id
    if (!runId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'product_search_run_id is required')
    if (!productProvider) throw new RevenueJobError('RAKUTEN_NOT_CONFIGURED', 'Product catalog provider is not configured')
    const run = await store.getProductSearchRun(runId)
    if (!run) throw new RevenueJobError('PRODUCT_SEARCH_RUN_NOT_FOUND', 'Product search run was not found')
    if (run.provider !== productProvider.id || run.providerApiVersion !== productProvider.apiVersion) {
      throw new RevenueJobError('PRODUCT_PROVIDER_MISMATCH', 'Product provider does not match the saved run')
    }
    await store.markProductSearchRunning(runId)
    try {
      const providerSearch = async options => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try { return await productProvider.search(options) }
          catch (error) {
            if (!['RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(error?.code) || attempt === 2) throw error
            await sleep(1_000 * (2 ** attempt))
          }
        }
        throw new RevenueJobError('PRODUCT_SEARCH_FAILED', 'Product candidate search failed')
      }
      const searches = []
      for (const [index, keyword] of run.inputSnapshot.keywords.entries()) {
        if (index > 0) await sleep(1_000)
        const result = await providerSearch({ keyword, limit: run.inputSnapshot.hits_per_keyword })
        searches.push({ keyword, requestedHits: run.inputSnapshot.hits_per_keyword, result })
      }
      const recordsByProduct = new Map()
      searches.forEach(search => search.result.items.forEach((product, index) => {
        const record = recordsByProduct.get(product.providerProductId) || { product, matches: [] }
        record.matches.push({ keyword: search.keyword, position: index + 1, resultCount: search.result.items.length })
        recordsByProduct.set(product.providerProductId, record)
      }))
      const ranked = rankProductCandidates([...recordsByProduct.values()], run.inputSnapshot.keywords)
      await store.persistProductSearchSuccess(runId, searches, ranked)
      return { productSearchRunId: runId, received: searches.reduce((sum, search) => sum + search.result.items.length, 0), candidates: ranked.length }
    } catch (error) {
      try { await store.persistProductSearchFailure(runId, error) }
      catch { console.error('[revenue-lab] Product search failure state could not be persisted', { runId }) }
      throw error instanceof RevenueJobError ? error : new RevenueJobError(error?.code || 'PRODUCT_SEARCH_FAILED', 'Product candidate search failed')
    }
  }

  return new Map([
    ['youtube.collect', collectYouTube],
    ['youtube.track', trackYouTube],
    ['opportunity.analyze', analyzeOpportunity],
    ['product.search', searchProducts],
  ])
}

module.exports = { RevenueJobError, createJobHandlers }
