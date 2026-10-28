import React from 'react'
// spec_ref: docs/specs/revenue-lab-workspace-ux.md
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RevenueLabView } from '../src/components/RevenueLabDashboard'

const noop = vi.fn()
const handlers = Object.fromEntries(['onReload','onRun','onTrack','onAnalyze','onReview','onTranslate','onEnrich','onTranslationFeedback','onProductSearch','onProductDecision','onCreateCampaign','onCreateDirectProduct','onCreateThreePicks','onGenerateThreePicks','onGenerateThreePicksV2','onGenerateAudio','onGenerateAudioArtifact','onCompose','onComposeV2','onPreview','onGenerateProduction','onGenerateVideo','onCreateAssetRevision','onGenerateImageVideo','onRegisterPublication','onUpdateIteration','onCreateIteration','onDeleteCampaign','onVoidCampaign','onConnectAnalytics','onCollectAnalytics','onSave'].map(name => [name, noop]))
const config = { configured: true, missing: [], analysis: { configured: false }, products: { configured: false }, multiProductShorts: { configured: true }, multiProductShortsV2: { configured: true }, textToSpeech: { configured: true }, finalComposition: { configured: true }, finalCompositionV2: { configured: true }, productAssetRevisions: { configured: true }, creativeProduction: { configured: false }, videoGeneration: { configured: false }, imageToVideo: { configured: false }, youtubeAnalytics: { configured: false } }
const artifact = (sceneId, durationSeconds = 2) => ({ id: `${sceneId}-audio`, segmentId: `${sceneId}-1`, sceneId, status: 'ready', durationSeconds, creativeArchetypePlanId: 'plan-new' })
const plan = (revisionNumber, overrides = {}) => ({ planId: revisionNumber === 2 ? 'plan-new' : 'plan-old', requestId: `request-${revisionNumber}`, revisionNumber, status: 'succeeded', promptVersion: `prompt-${revisionNumber}`, schemaVersion: `schema-${revisionNumber}`, generatedAt: `2026-10-19T0${revisionNumber}:00:00Z`, audioArtifacts: [], compositions: [], output: { hook: { display_text: `Hook ${revisionNumber}` }, product_presentations: [], cta: { display_text: 'CTA' } }, ...overrides })
const active = (overrides = {}) => ({ id: 'campaign-active', name: 'Current Campaign', status: 'active', createdAt: '2026-10-19T00:00:00Z', iterations: [{ id: 'iteration-1', iterationNumber: 1, status: 'draft', registrationOnly: true, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [plan(1), plan(2)] }], ...overrides })
const state = campaigns => ({ config, queries: [], opportunities: [], trackingOpportunities: [], analyses: [], commerceTranslations: [], productSearches: [], campaigns, youtubeAnalyticsConnection: null, youtubeAnalyticsFlow: { status: 'idle' }, latestJob: null, latestRun: null })
const workspaceMarkup = (campaigns, initialArea = 'today') => renderToStaticMarkup(<RevenueLabView state={state(campaigns)} requestedCampaignId="campaign-active" initialArea={initialArea} {...handlers} />).split('<details class="revenue-advanced-tools"')[0]

describe('Revenue Lab Workspace UX v2', () => {
  it('AC-1/AC-2 defaults to a human-attention queue with four normal operations areas', () => {
    const html = workspaceMarkup([active()])
    const visible = html.split('<section hidden=""')[0]
    expect(visible).toContain('aria-label="Revenue Lab 通常運用"')
    for (const label of ['今日やること', '商品', '制作', '公開・分析']) expect(visible).toContain(label)
    expect(visible).toContain('原稿確認')
    expect(visible).toContain('Current Campaign')
    expect(visible).toContain('Revision 2')
    expect(visible).not.toContain('request-2')
    expect(visible).not.toContain('schema-2')
  })

  it('AC-5/AC-6 renders copy origin and review as independent badges in Production', () => {
    const output = {
      hook: { display_text: 'Hook', tts: 'Hook narration' },
      product_presentations: [{ product_set_item_id: 'pick-1', presentation_order: 1, display_name: 'LED商品', short_appeal: '開けるとLEDが点灯', fact_badge: 'LED搭載', tts: '蓋を開けるとライトが点きます' }],
      cta: { display_text: 'CTA', tts: '詳細はこちら' },
      soft_copy_fields: [
        { field: 'hook', generation_mode: 'manual_edited', review_status: 'confirmed' },
        { field: 'products[0].short_appeal', generation_mode: 'ai_repaired', review_status: 'pending' },
        { field: 'products[0].tts', generation_mode: 'ai_generated', review_status: 'confirmed' },
        { field: 'cta', generation_mode: 'canonical_fallback', review_status: 'pending' },
      ],
    }
    const campaign = active({ iterations: [{ id: 'iteration-1', iterationNumber: 1, registrationOnly: true, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [plan(2, { output })] }] })
    const html = workspaceMarkup([campaign], 'production')
    for (const label of ['AI生成', '自動修正', '安全文', '手動修正', '未確認', '確認済み']) expect(html).toContain(label)
    expect(html).toContain('revenue-script-copy')
  })

  it('AC-7/AC-8 groups publication readiness and registration in Publish & Analytics', () => {
    const audio = ['hook', 'product-1', 'product-2', 'product-3', 'cta'].map(id => artifact(id))
    const composition = { id: 'composition-1', status: 'succeeded', output: { id: 'output-1', pixelWidth: 1080, pixelHeight: 1920, durationSeconds: 39 } }
    const campaign = active({ iterations: [{ id: 'iteration-1', iterationNumber: 1, registrationOnly: false, productSet: { archetype: 'three_picks_v2', items: [{ id: 'pick-1', productUrl: 'https://example.com/product' }] }, archetypePlans: [plan(2, { audioArtifacts: audio, compositions: [composition] })] }] })
    const html = workspaceMarkup([campaign], 'publication')
    for (const label of ['動画完成', '原稿確認', '商品リンク', 'YouTube未投稿', 'Publication登録']) expect(html).toContain(label)
  })

  it('AC-9/AC-14 shows the latest Revision in normal workspace and puts past Revisions in audit', () => {
    const html = workspaceMarkup([active()], 'production')
    expect(html).toContain('Creative Revision 2')
    expect(html).toContain('過去Revision（1件）')
    expect(html).not.toContain('prompt-1')
  })

  it('AC-7/AC-8 renders five-step progress and one state-derived primary CTA', () => {
    const html = workspaceMarkup([active()], 'production')
    for (const label of ['商品', '制作案', '音声', '動画', '公開・分析']) expect(html).toContain(label)
    expect(html.match(/<button[^>]*>この原稿で音声を生成<\/button>/g)).toHaveLength(1)
  })

  it('AC-12 keeps v1 in Legacy read-only without production CTAs', () => {
    const legacy = active({ iterations: [{ id: 'legacy-i', iterationNumber: 1, productSet: { archetype: 'three_picks_v1', items: [] }, archetypePlans: [plan(1)] }] })
    const html = workspaceMarkup([legacy], 'production')
    expect(html).toContain('Legacy・読取専用')
    expect(html).not.toContain('制作案を生成</button>')
    expect(html).not.toContain('Shorts MP4を生成</button>')
  })

  it('AC-13 excludes voided Campaigns from the selector and exposes them only in Archive', () => {
    const html = workspaceMarkup([active(), active({ id: 'voided-id', name: 'Voided Campaign', status: 'voided' })], 'production')
    expect(html).toContain('Archive（1件）')
    expect(html).toContain('Voided Campaign')
    expect(html).not.toContain('value="voided-id"')
  })

  it('AC-11 disables MP4 generation and displays the timing overflow reason beside it', () => {
    const audio = ['product-1', 'product-2', 'product-3', 'cta'].map(id => artifact(id)); audio.unshift(artifact('hook', 6.2))
    const campaign = active({ iterations: [{ id: 'iteration-1', iterationNumber: 1, registrationOnly: true, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [plan(2, { audioArtifacts: audio })] }] })
    const html = workspaceMarkup([campaign], 'production')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Shorts MP4を生成<\/button>/)
    expect(html).toContain('Hook 6.20s / max 5.00s — ナレーションが長すぎます')
  })
})
