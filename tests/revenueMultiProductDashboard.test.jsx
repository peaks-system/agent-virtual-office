import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RevenueLabView } from '../src/components/RevenueLabDashboard'

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
      verifiedFacts: { summary: `確認済み事実${index}` }, assets: [{ id: `asset-${index}`, revisions: [{ id: `revision-${index}`, revisionNumber: 1, availabilityStatus: 'available' }] }] },
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
})
