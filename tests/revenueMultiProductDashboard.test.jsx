import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { buildThreePicksCandidatePool, canCreateThreePicks, RevenueLabView,
  initialAudioLiveValidationArtifactId, threePicksCardPresentation, threePicksTimingPreflight,
  ThreePicksGenerationFeedback, threePicksGenerationFeedback, toggleThreePicksSelection } from '../src/components/RevenueLabDashboard'

const fn = vi.fn()
const handlers = { onReload: fn, onRun: fn, onTrack: fn, onAnalyze: fn, onReview: fn, onTranslate: fn,
  onEnrich: fn, onTranslationFeedback: fn, onProductSearch: fn, onProductDecision: fn,
  onCreateCampaign: fn, onCreateDirectProduct: fn, onCreateThreePicks: fn, onGenerateThreePicks: fn,
  onGenerateThreePicksV2: fn, onGenerateAudio: fn, onGenerateAudioArtifact: fn, onCompose: fn, onComposeV2: fn, onPreview: fn, onGenerateProduction: fn, onGenerateVideo: fn,
  onCreateAssetRevision: fn, onGenerateImageVideo: fn, onRegisterPublication: fn,
  onUpdateIteration: fn, onCreateIteration: fn, onDeleteCampaign: fn, onVoidCampaign: fn,
  onConnectAnalytics: fn, onCollectAnalytics: fn, onSave: fn }

function singleCampaign(index) {
  return { id: `campaign-${index}`, name: `商品${index}`, status: 'active', origins: [], iterations: [{
    id: `iteration-${index}`, iterationNumber: 1, status: 'draft', appealHypothesis: '訴求', hookText: 'Hook',
    contentOutline: { text: '構成' }, publication: null, productionPlans: [], archetypePlans: [],
    product: { id: `product-${index}`, productName: `商品${index}`, merchant: 'Shop', productUrl: 'https://example.com',
      verifiedFacts: { summary: `確認済み事実${index}` }, assets: [{ id: `asset-${index}`, assetUrl: `https://example.com/product-${index}.jpg`,
        usagePermission: 'owned', creativeEligible: true, revisions: [{ id: `revision-${index}`, revisionNumber: 1, availabilityStatus: 'available' }] }] },
  }] }
}

describe('Multi-product Shorts Dashboard', () => {
  it('shows hydrated revision state and safe evidence errors beside plan generation', () => {
    const pending = threePicksGenerationFeedback({ revisionNumber: 9, status: 'queued' })
    expect(renderToStaticMarkup(<ThreePicksGenerationFeedback feedback={pending} />)).toContain('Revision 9の制作案を生成中')
    const success = threePicksGenerationFeedback({ revisionNumber: 9, status: 'succeeded', planId: 'plan-9', output: {} })
    expect(renderToStaticMarkup(<ThreePicksGenerationFeedback feedback={success} />)).toContain('✓ Revision 9の制作案を生成しました')
    expect(renderToStaticMarkup(<ThreePicksGenerationFeedback feedback={success} />)).toContain('Planner v3 / Layout v2')
    expect(threePicksGenerationFeedback({ revisionNumber: 9, status: 'succeeded', planId: 'plan-9', output: {} },
      new Error('stale optimistic error'))).toEqual(success)
    const failure = threePicksGenerationFeedback(null, new Error('商品情報から動画用の根拠データを作成できませんでした。商品説明の形式を確認してください。'))
    const markup = renderToStaticMarkup(<ThreePicksGenerationFeedback feedback={failure} />)
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('商品説明の形式を確認してください。')
    const providerMarkup = renderToStaticMarkup(<ThreePicksGenerationFeedback feedback={{ kind: 'error',
      message: '制作案の生成に失敗しました', detail: 'AI生成設定の形式に問題があります。',
      audit: { httpStatus: 400, providerErrorCode: 'invalid_json_schema', providerErrorType: 'invalid_request_error',
        reason: 'response schema contains an unsupported keyword' } }} />)
    expect(providerMarkup).toContain('AI生成設定の形式に問題があります。')
    expect(providerMarkup).toContain('<details')
    expect(providerMarkup).toContain('AI生成エラー監査情報')
    expect(providerMarkup).toContain('invalid_json_schema')
  })

  it('shows human Three Picks intake and a completed composition lineage', () => {
    const productSet = { id: 'set-1', selectionMode: 'human', items: [1, 2, 3].map(index => ({ id: `item-${index}`,
      presentationOrder: index, productName: `商品${index}`, assetRevision: { revisionNumber: 1 } })) }
    const cards = [1, 2, 3].map(index => ({ id: `card-${index}`, pickNumber: index, productName: `商品${index}`,
      shortAppeal: `短い訴求${index}`, verifiedFact: { value: `確認済み事実${index}` }, price: null }))
    const multi = { id: 'campaign-multi', name: 'Three Picks', status: 'active', lineageKind: 'product_set', origins: [], iterations: [{
      id: 'iteration-multi', iterationNumber: 1, status: 'draft', appealHypothesis: '訴求', hookText: 'pending',
      contentOutline: { archetype: 'three_picks_v1' }, product: null, productSet, publication: null,
      productionPlans: [], archetypePlans: [{ requestId: 'request-1', revisionNumber: 1, status: 'succeeded',
        planId: 'plan-1', output: { hook: '便利な3つ', summary: 'まとめ', cta: '説明欄へ' }, productCards: cards,
        compositions: [{ id: 'composition-1', status: 'succeeded', output: { id: 'output-1', pixelWidth: 1080,
          pixelHeight: 1920, fps: 30, durationSeconds: 20, contentSha256: 'a'.repeat(64) } }] }] }] }
    const state = { config: { configured: true, missing: [], analysis: {}, commerceTranslation: {}, products: {},
      youtubeAnalytics: {}, creativeProduction: { configured: true }, videoGeneration: {}, imageToVideo: {},
      multiProductShorts: { configured: true }, finalComposition: { configured: true } }, queries: [], opportunities: [],
      trackingOpportunities: [], analyses: [], commerceTranslations: [], productSearches: [],
      campaigns: [...[1, 2, 3].map(singleCampaign), multi], latestJob: null }
    const markup = renderToStaticMarkup(<RevenueLabView state={state} {...handlers} />)
    expect(markup).toContain('Three Picksを作成')
    expect(markup).toContain('商品 → Three Picks制作 → MP4 → 公開・分析')
    expect(markup).toContain('PICK 1')
    expect(markup).toContain('Three Picks Plan')
    expect(markup).toContain('1080×1920')
    expect(markup).not.toContain('第1位')
  })

  it('keeps v1 and v2 Product Card revisions compatible in the normal display', () => {
    expect(threePicksCardPresentation({ productName: '従来商品', shortAppeal: '従来訴求',
      verifiedFact: { value: '従来事実' } })).toEqual({ displayName: '従来商品', shortAppeal: '従来訴求', factBadge: '従来事実', tts: '従来訴求' })
    expect(threePicksCardPresentation({ productName: '正本商品', shortAppeal: '短い訴求',
      cardSnapshot: { display_name: '表示名', fact_badge: '事実バッジ', tts: 'ナレーション原稿' },
      verifiedFact: { value: '全文事実' } })).toEqual({ displayName: '表示名', shortAppeal: '短い訴求', factBadge: '事実バッジ', tts: 'ナレーション原稿' })
  })

  it('shows v2 layer-template and segment audio readiness without a Product Card intermediary', () => {
    const productSet = { id: 'set-v2', archetype: 'three_picks_v2', selectionMode: 'human', items: [1, 2, 3].map(index => ({
      id: `item-v2-${index}`, presentationOrder: index, productName: `商品${index}`, assetRevision: { revisionNumber: 1 },
      assetRevisions: [{ assetOrder: 1 }, { assetOrder: 2 }],
    })) }
    const presentations = [1, 2, 3].map(index => ({ product_set_item_id: `item-v2-${index}`,
      presentation_order: index, display_name: `商品${index}`, short_appeal: `短い訴求${index}`,
      fact_badge: `事実${index}`, tts: `ナレーション${index}` }))
    const campaign = { id: 'campaign-v2', name: 'Creative Archetype v2', status: 'active', lineageKind: 'product_set', origins: [], iterations: [{
      id: 'iteration-v2', iterationNumber: 1, status: 'draft', product: null, productSet, publication: null,
      productionPlans: [], archetypePlans: [{ requestId: 'request-v2', archetype: 'three_picks_v2', revisionNumber: 1,
        status: 'succeeded', planId: 'plan-v2', schemaVersion: 'multi-product-shorts-plan-v4', output: { hook: { display_text: '3つを紹介', tts: '車内快適グッズ三選' }, product_presentations: presentations,
          cta: { display_text: '詳細を見る', tts: '気になる商品は概要欄へ' } }, productCards: [], audioArtifacts: Array.from({ length: 15 }, (_, index) => ({
            id: `audio-${index + 1}`, creativeArchetypePlanId: 'plan-v2', sceneId: index < 3 ? 'hook' : `product-${Math.ceil((index - 2) / 4)}`,
            segmentId: index < 3 ? `hook-${index + 1}` : `product-${index - 2}`, segmentOrder: index + 1,
            inputText: `ナレーションsegment ${index + 1}`, status: 'planned',
          })), compositions: [] }] }] }
    const state = { config: { configured: true, missing: [], analysis: {}, products: {},
      creativeProduction: {}, videoGeneration: {}, imageToVideo: {}, productAssetRevisions: {}, multiProductShorts: {}, finalComposition: {},
      multiProductShortsV2: { configured: true }, textToSpeech: { configured: true }, finalCompositionV2: { configured: false } }, queries: [], opportunities: [],
      trackingOpportunities: [], analyses: [], productSearches: [], campaigns: [campaign], latestJob: null }
    const markup = renderToStaticMarkup(<RevenueLabView state={state} {...handlers} />)
    expect(markup).toContain('Creative Archetype v2 Plan')
    expect(markup).toContain('hero-carousel-v2')
    expect(markup).toContain('hero-product-layout-v2')
    expect(markup).toContain('0 / 15 ready')
    expect(markup).toContain('このsegmentだけ音声生成')
    expect(markup).toContain('初回Live ValidationではHookの最初のsegmentだけを生成できます')
    expect(markup).toContain('全planned segmentを生成（15件 / 最大15件）')
    expect(markup).toContain('FFprobe実測duration')
    expect(markup).toContain('MP4合成に必要なprivate storage・FFmpeg/FFprobe・描画fontを確認してください')
    expect(markup).toContain('Hook TTS')
    expect(markup).toContain('車内快適グッズ三選')
    expect(markup).toContain('PICK 1')
    expect(markup).toContain('ナレーション1')
    expect(markup).toContain('ナレーション2')
    expect(markup).toContain('ナレーション3')
    expect(markup).toContain('CTA TTS')
    expect(markup).toContain('気になる商品は概要欄へ')
    expect(markup).toMatch(/<button[^>]*>この原稿で音声を生成<\/button>/)
    expect(markup).not.toContain('v2 rendererはFoundation状態です')
    expect(markup).not.toContain('product-card-v3')
  })

  it('renders only the latest v2 revision as interactive when older Hook artifacts failed', () => {
    const productSet = { id: 'set-v2-revisions', archetype: 'three_picks_v2', selectionMode: 'human', items: [1, 2, 3].map(index => ({
      id: `item-v2-revisions-${index}`, presentationOrder: index, productName: `商品${index}`,
      assetRevision: { revisionNumber: 1 }, assetRevisions: [{ assetOrder: 1 }],
    })) }
    const audioArtifacts = (revisionNumber, hookStatus) => Array.from({ length: 11 }, (_, index) => ({
      id: `audio-rev-${revisionNumber}-${index + 1}`, creativeArchetypePlanId: `plan-rev-${revisionNumber}`,
      sceneId: index < 2 ? 'hook' : 'product-1', segmentId: index === 0 ? 'hook-1' : `segment-${index + 1}`,
      segmentOrder: index + 1, inputText: `Revision ${revisionNumber} segment ${index + 1}`,
      status: index === 0 ? hookStatus : 'planned',
    }))
    const revision = (revisionNumber, hookStatus) => ({
      requestId: `request-rev-${revisionNumber}`, archetype: 'three_picks_v2', revisionNumber,
      status: 'succeeded', planId: `plan-rev-${revisionNumber}`,
      output: { hook: { display_text: `Revision ${revisionNumber} Hook` }, product_presentations: [], cta: { display_text: '詳細を見る' } },
      productCards: [], audioArtifacts: audioArtifacts(revisionNumber, hookStatus), compositions: [],
    })
    const latestRevision = revision(4, 'planned')
    latestRevision.audioArtifacts.push({ id: 'stale-cross-plan-hook', creativeArchetypePlanId: 'plan-rev-3',
      sceneId: 'hook', segmentId: 'hook-1', segmentOrder: 1, inputText: 'stale failed Hook', status: 'failed' })
    const campaign = { id: 'campaign-v2-revisions', name: 'Revision history', status: 'active', lineageKind: 'product_set', origins: [], iterations: [{
      id: 'iteration-v2-revisions', iterationNumber: 1, status: 'draft', product: null, productSet, publication: null,
      productionPlans: [], archetypePlans: [revision(2, 'failed'), latestRevision, revision(1, 'failed'), revision(3, 'failed')],
    }] }
    const state = { config: { configured: true, missing: [], analysis: {}, products: {},
      creativeProduction: {}, videoGeneration: {}, imageToVideo: {}, productAssetRevisions: {}, multiProductShorts: {}, finalComposition: {},
      multiProductShortsV2: { configured: true }, textToSpeech: { configured: true }, finalCompositionV2: { configured: false } },
      queries: [], opportunities: [], trackingOpportunities: [], analyses: [], productSearches: [], campaigns: [campaign], latestJob: null }

    const markup = renderToStaticMarkup(<RevenueLabView state={state} {...handlers} />)
    expect(markup).toContain('制作案 Revision 4')
    expect(markup).toContain('最新')
    expect(markup).toContain('artifact 11件')
    expect(markup).toContain('ready 0 / planned 11 / failed 0')
    expect(markup).toContain('0 / 11 ready')
    expect(markup).toMatch(/hook · hook-1<\/strong><span>planned<\/span>/)
    expect(markup).toContain('過去の制作案・監査情報（3件）')
    expect(markup.match(/このsegmentだけ音声生成/g)).toHaveLength(11)
    expect(markup.match(/全planned segmentを生成/g)).toHaveLength(1)
  })
  it('limits a fresh plan to its first Hook artifact, then releases the UI-only Live Validation gate', () => {
    const artifacts = [
      { id: 'product-1', sceneId: 'product-1', segmentOrder: 1, status: 'planned' },
      { id: 'hook-2', sceneId: 'hook', segmentOrder: 2, status: 'planned' },
      { id: 'hook-1', sceneId: 'hook', segmentOrder: 1, status: 'planned' },
    ]
    expect(initialAudioLiveValidationArtifactId(artifacts)).toBe('hook-1')
    expect(initialAudioLiveValidationArtifactId([{ ...artifacts[0], status: 'ready' }, ...artifacts.slice(1)])).toBeNull()
  })

  it('disables composition and shows scene timing when ready Hook audio overflows', () => {
    const durations = {
      hook: [3.529, 4.783], 'product-1': [1.858, 5.944, 4.69],
      'product-2': [5.201, 4.458], 'product-3': [3.204, 2.415, 4.876], cta: [4.505],
    }
    const artifacts = Object.entries(durations).flatMap(([sceneId, values]) => values.map((durationSeconds, index) => ({
      id: `${sceneId}-${index + 1}`, creativeArchetypePlanId: 'plan-timing-overflow', sceneId,
      segmentId: `${sceneId}-${index + 1}`, segmentOrder: index + 1, status: 'ready', durationSeconds,
    })))
    const preflight = threePicksTimingPreflight(artifacts)
    expect(preflight.fit).toBe(false)
    expect(preflight.totalRequiredSeconds).toBe(48.033)
    expect(preflight.scenes.find(scene => scene.id === 'hook')).toMatchObject({
      requiredSeconds: 8.833, maximumSeconds: 5, overflowSeconds: 3.833, fit: false,
    })
    expect(preflight.scenes.filter(scene => scene.id !== 'hook').every(scene => scene.fit)).toBe(true)

    const productSet = { id: 'set-timing-overflow', archetype: 'three_picks_v2', selectionMode: 'human', items: [] }
    const campaign = { id: 'campaign-timing-overflow', name: 'Timing overflow', status: 'active', lineageKind: 'product_set', origins: [], iterations: [{
      id: 'iteration-timing-overflow', iterationNumber: 1, status: 'draft', product: null, productSet, publication: null,
      productionPlans: [], archetypePlans: [{ requestId: 'request-timing-overflow', archetype: 'three_picks_v2', revisionNumber: 4,
        status: 'succeeded', planId: 'plan-timing-overflow', output: { hook: { display_text: 'Hook' }, product_presentations: [], cta: { display_text: 'CTA' } },
        productCards: [], audioArtifacts: artifacts, compositions: [] }],
    }] }
    const state = { config: { configured: true, missing: [], analysis: {}, commerceTranslation: {}, products: {}, youtubeAnalytics: {},
      creativeProduction: {}, videoGeneration: {}, imageToVideo: {}, productAssetRevisions: {}, multiProductShorts: {}, finalComposition: {},
      multiProductShortsV2: { configured: true }, textToSpeech: { configured: true }, finalCompositionV2: { configured: true } },
      queries: [], opportunities: [], trackingOpportunities: [], analyses: [], commerceTranslations: [], productSearches: [], campaigns: [campaign], latestJob: null }
    const markup = renderToStaticMarkup(<RevenueLabView state={state} {...handlers} />)
    expect(markup).toContain('Composition timing preflight')
    expect(markup).toContain('Hook 8.83s / max 5.00s')
    expect(markup).toContain('3.83s overflow')
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Shorts MP4を合成<\/button>/)
  })

  it('always shows eligible and ineligible candidates when fewer than three are ready', () => {
    const ready = singleCampaign(1)
    const needsRevision = singleCampaign(2)
    needsRevision.iterations[0].product.assets[0].revisions = []
    const ineligible = singleCampaign(3)
    ineligible.iterations[0].product.productUrl = ''
    ineligible.iterations[0].product.affiliateUrl = ''
    ineligible.iterations[0].product.verifiedFacts = {}
    ineligible.iterations[0].product.assets[0].usagePermission = 'unknown'
    ineligible.iterations[0].product.assets[0].creativeEligible = false
    ineligible.iterations[0].product.assets[0].revisions = []
    const state = { config: { configured: true, missing: [], analysis: {}, commerceTranslation: {}, products: {},
      youtubeAnalytics: {}, creativeProduction: {}, videoGeneration: {}, imageToVideo: {},
      productAssetRevisions: { configured: true }, multiProductShorts: { configured: true }, finalComposition: {} },
      queries: [], opportunities: [], trackingOpportunities: [], analyses: [], commerceTranslations: [], productSearches: [],
      campaigns: [ready, needsRevision, ineligible], latestJob: null }
    const markup = renderToStaticMarkup(<RevenueLabView state={state} {...handlers} />)
    expect(markup).toContain('商品候補pool')
    expect(markup).toContain('選択数 0 / 3')
    expect(markup).toContain('1件 eligible / 3件')
    expect(markup).toContain('商品1を選択')
    expect(markup).toContain('商品2')
    expect(markup).toContain('Asset Revisionを準備')
    expect(markup).toContain('商品3')
    expect(markup).toContain('確認済み事実がありません')
    expect(markup).toContain('commerce destinationがありません')
    expect(markup).toContain('利用許可済みProduct Assetがありません')
    expect(markup).toContain('商品を追加')
  })

  it('caps distinct checkbox selection at three and preserves selection order', () => {
    let selected = []
    selected = toggleThreePicksSelection(selected, 'product-b', true)
    selected = toggleThreePicksSelection(selected, 'product-a', true)
    selected = toggleThreePicksSelection(selected, 'product-c', true)
    selected = toggleThreePicksSelection(selected, 'product-d', true)
    selected = toggleThreePicksSelection(selected, 'product-a', true)
    expect(selected).toEqual(['product-b', 'product-a', 'product-c'])
    expect(toggleThreePicksSelection(selected, 'product-a', false)).toEqual(['product-b', 'product-c'])
  })

  it('enables creation only for exactly three eligible products', () => {
    const candidates = [
      { product: { id: 'a' }, eligible: true }, { product: { id: 'b' }, eligible: true },
      { product: { id: 'c' }, eligible: true }, { product: { id: 'd' }, eligible: false },
    ]
    expect(canCreateThreePicks(['a', 'b'], candidates)).toBe(false)
    expect(canCreateThreePicks(['a', 'b', 'd'], candidates)).toBe(false)
    expect(canCreateThreePicks(['a', 'b', 'c'], candidates)).toBe(true)
  })

  it('derives explicit candidate eligibility without hiding incomplete products', () => {
    const campaigns = [singleCampaign(1), singleCampaign(2)]
    campaigns[1].iterations[0].product.assets[0].revisions = []
    const pool = buildThreePicksCandidatePool(campaigns)
    expect(pool).toHaveLength(2)
    expect(pool[0]).toMatchObject({ eligible: true, verifiedFactsAvailable: true, commerceDestinationAvailable: true })
    expect(pool[1]).toMatchObject({ eligible: false, assetRevisionAvailable: false })
    expect(pool[1].ineligibleReasons).toContain('Asset Revisionがありません')
  })
})
