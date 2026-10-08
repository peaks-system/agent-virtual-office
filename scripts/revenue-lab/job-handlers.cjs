'use strict'

const { scoreYouTubePopulation } = require('./scoring.cjs')

class RevenueJobError extends Error {
  constructor(code, message) { super(message); this.name = 'RevenueJobError'; this.code = code }
}

function createJobHandlers({ store, youtube, clock = () => new Date() } = {}) {
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

  return new Map([['youtube.collect', collectYouTube]])
}

module.exports = { RevenueJobError, createJobHandlers }
