import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { buildThreePicksCandidatePool, canCreateThreePicks, RevenueLabView, toggleThreePicksSelection } from '../src/components/RevenueLabDashboard'

const fn = vi.fn()
const handlers = { onReload: fn, onRun: fn, onTrack: fn, onAnalyze: fn, onReview: fn, onTranslate: fn,
  onEnrich: fn, onTranslationFeedback: fn, onProductSearch: fn, onProductDecision: fn,
  onCreateCampaign: fn, onCreateDirectProduct: fn, onCreateThreePicks: fn, onGenerateThreePicks: fn,
  onCompose: fn, onPreview: fn, onGenerateProduction: fn, onGenerateVideo: fn,
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
    expect(markup).toContain('PICK 1')
    expect(markup).toContain('Three Picks Plan')
    expect(markup).toContain('1080×1920')
    expect(markup).not.toContain('第1位')
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
