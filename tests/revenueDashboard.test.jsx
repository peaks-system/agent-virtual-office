import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RevenueLabView, nextCollectionLabel, opportunityReasons, queryNeedsScores, scoreLabel, scoreStrength, velocityPresentation, videoReviewUrl } from '../src/components/RevenueLabDashboard'

const handlers = { onReload: vi.fn(), onRun: vi.fn(), onTrack: vi.fn(), onAnalyze: vi.fn(), onReview: vi.fn(), onSave: vi.fn() }

describe('Revenue Lab dashboard', () => {
  it('formats saved scores and detects incomplete human inputs', () => {
    expect(scoreLabel(72.5)).toBe('72.50')
    expect(queryNeedsScores({ buyerIntent: null, commerceFit: 80 })).toBe(true)
    expect(queryNeedsScores({ buyerIntent: 0, commerceFit: 100 })).toBe(false)
  })

  it('maps score strength and velocity modes to deterministic Japanese labels', () => {
    expect([90, 89, 75, 74, 60, 59, 40, 39].map(scoreStrength)).toEqual([
      '非常に強い', '強い', '強い', '注目', '注目', '普通', '普通', '弱い',
    ])
    expect(velocityPresentation('observed_delta')).toMatchObject({ label: '実測', tone: 'observed' })
    expect(velocityPresentation('estimated_lifetime')).toMatchObject({ label: '公開後推定', tone: 'estimated' })
    expect(nextCollectionLabel('2026-10-07T19:00:00.000Z')).toContain('2026/10/08 05:15')
    expect(nextCollectionLabel('2026-10-07T21:00:00.000Z')).toContain('2026/10/09 05:15')
  })

  it('renders loading and server-only configuration states', () => {
    expect(renderToStaticMarkup(<RevenueLabView state={null} {...handlers} />)).toContain('読み込んでいます')
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: false, missing: ['YOUTUBE_API_KEY'] }, queries: [], opportunities: [], latestJob: null }} {...handlers} />)
    expect(markup).toContain('接続設定が必要です')
    expect(markup).toContain('YOUTUBE_API_KEY')
  })

  it('renders deterministic TOP3 order supplied by the backend', () => {
    const opportunities = [
      { id: 'a', youtubeVideoId: 'a', title: 'First', opportunityScore: 90.12, breakoutScore: 88.1, velocityMode: 'observed_delta', percentilePopulationSize: 25 },
      { id: 'b', youtubeVideoId: 'b', title: 'Second', opportunityScore: 80, breakoutScore: 78, velocityMode: 'estimated_lifetime', percentilePopulationSize: 25 },
      { id: 'c', youtubeVideoId: 'c', title: 'Third', opportunityScore: 70, breakoutScore: 68, velocityMode: 'observed_delta', percentilePopulationSize: 25 },
    ]
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: true, missing: [] }, queries: [], opportunities, latestJob: null }} {...handlers} />)
    expect(markup).toContain('#1')
    expect(markup).toContain('90.12')
    expect(markup.indexOf('First')).toBeLessThan(markup.indexOf('Second'))
    expect(markup.indexOf('Second')).toBeLessThan(markup.indexOf('Third'))
  })

  it('links each opportunity to its stored YouTube URL and shows review metrics', () => {
    const opportunity = {
      id: 'a', youtubeVideoId: 'abc123', sourceUrl: 'https://www.youtube.com/watch?v=stored',
      title: 'Review target', channelTitle: 'テストチャンネル', publishedAt: '2026-10-07T01:02:03.000Z',
      viewCount: 123456, subscriberCount: 7890, viewsVelocity: 321.5,
      opportunityScore: 90.12, breakoutScore: 88.1, velocityMode: 'observed_delta', percentilePopulationSize: 25,
    }
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: true, missing: [] }, queries: [], opportunities: [opportunity], latestJob: null }} {...handlers} />)
    expect(markup).toContain('href="https://www.youtube.com/watch?v=stored"')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain('YouTubeで見る')
    expect(markup).toContain('テストチャンネル')
    expect(markup).toContain('123,456')
    expect(markup).toContain('7,890')
    expect(markup).toContain('321.500000')
    expect(markup).toContain('2026/10/07')
  })

  it('renders research context, observed velocity evidence, reasons, and inspection details', () => {
    const opportunity = {
      id: 'a', youtubeVideoId: 'abc123', title: 'Review target', channelTitle: 'テストチャンネル',
      publishedAt: '2026-10-07T01:02:03.000Z', viewCount: 1234, previousViewCount: 1000,
      currentCapturedAt: '2026-10-08T00:00:00.000Z', previousCapturedAt: '2026-10-07T22:00:00.000Z',
      viewIncrease: 234, velocityElapsedHours: 2, subscriberCount: 500, viewsVelocity: 117,
      channelRatio: 2.468, engagementRate: 0.12, freshness: 85.5,
      velocityPercentile: 95, channelRatioPercentile: 80, engagementPercentile: 77,
      buyerIntent: 90, commerceFit: 95, opportunityScore: 92.12, breakoutScore: 91.1,
      velocityMode: 'observed_delta', percentilePopulationSize: 25, scoreVersion: 'youtube-v1',
    }
    const state = {
      config: { configured: true, missing: [] },
      queries: [{ id: 'q', label: '便利グッズ', queryText: '買ってよかった 便利グッズ', enabled: true, buyerIntent: 90, commerceFit: 95, lookbackDays: 7 }],
      opportunities: [opportunity],
      latestJob: { status: 'succeeded', attempts: 1 },
      latestRun: { capturedAt: '2026-10-08T00:00:00.000Z', receivedCount: 25, scoredCount: 23, status: 'succeeded' },
    }
    const markup = renderToStaticMarkup(<RevenueLabView state={state} {...handlers} />)
    expect(markup).toContain('買ってよかった 便利グッズ')
    expect(markup).toContain('直近7日')
    expect(markup).toContain('取得動画数')
    expect(markup).toContain('Score対象動画数')
    expect(markup).toContain('youtube-v1')
    expect(markup).toContain('毎日 05:15 JST')
    expect(markup).toContain('実測')
    expect(markup).toContain('前回取得から今回取得までの実際の再生増加速度')
    expect(markup).toContain('1,000')
    expect(markup).toContain('1,234')
    expect(markup).toContain('+234')
    expect(markup).toContain('2.00時間')
    expect(markup).toContain('2.47倍')
    expect(markup).toContain('非常に強い')
    expect(markup).toContain('再生速度が母集団上位')
    expect(markup).toContain('チャンネル規模に対して再生数が多い')
    expect(markup).toContain('engagementが高い')
    expect(markup).toContain('公開直後で鮮度が高い')
    expect(markup).toContain('詳細を見る')
    expect(markup).toContain('スコアについて')
    expect(opportunityReasons(opportunity)).toHaveLength(4)
  })

  it('falls back to an encoded video ID and rejects non-YouTube stored URLs', () => {
    expect(videoReviewUrl({ youtubeVideoId: 'a b', sourceUrl: null })).toBe('https://www.youtube.com/watch?v=a%20b')
    expect(videoReviewUrl({ youtubeVideoId: 'safe', sourceUrl: 'javascript:alert(1)' })).toBe('https://www.youtube.com/watch?v=safe')
  })

  it('shows incomplete query settings and disables manual run', () => {
    const query = { id: 'q', label: 'Theme', queryText: 'query', buyerIntent: null, commerceFit: null, enabled: true }
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: true, missing: [] }, queries: [query], opportunities: [], latestJob: null }} {...handlers} />)
    expect(markup).toContain('ランキング対象外')
    expect(markup).toMatch(/disabled=""[^>]*>Discovery実行/)
  })

  it('separates daily discovery from observed tracking without mixing rankings', () => {
    const tracking = {
      id: 'tracking-1', youtubeVideoId: 'tracked', title: 'Tracked video', channelTitle: 'Track channel',
      publishedAt: '2026-10-07T00:00:00Z', viewCount: 1500, previousViewCount: 1000,
      viewIncrease: 500, velocityElapsedHours: 24, viewsVelocity: 20.833333,
      growthRatio: 1.5, growthPercent: 50, subscriberCount: 500, channelRatio: 3,
      opportunityScore: 80, breakoutScore: 75, velocityMode: 'observed_delta',
      scoreVersion: 'youtube-tracking-v1', percentilePopulationSize: 10,
    }
    const markup = renderToStaticMarkup(<RevenueLabView state={{
      config: { configured: true, missing: [] }, queries: [], opportunities: [], trackingOpportunities: [tracking], latestJob: null,
    }} {...handlers} />)
    expect(markup).toContain('本日の発掘TOP3')
    expect(markup).toContain('継続観測・急伸TOP3')
    expect(markup).toContain('youtube-tracking-v1')
    expect(markup).toContain('1.500倍（+50.00%）')
    expect(markup).toContain('実測')
  })

  it('shows metadata-only AI hypotheses without changing card order', () => {
    const opportunities = [
      { id: 'a', sourceItemId: 'item-a', youtubeVideoId: 'a', title: 'First', opportunityScore: 90, breakoutScore: 88, velocityMode: 'estimated_lifetime', percentilePopulationSize: 25 },
      { id: 'b', sourceItemId: 'item-b', youtubeVideoId: 'b', title: 'Second', opportunityScore: 80, breakoutScore: 78, velocityMode: 'estimated_lifetime', percentilePopulationSize: 25 },
    ]
    const output = {
      product_or_theme_name: '便利グッズ', video_subject: '商品紹介候補', recommendation: 'hold',
      recommendation_reason: '追加の商品確認が必要', evidence_quality: 'limited',
      growth_hypotheses: [{ hypothesis: '検索テーマとの一致が考えられる', confidence: 'medium', supporting_indicators: ['query_match'] }],
      product_search_keywords: ['便利グッズ'], similar_product_categories: ['生活雑貨'], video_ideas: ['比較'], hooks: ['本当に便利？'],
    }
    const markup = renderToStaticMarkup(<RevenueLabView state={{
      config: { configured: true, missing: [], analysis: { configured: true } }, queries: [], opportunities,
      trackingOpportunities: [], analyses: [{ id: 'analysis-1', sourceItemId: 'item-a', status: 'succeeded', output }], latestJob: null,
    }} {...handlers} />)
    expect(markup).toContain('TOP1をAI分析')
    expect(markup).toContain('保存済みメタデータだけを使った解釈')
    expect(markup).toContain('成長仮説')
    expect(markup).toContain('確信度 中')
    expect(markup.indexOf('First')).toBeLessThan(markup.indexOf('Second'))
  })
})
