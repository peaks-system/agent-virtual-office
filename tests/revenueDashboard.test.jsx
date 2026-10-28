import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RevenueLabView, campaignSavePresentation, manualProductSearchLinks, newCampaignIdempotencyKey, nextCollectionLabel, opportunityReasons, queryNeedsScores, safeRakutenUrl, scoreLabel, scoreStrength, velocityPresentation, videoReviewUrl } from '../src/components/RevenueLabDashboard'

const handlers = { onReload: vi.fn(), onRun: vi.fn(), onTrack: vi.fn(), onAnalyze: vi.fn(), onReview: vi.fn(), onProductSearch: vi.fn(), onProductDecision: vi.fn(), onCreateCampaign: vi.fn(), onCreateDirectProduct: vi.fn(), onRegisterPublication: vi.fn(), onSave: vi.fn() }

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
    expect(markup).toMatch(/disabled=""[^>]*>今日の新着を更新/)
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
    expect(markup).toContain('今日の新着')
    expect(markup).toContain('継続上昇')
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
      product_or_theme_name: '便利グッズ', video_subject: '商品紹介候補', recommendation: 'adopt',
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
    expect(markup).toContain('次の調査対象として採用')
    expect(markup).toContain('制作・商品採用の確定ではなく')
    expect(markup).toContain('成長仮説')
    expect(markup).toContain('確信度 中')
    expect(markup.indexOf('First')).toBeLessThan(markup.indexOf('Second'))
  })

  it('renders provider facts, deterministic score components, and research-only selection wording', () => {
    const opportunity = { id: 'a', sourceItemId: 'item-a', youtubeVideoId: 'a', title: 'First', opportunityScore: 90, breakoutScore: 88, velocityMode: 'estimated_lifetime', percentilePopulationSize: 25 }
    const output = { product_or_theme_name: '便利グッズ', video_subject: '候補', recommendation: 'adopt', recommendation_reason: '調査', evidence_quality: 'limited', growth_hypotheses: [], product_search_keywords: ['便利グッズ'], similar_product_categories: [], video_ideas: [], hooks: [] }
    const candidate = { id: 'candidate-1', rankPosition: 1, title: '実在商品', shopName: '楽天ショップ', productUrl: 'https://item.rakuten.co.jp/shop/item', imageUrls: [], priceAmount: 3980, reviewAverage: 4.5, reviewCount: 20, affiliateRate: 2, candidateScore: 82.4, scoreVersion: 'product-rakuten-v1', keywordMatchScore: 100, searchCoverageScore: 100, providerRankScore: 100, reviewCountScore: 50, reviewAverageScore: 90, affiliateRateScore: 50 }
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: true, missing: [], analysis: { configured: true }, products: { configured: true } }, queries: [], opportunities: [opportunity], trackingOpportunities: [], analyses: [{ id: 'analysis-1', sourceItemId: 'item-a', status: 'succeeded', output }], productSearches: [{ id: 'run-1', analysisId: 'analysis-1', status: 'succeeded', providerApiVersion: '20260701', fetchedAt: '2026-10-09T00:00:00Z', keywords: ['便利グッズ'], candidates: [candidate] }], latestJob: null }} {...handlers} />)
    expect(markup).toContain('Product Candidate Finder')
    expect(markup).toContain('API 20260701')
    expect(markup).toContain('実在商品')
    expect(markup).toContain('¥3,980')
    expect(markup).toContain('キーワード一致')
    expect(markup).toContain('次の調査対象に選ぶ')
    expect(markup).toContain('商品紹介・公開の承認ではありません')
    expect(markup).toContain('target="_blank"')
  })

  it('allows only HTTPS Rakuten links from provider data', () => {
    expect(safeRakutenUrl('https://item.rakuten.co.jp/shop/item')).toContain('rakuten.co.jp')
    expect(safeRakutenUrl('javascript:alert(1)')).toBeNull()
    expect(safeRakutenUrl('https://example.com/item')).toBeNull()
  })

  it('builds external search links only from saved AI keywords', () => {
    const links = manualProductSearchLinks(['卓上 ライト', '卓上 ライト', '', null])
    expect(links).toHaveLength(4)
    expect(links.map(link => link.provider)).toEqual(['Amazon', '楽天市場', 'Yahoo!ショッピング', 'Google'])
    expect(links.every(link => link.keyword === '卓上 ライト' && link.url.startsWith('https://'))).toBe(true)
    expect(links[0].url).toContain('%E5%8D%93%E4%B8%8A%20%E3%83%A9%E3%82%A4%E3%83%88')
  })

  it('locks the Campaign save action while sending and after success', () => {
    expect(campaignSavePresentation(false, null)).toEqual({ label: '商品・Campaign・Iterationを保存', disabled: false })
    expect(campaignSavePresentation(true, null)).toEqual({ label: '保存中…', disabled: true })
    expect(campaignSavePresentation(false, { campaignId: 'campaign-1' })).toEqual({ label: '保存済み', disabled: true })
    expect(newCampaignIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('shows the API-optional manual product flow and complete campaign lineage', () => {
    const opportunity = { id: 'opp-1', sourceItemId: 'item-a', youtubeVideoId: 'source01', title: 'Source', opportunityScore: 90, breakoutScore: 88, velocityMode: 'estimated_lifetime', percentilePopulationSize: 25 }
    const output = { product_or_theme_name: '卓上ライト', video_subject: '候補', recommendation: 'adopt', recommendation_reason: '比較余地', evidence_quality: 'limited', growth_hypotheses: [], product_search_keywords: ['卓上 ライト'], similar_product_categories: [], video_ideas: ['比較企画'], hooks: ['暗い机が変わる'], }
    const campaigns = [{ id: 'campaign-1', name: '卓上ライト検証', objective: 'クリック仮説の検証', status: 'active', primaryAnalysisId: 'analysis-1', origins: [{ id: 'origin-1', contextKind: 'discovery', rankPosition: 1, scoreVersion: 'youtube-v1' }], iterations: [{ id: 'iteration-1', iterationNumber: 1, status: 'published', sourceAnalysisId: 'analysis-1', appealHypothesis: '省スペース', hookText: '暗い机が変わる', contentOutline: { text: '比較して紹介' }, treatmentFingerprint: 'a'.repeat(64), product: { productName: '確認済みライト', merchant: 'Example Shop', discoveryChannel: 'google_search', searchKeyword: '卓上 ライト', productUrl: 'https://example.com/product', affiliateUrl: null }, publication: { youtubeVideoId: 'video123', canonicalUrl: 'https://www.youtube.com/watch?v=video123' } }] }]
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: true, missing: [], analysis: { configured: true }, products: { configured: false } }, queries: [], opportunities: [opportunity], trackingOpportunities: [], analyses: [{ id: 'analysis-1', sourceItemId: 'item-a', status: 'succeeded', output }], productSearches: [], campaigns, latestJob: null }} {...handlers} />)
    expect(markup).toContain('Manual / Search Product')
    expect(markup).toContain('商品APIなしで利用可能')
    expect(markup).toContain('Amazon: 卓上 ライト')
    expect(markup).toContain('楽天市場: 卓上 ライト')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain('楽天認証情報が未設定でも')
    expect(markup).toContain('Campaign実験台帳')
    expect(markup).toContain('卓上ライト検証')
    expect(markup).toContain('確認済みライト')
    expect(markup).toContain('Iteration #1')
    expect(markup).toContain('YouTube Video ID: video123')
    expect(markup).toContain('Treatment fingerprint')
  })

  it('allows a pre-publication Campaign and exposes later Video ID registration', () => {
    const opportunity = { id: 'opp-1', sourceItemId: 'item-a', youtubeVideoId: 'source01', title: 'Source', opportunityScore: 90, breakoutScore: 88, velocityMode: 'estimated_lifetime', percentilePopulationSize: 25 }
    const output = { product_or_theme_name: '商品', video_subject: '候補', recommendation: 'hold', recommendation_reason: '調査', evidence_quality: 'limited', growth_hypotheses: [], product_search_keywords: ['商品 検索'], similar_product_categories: [], video_ideas: ['構成'], hooks: ['Hook'] }
    const campaigns = [{ id: 'campaign-draft', name: '公開前Campaign', status: 'active', origins: [], iterations: [{ id: 'iteration-draft', iterationNumber: 1, status: 'draft', appealHypothesis: '訴求', hookText: 'Hook', contentOutline: { text: '構成' }, treatmentFingerprint: 'c'.repeat(64), product: { productName: '確認済み商品', merchant: 'Shop', discoveryChannel: 'google_search', searchKeyword: '商品 検索', productUrl: 'https://example.com/product' }, publication: null }] }]
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: true, missing: [], analysis: { configured: true }, products: { configured: false } }, queries: [], opportunities: [opportunity], trackingOpportunities: [], analyses: [{ id: 'analysis-1', sourceItemId: 'item-a', status: 'succeeded', output }], productSearches: [], campaigns, latestJob: null }} {...handlers} />)
    expect(markup).toContain('YouTube公開情報（任意・後から登録可）')
    expect(markup).toContain('公開前は空欄のまま保存できます')
    expect(markup).toMatch(/YouTube Video ID（任意）<input pattern="\[A-Za-z0-9_\-\]\{6,32\}" value=""\/?>/)
    expect(markup).toContain('Iteration #1')
    expect(markup).toContain('下書き')
    expect(markup).toContain('公開後にYouTube情報を追加')
    expect(markup).toContain('Publicationを登録')
  })
  it('renders an independent Direct Product intake and explicit fact, asset, and Campaign lineage', () => {
    const campaigns = [{
      id: 'campaign-direct', lineageKind: 'direct_product', name: '自社商品Campaign', status: 'active', origins: [],
      iterations: [{ id: 'iteration-direct', iterationNumber: 1, status: 'draft', sourceAnalysisId: null,
        registrationOnly: true, appealHypothesis: '[INTERNAL:DIRECT_PRODUCT_REGISTRATION_ONLY]',
        hookText: '[INTERNAL:NO_CREATIVE_HOOK]', contentOutline: { format: 'internal_placeholder', text: '[INTERNAL:NO_CREATIVE_OUTLINE]', reusable: false }, treatmentFingerprint: 'd'.repeat(64),
        product: { productName: '確認済み商品', merchant: '自社', productCategory: '生活用品', productUrl: 'https://example.com/product', isOwnProduct: true,
          verifiedFacts: { summary: '寸法と材質を確認済み' }, cautions: '火気厳禁',
          assets: [{ id: 'asset-1', ordinal: 1, label: '正面素材', assetUrl: 'https://example.com/hero.jpg', assetKind: 'hero', assetSource: 'self_owned', usagePermission: 'owned', creativeEligible: true }] },
        publication: null }],
    }]
    const state = { config: { configured: true, missing: [], analysis: { configured: false }, products: { configured: false } }, queries: [], opportunities: [], trackingOpportunities: [], analyses: [], productSearches: [], campaigns, latestJob: null }
    const markup = renderToStaticMarkup(<RevenueLabView state={state} {...handlers} />)
    expect(markup).toContain('商品を登録')
    expect(markup).toContain('商品情報と利用可能な素材を登録')
    expect(markup).toContain('確認済み事実の詳細')
    expect(markup).toContain('Product Asset')
    const intake = markup.slice(markup.indexOf('id="direct-product-intake"'), markup.indexOf('</section>', markup.indexOf('id="direct-product-intake"')))
    expect(intake).not.toContain('Campaign名')
    expect(intake).not.toContain('訴求仮説')
    expect(intake).not.toContain('台本本文')
    expect(markup).toContain('Direct Product · Opportunity/AI Analysisなし')
    expect(markup).toContain('確認済み商品 · 自社商品')
    expect(markup).toContain('寸法と材質を確認済み')
    expect(markup).toContain('正面素材')
    expect(markup).toContain('対象外（Direct Product）')
    expect(markup).toContain('CreativeはThree Picks制作案で生成します')
    expect(markup).not.toContain('[INTERNAL:')
    expect(markup).not.toContain('Creative Production Plan')
    expect(markup).not.toContain('Publicationを登録')
  })


})
