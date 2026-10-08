'use strict'

const SCORE_VERSION = 'youtube-v1'

const SCORE_PARAMETERS = Object.freeze({
  breakout: Object.freeze({
    subscriber_visible: Object.freeze({ velocity: 0.45, channel_ratio: 0.30, engagement: 0.15, freshness: 0.10 }),
    subscriber_hidden: Object.freeze({ velocity: 0.60, engagement: 0.25, freshness: 0.15 }),
  }),
  opportunity: Object.freeze({ breakout: 0.70, buyer_intent: 0.15, commerce_fit: 0.15 }),
  percentile: Object.freeze({
    population: 'same source_query and collection_run successful videos',
    method: 'ascending_average_rank',
    formula: '100 * (average_rank - 1) / (N - 1)',
    singleton: 50,
  }),
  missing_values: Object.freeze({
    likes: 0,
    comments: 0,
    subscriber_count: 'omit channel ratio and use subscriber_hidden weights',
    buyer_intent_or_commerce_fit: 'exclude query from scoring',
  }),
  rounding: Object.freeze({
    operation: 'Math.round(value * 10^digits) / 10^digits',
    base_metrics_digits: 6,
    percentile_digits: 4,
    freshness_digits: 4,
    score_digits: 2,
    ranking: 'unrounded internal values',
  }),
})

function finite(value) {
  const number = typeof value === 'number' ? value : Number(value)
  if (value == null || value === '') return null
  return Number.isFinite(number) ? number : null
}

function roundForStorage(value, digits) {
  if (value == null) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function percentileRanks(values) {
  if (!Array.isArray(values) || values.length === 0) return []
  if (values.length === 1) return [50]
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const output = new Array(values.length)
  let start = 0
  while (start < indexed.length) {
    let end = start
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[start].value) end += 1
    const averageRank = ((start + 1) + (end + 1)) / 2
    const percentile = 100 * (averageRank - 1) / (values.length - 1)
    for (let cursor = start; cursor <= end; cursor += 1) output[indexed[cursor].index] = percentile
    start = end + 1
  }
  return output
}

function parseTime(value, field) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) throw new TypeError(`${field} must be an ISO date`)
  return time
}

function deriveMetrics(input) {
  const viewCount = finite(input.viewCount)
  if (viewCount == null || viewCount < 0) throw new TypeError('viewCount must be a non-negative number')
  const capturedAt = parseTime(input.capturedAt, 'capturedAt')
  const publishedAt = parseTime(input.publishedAt, 'publishedAt')
  const ageHours = Math.max((capturedAt - publishedAt) / 3_600_000, 1)
  const previousViewCount = finite(input.previousSnapshot?.viewCount)
  const hasPrevious = previousViewCount != null && input.previousSnapshot?.capturedAt
  let viewsVelocity
  let velocityMode
  if (hasPrevious) {
    const previousCapturedAt = parseTime(input.previousSnapshot.capturedAt, 'previousSnapshot.capturedAt')
    const elapsedHours = Math.max((capturedAt - previousCapturedAt) / 3_600_000, 1)
    viewsVelocity = viewCount >= previousViewCount ? (viewCount - previousViewCount) / elapsedHours : 0
    velocityMode = 'observed_delta'
  } else {
    viewsVelocity = viewCount / ageHours
    velocityMode = 'estimated_lifetime'
  }
  const subscriberCount = finite(input.subscriberCount)
  const channelRatio = subscriberCount == null ? null : viewCount / Math.max(subscriberCount, 100)
  const likeCount = finite(input.likeCount) ?? 0
  const commentCount = finite(input.commentCount) ?? 0
  const engagementRate = (likeCount + 2 * commentCount) / Math.max(viewCount, 1)
  const freshness = Math.max(0, 100 * (1 - ageHours / 168))
  return { ageHours, viewsVelocity, velocityMode, channelRatio, engagementRate, freshness }
}

function validHumanScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100
}

function compareOpportunities(a, b) {
  if (a._opportunityRaw !== b._opportunityRaw) return b._opportunityRaw - a._opportunityRaw
  if (a._breakoutRaw !== b._breakoutRaw) return b._breakoutRaw - a._breakoutRaw
  const publishedDifference = Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  if (publishedDifference) return publishedDifference
  return String(a.youtubeVideoId).localeCompare(String(b.youtubeVideoId), 'en')
}

function scoreYouTubePopulation(videos, { buyerIntent, commerceFit } = {}) {
  if (!validHumanScore(buyerIntent) || !validHumanScore(commerceFit)) {
    return { scoreVersion: SCORE_VERSION, excludedReason: 'query_scoring_not_configured', opportunities: [] }
  }
  const eligible = videos.filter(video => (
    finite(video.viewCount) != null
    && video.publishedAt != null
    && Number.isFinite(Date.parse(video.publishedAt))
  ))
  const prepared = eligible.map(video => ({ video, metrics: deriveMetrics(video) }))
  const velocityPercentiles = percentileRanks(prepared.map(row => row.metrics.viewsVelocity))
  const engagementPercentiles = percentileRanks(prepared.map(row => row.metrics.engagementRate))
  const ratioRows = prepared.map((row, index) => ({ index, value: row.metrics.channelRatio })).filter(row => row.value != null)
  const ratioPercentiles = percentileRanks(ratioRows.map(row => row.value))
  const ratioByIndex = new Map(ratioRows.map((row, cursor) => [row.index, ratioPercentiles[cursor]]))

  const opportunities = prepared.map(({ video, metrics }, index) => {
    const velocityPercentileRaw = velocityPercentiles[index]
    const engagementPercentileRaw = engagementPercentiles[index]
    const channelRatioPercentileRaw = ratioByIndex.get(index) ?? null
    const breakoutRaw = channelRatioPercentileRaw == null
      ? velocityPercentileRaw * 0.60 + engagementPercentileRaw * 0.25 + metrics.freshness * 0.15
      : velocityPercentileRaw * 0.45 + channelRatioPercentileRaw * 0.30 + engagementPercentileRaw * 0.15 + metrics.freshness * 0.10
    const opportunityRaw = breakoutRaw * 0.70 + buyerIntent * 0.15 + commerceFit * 0.15
    return {
      youtubeVideoId: video.youtubeVideoId,
      title: video.title ?? '',
      channelId: video.channelId ?? null,
      channelTitle: video.channelTitle ?? '',
      publishedAt: video.publishedAt,
      capturedAt: video.capturedAt,
      thumbnailUrl: video.thumbnailUrl ?? null,
      viewCount: finite(video.viewCount),
      likeCount: finite(video.likeCount),
      commentCount: finite(video.commentCount),
      subscriberCount: finite(video.subscriberCount),
      scoreVersion: SCORE_VERSION,
      velocityMode: metrics.velocityMode,
      ageHours: roundForStorage(metrics.ageHours, 6),
      viewsVelocity: roundForStorage(metrics.viewsVelocity, 6),
      channelRatio: roundForStorage(metrics.channelRatio, 6),
      engagementRate: roundForStorage(metrics.engagementRate, 6),
      freshness: roundForStorage(metrics.freshness, 4),
      velocityPercentile: roundForStorage(velocityPercentileRaw, 4),
      channelRatioPercentile: roundForStorage(channelRatioPercentileRaw, 4),
      engagementPercentile: roundForStorage(engagementPercentileRaw, 4),
      buyerIntent,
      commerceFit,
      breakoutScore: roundForStorage(breakoutRaw, 2),
      opportunityScore: roundForStorage(opportunityRaw, 2),
      percentilePopulationSize: prepared.length,
      scoreParameters: SCORE_PARAMETERS,
      _breakoutRaw: breakoutRaw,
      _opportunityRaw: opportunityRaw,
    }
  })
  opportunities.sort(compareOpportunities)
  return { scoreVersion: SCORE_VERSION, excludedReason: null, opportunities }
}

function toStoredOpportunity(opportunity) {
  const { _breakoutRaw, _opportunityRaw, ...stored } = opportunity
  return stored
}

module.exports = {
  SCORE_PARAMETERS,
  SCORE_VERSION,
  compareOpportunities,
  deriveMetrics,
  percentileRanks,
  roundForStorage,
  scoreYouTubePopulation,
  toStoredOpportunity,
  validHumanScore,
}
