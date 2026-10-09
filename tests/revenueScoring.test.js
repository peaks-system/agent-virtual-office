import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  SCORE_VERSION,
  SCORE_PARAMETERS,
  compareOpportunities,
  deriveMetrics,
  percentileRanks,
  roundForStorage,
  scoreYouTubePopulation,
  scoreYouTubeTrackingPopulation,
} = require('../scripts/revenue-lab/scoring.cjs')

const capturedAt = '2026-10-07T12:00:00.000Z'
const hoursBefore = hours => new Date(Date.parse(capturedAt) - hours * 3600_000).toISOString()
const video = (overrides = {}) => ({
  youtubeVideoId: 'video-a',
  title: 'Test video',
  channelId: 'channel-a',
  channelTitle: 'Test channel',
  publishedAt: hoursBefore(10),
  capturedAt,
  viewCount: 1000,
  likeCount: 100,
  commentCount: 10,
  subscriberCount: 100,
  previousSnapshot: null,
  ...overrides,
})

describe('Revenue Lab youtube-v1 scoring', () => {
  it('uses the fixed version, parameters, and JavaScript Math.round storage policy', () => {
    expect(SCORE_VERSION).toBe('youtube-v1')
    expect(SCORE_PARAMETERS.percentile.method).toBe('ascending_average_rank')
    expect(SCORE_PARAMETERS.rounding.operation).toBe('Math.round(value * 10^digits) / 10^digits')
    expect(roundForStorage(1.23456789, 6)).toBe(1.234568)
    expect(roundForStorage(1.005, 2)).toBe(Math.round(1.005 * 100) / 100)
  })

  it('computes average-rank percentiles for ties and returns 50 for N=1', () => {
    expect(percentileRanks([10, 20, 20, 40])).toEqual([0, 50, 50, 100])
    expect(percentileRanks([99])).toEqual([50])
  })

  it('uses estimated lifetime velocity for the first snapshot and enforces the one-hour age floor', () => {
    const metrics = deriveMetrics(video({ publishedAt: hoursBefore(0.25), viewCount: 120 }))
    expect(metrics.ageHours).toBe(1)
    expect(metrics.viewsVelocity).toBe(120)
    expect(metrics.velocityMode).toBe('estimated_lifetime')
    expect(metrics.freshness).toBeCloseTo(99.4047619)
  })

  it('uses observed delta for a later snapshot with a one-hour elapsed floor', () => {
    const metrics = deriveMetrics(video({
      viewCount: 150,
      previousSnapshot: { viewCount: 100, capturedAt: new Date(Date.parse(capturedAt) - 30 * 60_000).toISOString() },
    }))
    expect(metrics.viewsVelocity).toBe(50)
    expect(metrics.velocityMode).toBe('observed_delta')
  })

  it('never emits negative velocity when YouTube decreases a view count', () => {
    const metrics = deriveMetrics(video({
      viewCount: 90,
      previousSnapshot: { viewCount: 100, capturedAt: hoursBefore(2) },
    }))
    expect(metrics.viewsVelocity).toBe(0)
    expect(metrics.velocityMode).toBe('observed_delta')
  })

  it('uses zero for unavailable likes/comments and excludes channel ratio for hidden subscribers', () => {
    const metrics = deriveMetrics(video({ likeCount: null, commentCount: null, subscriberCount: null }))
    expect(metrics.engagementRate).toBe(0)
    expect(metrics.channelRatio).toBeNull()
  })

  it('scores visible-subscriber videos in one query/run population without intermediate rounding', () => {
    const result = scoreYouTubePopulation([
      video(),
      video({ youtubeVideoId: 'video-b', viewCount: 100, likeCount: 0, commentCount: 0, subscriberCount: 1000 }),
    ], { buyerIntent: 80, commerceFit: 60 })
    expect(result.excludedReason).toBeNull()
    expect(result.opportunities).toHaveLength(2)
    const first = result.opportunities[0]
    expect(first.youtubeVideoId).toBe('video-a')
    expect(first.velocityPercentile).toBe(100)
    expect(first.channelRatioPercentile).toBe(100)
    expect(first.engagementPercentile).toBe(100)
    expect(first.percentilePopulationSize).toBe(2)
    expect(first.breakoutScore).toBe(99.4)
    expect(first.opportunityScore).toBe(90.58)
  })

  it('uses the subscriber-hidden breakout weights and a null ratio percentile', () => {
    const result = scoreYouTubePopulation([
      video({ subscriberCount: null }),
      video({ youtubeVideoId: 'video-b', viewCount: 100, likeCount: 0, commentCount: 0, subscriberCount: 1000 }),
    ], { buyerIntent: 80, commerceFit: 60 })
    const hidden = result.opportunities.find(item => item.youtubeVideoId === 'video-a')
    expect(hidden.channelRatio).toBeNull()
    expect(hidden.channelRatioPercentile).toBeNull()
    expect(hidden.breakoutScore).toBe(99.11)
  })

  it('does not score a query when either human commerce input is missing', () => {
    for (const inputs of [
      { buyerIntent: null, commerceFit: 50 },
      { buyerIntent: 50, commerceFit: null },
    ]) {
      const result = scoreYouTubePopulation([video()], inputs)
      expect(result.opportunities).toEqual([])
      expect(result.excludedReason).toBe('query_scoring_not_configured')
    }
  })

  it('filters videos missing views or publish time from the percentile population', () => {
    const result = scoreYouTubePopulation([
      video(),
      video({ youtubeVideoId: 'missing-views', viewCount: null }),
      video({ youtubeVideoId: 'missing-time', publishedAt: null }),
    ], { buyerIntent: 50, commerceFit: 50 })
    expect(result.opportunities).toHaveLength(1)
    expect(result.opportunities[0].percentilePopulationSize).toBe(1)
    expect(result.opportunities[0].velocityPercentile).toBe(50)
  })

  it('applies the exact TOP3 tie-break order using unrounded internal scores', () => {
    const rows = [
      { youtubeVideoId: 'b', publishedAt: '2026-10-07T10:00:00Z', _opportunityRaw: 80.001, _breakoutRaw: 70 },
      { youtubeVideoId: 'a', publishedAt: '2026-10-07T11:00:00Z', _opportunityRaw: 80.001, _breakoutRaw: 70 },
      { youtubeVideoId: 'z', publishedAt: '2026-10-07T12:00:00Z', _opportunityRaw: 80.001, _breakoutRaw: 71 },
      { youtubeVideoId: 'x', publishedAt: '2026-10-07T12:00:00Z', _opportunityRaw: 80.002, _breakoutRaw: 1 },
    ]
    expect(rows.sort(compareOpportunities).map(row => row.youtubeVideoId)).toEqual(['x', 'z', 'a', 'b'])
  })

  it('uses a separate tracking version while preserving v1 weights and excluding growth from scoring', () => {
    const input = video({ previousSnapshot: { viewCount: 500, capturedAt: hoursBefore(10) } })
    const discovery = scoreYouTubePopulation([input], { buyerIntent: 90, commerceFit: 95 })
    const tracking = scoreYouTubeTrackingPopulation([input], { buyerIntent: 90, commerceFit: 95 })
    expect(discovery.opportunities[0].scoreVersion).toBe('youtube-v1')
    expect(tracking.opportunities[0]).toMatchObject({
      scoreVersion: 'youtube-tracking-v1', velocityMode: 'observed_delta',
      breakoutScore: discovery.opportunities[0].breakoutScore,
      opportunityScore: discovery.opportunities[0].opportunityScore,
    })
    expect(tracking.opportunities[0].scoreParameters.tracking.growth_ratio_and_percent).toBe('display_only_not_scored')
  })

  it('never admits a lifetime estimate into the tracking population', () => {
    const tracking = scoreYouTubeTrackingPopulation([video()], { buyerIntent: 90, commerceFit: 95 })
    expect(tracking.scoreVersion).toBe('youtube-tracking-v1')
    expect(tracking.opportunities).toEqual([])
  })
})
