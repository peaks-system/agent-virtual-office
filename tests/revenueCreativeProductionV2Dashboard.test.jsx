import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RevenueLabView } from '../src/components/RevenueLabDashboard'

const handlers = { onReload: vi.fn(), onRun: vi.fn(), onTrack: vi.fn(), onAnalyze: vi.fn(), onReview: vi.fn(), onTranslate: vi.fn(), onEnrich: vi.fn(), onTranslationFeedback: vi.fn(), onProductSearch: vi.fn(), onProductDecision: vi.fn(), onCreateCampaign: vi.fn(), onCreateDirectProduct: vi.fn(), onGenerateProduction: vi.fn(), onGenerateVideo: vi.fn(), onRegisterPublication: vi.fn(), onUpdateIteration: vi.fn(), onCreateIteration: vi.fn(), onDeleteCampaign: vi.fn(), onVoidCampaign: vi.fn(), onConnectAnalytics: vi.fn(), onCollectAnalytics: vi.fn(), onSave: vi.fn() }

describe('Creative Production Plan v2 dashboard', () => {
  it('shows Static-first routes and never offers Pollo for image motion', () => {
    const scenes = [
      { scene_number: 1, start_seconds: 0, duration_seconds: 5, purpose: '商品提示', rendering_strategy: 'static_product_scene', visual_source_type: 'real_product_asset', product_asset_id: 'asset-1', motion_instruction: { mode: 'slow_zoom_in', description: '編集時にズーム' }, requires_ai_generation: false, recommended_model_class: 'none', preserve_product_identity: true, ai_generation_prompt: null, on_screen_text: '商品', narration: '', product_fact_references: [] },
      { scene_number: 2, start_seconds: 5, duration_seconds: 5, purpose: '商品画像モーション', rendering_strategy: 'image_motion_scene', visual_source_type: 'real_product_asset', product_asset_id: 'asset-1', motion_instruction: { mode: 'provider_motion', description: '背景だけを動かす' }, requires_ai_generation: true, recommended_model_class: 'product_preserving_i2v', preserve_product_identity: true, ai_generation_prompt: '[実商品画像を変更しない。形状・色・ロゴ・ラベル・ボタン・寸法感を維持] 背景のみ', on_screen_text: '', narration: '', product_fact_references: [] },
      { scene_number: 3, start_seconds: 10, duration_seconds: 5, purpose: '抽象演出', rendering_strategy: 'stylized_scene', visual_source_type: 'ai_generated_scene', product_asset_id: null, motion_instruction: { mode: 'provider_motion', description: 'イラストを動かす' }, requires_ai_generation: true, recommended_model_class: 'stylized_t2v', preserve_product_identity: false, ai_generation_prompt: '[背景・演出のみ。商品本体を描写しない] 抽象イラスト', on_screen_text: '', narration: '', product_fact_references: [] },
    ]
    const output = { target_format: 'youtube_shorts', aspect_ratio: '9:16', target_duration_seconds: 15, creative_objective: '安全な商品紹介', narration_script: '', narration_fact_references: [], subtitle_segments: [], scenes, cta: { text: '', placement_seconds: 14, product_fact_references: [] }, production_notes: [] }
    const campaign = { id: 'campaign-1', name: 'Static-first検証', status: 'active', origins: [], iterations: [{ id: 'iteration-1', iterationNumber: 1, status: 'draft', appealHypothesis: '訴求', hookText: 'Hook', contentOutline: { text: '構成' }, product: { productName: '商品', productUrl: 'https://example.com/product', assets: [{ id: 'asset-1', label: '正面', assetUrl: 'https://example.com/asset.jpg', assetKind: 'hero', usagePermission: 'owned' }] }, publication: null, productionPlans: [{ requestId: 'request-1', planId: 'plan-1', revisionNumber: 1, status: 'succeeded', schemaVersion: 'creative-production-plan-v2', output, videoGenerations: [] }] }] }
    const state = { config: { configured: true, missing: [], creativeProduction: { configured: true }, videoGeneration: { configured: true, requestedModel: 'pollo-v2', resolution: '480p' } }, queries: [], opportunities: [], trackingOpportunities: [], analyses: [], commerceTranslations: [], productSearches: [], campaigns: [campaign], latestJob: null }
    const markup = renderToStaticMarkup(<RevenueLabView state={state} {...handlers} />)
    expect(markup).toContain('Creative Production Plan v2')
    expect(markup).toContain('v2 Static-first')
    expect(markup).toContain('静止商品素材')
    expect(markup).toContain('商品画像モーション')
    expect(markup).toContain('商品形状維持I2V')
    expect(markup).toContain('スタイライズ演出')
    expect((markup.match(/Pollo映像素材/g) || [])).toHaveLength(1)
  })
})
