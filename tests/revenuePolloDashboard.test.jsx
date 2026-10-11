import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RevenueLabView } from '../src/components/RevenueLabDashboard'

const handlers = {
  onReload: vi.fn(), onRun: vi.fn(), onTrack: vi.fn(), onAnalyze: vi.fn(), onReview: vi.fn(),
  onProductSearch: vi.fn(), onProductDecision: vi.fn(), onCreateCampaign: vi.fn(),
  onGenerateProduction: vi.fn(), onGenerateVideo: vi.fn(), onRegisterPublication: vi.fn(), onSave: vi.fn(),
}

describe('Revenue Lab Pollo dashboard', () => {
  it('renders generation only for AI scenes with normalized status, actual cost, and preview', () => {
    const output = {
      target_format: 'youtube_shorts', aspect_ratio: '9:16', target_duration_seconds: 20,
      creative_objective: '利用文脈を短尺で示す', narration_script: '紹介します。', narration_fact_references: [],
      subtitle_segments: [], cta: { text: '商品情報を確認', placement_seconds: 18, product_fact_references: [] },
      scenes: [
        { scene_number: 1, start_seconds: 0, duration_seconds: 5, purpose: '商品提示', visual_source_type: 'real_product_asset', product_asset_id: 'asset-1', ai_generation_prompt: null, on_screen_text: '商品', narration: '', product_fact_references: ['product.name'] },
        { scene_number: 2, start_seconds: 5, duration_seconds: 5, purpose: '利用文脈', visual_source_type: 'ai_generated_scene', product_asset_id: null, ai_generation_prompt: '[背景のみ] 明るい室内', on_screen_text: '利用イメージ', narration: '', product_fact_references: [] },
      ],
    }
    const state = {
      config: { configured: true, missing: [], analysis: { configured: false }, products: { configured: false }, creativeProduction: { configured: true }, videoGeneration: { configured: true, requestedModel: 'pollo-v2', resolution: '480p' } },
      queries: [], opportunities: [], trackingOpportunities: [], analyses: [], productSearches: [], latestJob: null,
      campaigns: [{ id: 'campaign-1', name: '制作検証', status: 'active', origins: [], iterations: [{
        id: 'iteration-1', iterationNumber: 1, status: 'draft', appealHypothesis: '訴求', hookText: 'Hook', contentOutline: { text: '構成' }, publication: null,
        product: { productName: '確認済み商品', merchant: '自社', productUrl: 'https://example.com/product', assets: [{ id: 'asset-1', label: '正面素材', assetUrl: 'https://example.com/asset.jpg', assetKind: 'hero', usagePermission: 'owned' }] },
        productionPlans: [{ requestId: 'request-1', planId: 'plan-1', revisionNumber: 1, status: 'succeeded', schemaVersion: 'creative-production-plan-v1', output,
          videoGenerations: [{ id: 'generation-1', sceneNumber: 2, attemptNumber: 5, provider: 'pollo', model: 'pollo-v2', providerTaskStatus: 'succeed', status: 'succeeded', resolution: '480p', providerCost: 0.06, costCurrency: 'USD', costProvenance: 'actual', outputUrl: 'https://cdn.example/video.mp4', safeErrorCode: null }] }],
      }] }],
    }
    const markup = renderToStaticMarkup(<RevenueLabView state={state} {...handlers} />)
    expect(markup).toContain('Pollo映像素材')
    expect((markup.match(/Pollo映像素材/g) || [])).toHaveLength(1)
    expect(markup).toContain('succeed')
    expect(markup).toContain('USD 0.0600（実績）')
    expect(markup).toContain('src="https://cdn.example/video.mp4"')
    expect(markup).not.toContain('VIDEO_GENERATION_POLL_TIMEOUT')
  })
})
