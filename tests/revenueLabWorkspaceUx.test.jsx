import React from 'react'
// spec_ref: docs/specs/revenue-lab-workspace-ux.md
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RevenueLabView, buildThreePicksCandidatePool, canCreateThreePicks, groupRegisteredProducts } from '../src/components/RevenueLabDashboard'
import { deriveAttentionItems } from '../src/components/revenueLabWorkspace'

const noop = vi.fn()
const handlers = Object.fromEntries(['onReload','onRun','onTrack','onAnalyze','onReview','onTranslate','onEnrich','onTranslationFeedback','onProductSearch','onProductDecision','onCreateCampaign','onCreateDirectProduct','onCreateThreePicks','onGenerateThreePicks','onGenerateThreePicksV2','onGenerateAudio','onGenerateAudioArtifact','onCompose','onComposeV2','onPreview','onGenerateProduction','onGenerateVideo','onCreateAssetRevision','onGenerateImageVideo','onRegisterPublication','onUpdateIteration','onCreateIteration','onDeleteCampaign','onVoidCampaign','onConnectAnalytics','onCollectAnalytics','onSave'].map(name => [name, noop]))
const config = { configured: true, missing: [], analysis: { configured: false }, products: { configured: false }, multiProductShorts: { configured: true }, multiProductShortsV2: { configured: true }, textToSpeech: { configured: true }, finalComposition: { configured: true }, finalCompositionV2: { configured: true }, productAssetRevisions: { configured: true }, creativeProduction: { configured: false }, videoGeneration: { configured: false }, imageToVideo: { configured: false }, youtubeAnalytics: { configured: false } }
const artifact = (sceneId, durationSeconds = 2) => ({ id: `${sceneId}-audio`, segmentId: `${sceneId}-1`, sceneId, status: 'ready', durationSeconds, creativeArchetypePlanId: 'plan-new' })
const plan = (revisionNumber, overrides = {}) => ({ planId: revisionNumber === 2 ? 'plan-new' : 'plan-old', requestId: `request-${revisionNumber}`, revisionNumber, status: 'succeeded', promptVersion: `prompt-${revisionNumber}`, schemaVersion: `schema-${revisionNumber}`, generatedAt: `2026-10-19T0${revisionNumber}:00:00Z`, audioArtifacts: [], compositions: [], output: { hook: { display_text: `Hook ${revisionNumber}` }, product_presentations: [], cta: { display_text: 'CTA' } }, ...overrides })
const active = (overrides = {}) => ({ id: 'campaign-active', name: 'Current Campaign', status: 'active', createdAt: '2026-10-19T00:00:00Z', iterations: [{ id: 'iteration-1', iterationNumber: 1, status: 'draft', registrationOnly: true, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [plan(1), plan(2)] }], ...overrides })
const state = campaigns => ({ config, queries: [], opportunities: [], trackingOpportunities: [], analyses: [], commerceTranslations: [], productSearches: [], campaigns, youtubeAnalyticsConnection: null, youtubeAnalyticsFlow: { status: 'idle' }, latestJob: null, latestRun: null })
const fullMarkup = (campaigns, initialArea = 'today') => renderToStaticMarkup(<RevenueLabView state={state(campaigns)} requestedCampaignId="campaign-active" initialArea={initialArea} {...handlers} />)
const workspaceMarkup = (campaigns, initialArea = 'today') => fullMarkup(campaigns, initialArea).split('<aside class="revenue-audit-drawer"')[0]

describe('Revenue Lab Workspace UX v2', () => {
  it('groups repeated registered records by canonical product lineage and keeps related records', () => {
    const campaigns = [1, 2, 3].map(index => active({
      id: `campaign-${index}`,
      iterations: [{ id: `iteration-${index}`, productSet: { archetype: 'three_picks_v2', items: [{
        id: `set-item-${index}`, productName: '車載ダストボックス',
        product: { id: 'product-bin', productName: '車載ダストボックス', merchant: index === 3 ? 'Example Shop' : null, productUrl: index === 3 ? 'https://example.com/bin' : null },
        assetRevisions: index === 3 ? [{ id: 'revision-1' }] : [], verifiedFact: index === 3 ? { summary: 'LED点灯確認済み' } : null,
      }] } }],
    }))
    const [group] = groupRegisteredProducts(campaigns)
    expect(group).toMatchObject({ id: 'product-bin', name: '車載ダストボックス', merchant: 'Example Shop', url: 'https://example.com/bin', relatedRecordCount: 3 })
    expect(group.records.map(record => record.recordId)).toEqual(['set-item-1', 'set-item-2', 'set-item-3'])
    const html = workspaceMarkup(campaigns, 'products')
    expect(html).toContain('関連レコード 3件')
    expect(html).toContain('<summary>詳細を見る</summary>')
    for (const id of ['set-item-1', 'set-item-2', 'set-item-3']) expect(html).toContain(id)
  })

  it('does not merge different products that only share a normalized title', () => {
    const campaigns = ['Shop A', 'Shop B'].map((merchant, index) => active({
      id: `same-title-${index}`,
      iterations: [{ id: `same-title-iteration-${index}`, product: { id: null, productName: '卓上 ライト', merchant } }],
    }))
    expect(groupRegisteredProducts(campaigns)).toHaveLength(2)
  })

  it('keeps Three Picks selection based on the original curated product identities', () => {
    const campaigns = [1, 2, 3].map(index => active({ id: `selection-${index}`, iterations: [{ id: `selection-iteration-${index}`, product: {
      id: `product-${index}`, productName: `商品${index}`, merchant: 'Shop', productUrl: `https://example.com/product-${index}`,
      verifiedFacts: { summary: `事実${index}` }, assets: [{ id: `asset-${index}`, usagePermission: 'owned', revisions: [{ id: `revision-${index}`, availabilityStatus: 'available', permissionSnapshot: 'owned' }] }],
    } }] }))
    const grouped = groupRegisteredProducts(campaigns)
    const pool = buildThreePicksCandidatePool(campaigns)
    expect(grouped.map(group => group.id)).toEqual(['product-1', 'product-2', 'product-3'])
    expect(pool.map(candidate => candidate.product.id)).toEqual(['product-1', 'product-2', 'product-3'])
    expect(canCreateThreePicks(['product-1', 'product-2', 'product-3'], pool)).toBe(true)
  })

  it('defaults to a human-work inbox and excludes legacy, single-product, and automatic-only campaigns', () => {
    const output = {
      hook: { display_text: 'Hook', tts: 'Hook narration' }, product_presentations: [], cta: { display_text: 'CTA', tts: 'CTA narration' },
      soft_copy_fields: [
        { field: 'hook', generation_mode: 'canonical_fallback', review_status: 'pending' },
        { field: 'cta', generation_mode: 'ai_repaired', review_status: 'pending' },
      ],
    }
    const v2 = active({ name: 'おすすめ3選 Shorts v2', iterations: [{ id: 'iteration-v2', iterationNumber: 1, status: 'draft', productSet: { archetype: 'three_picks_v2', items: [{ id: 'pick-1', productName: '商品1' }] }, archetypePlans: [plan(2, { output })] }] })
    const legacy = active({ id: 'legacy', name: '車内をスッキリ〜', iterations: [{ id: 'legacy-i', product: { productName: '単品' }, archetypePlans: [] }] })
    const automatic = active({ id: 'automatic', name: '自動処理中', iterations: [{ id: 'automatic-i', productSet: { archetype: 'three_picks_v2', items: [{ id: 'pick-auto', productUrl: 'https://example.com' }] }, archetypePlans: [plan(2, { status: 'queued', output: null })] }] })
    const items = deriveAttentionItems(state([v2, legacy, automatic]))
    expect(items.map(item => item.kind)).toEqual(['script-review', 'product-link'])
    expect(items[0].detail).toContain('安全文 1件')
    expect(items[0].detail).toContain('自動修正 1件')
    const html = workspaceMarkup([v2, legacy, automatic])
    const visible = html.split('<section hidden=""')[0]
    expect(visible).toContain('aria-label="Revenue Lab 通常運用"')
    for (const label of ['今日やること', '商品', '制作', '公開・分析']) expect(visible).toContain(label)
    expect(visible).toContain('原稿確認')
    expect(visible).toContain('おすすめ3選 Shorts v2')
    expect(visible).toContain('商品リンク未登録')
    expect(visible).not.toContain('車内をスッキリ〜')
    expect(visible).not.toContain('自動処理中')
    expect(visible).not.toContain('Revision 2')
    expect(visible).not.toContain('request-2')
    expect(visible).not.toContain('schema-2')
  })

  it('keeps manual product registration collapsed until the operator opens it', () => {
    const html = workspaceMarkup([active()], 'products')
    expect(html).toContain('<summary>＋ 商品を手動登録</summary>')
    expect(html).not.toContain('<details open=""><summary>＋ 商品を手動登録</summary>')
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

  it('turns publication readiness into actions and defers the registration form until Video ID entry', () => {
    const audio = ['hook', 'product-1', 'product-2', 'product-3', 'cta'].map(id => artifact(id))
    const composition = { id: 'composition-1', status: 'succeeded', output: { id: 'output-1', pixelWidth: 1080, pixelHeight: 1920, durationSeconds: 39 } }
    const campaign = active({ iterations: [{ id: 'iteration-1', iterationNumber: 1, registrationOnly: false, productSet: { archetype: 'three_picks_v2', items: [{ id: 'pick-1', productUrl: 'https://example.com/product' }] }, archetypePlans: [plan(2, { audioArtifacts: audio, compositions: [composition] })] }] })
    const html = workspaceMarkup([campaign], 'publication')
    for (const label of ['動画完成', '原稿確認が必要', '原稿を確認', '商品リンク登録済み', 'YouTube未投稿', '投稿内容を確認']) expect(html).toContain(label)
    expect(html).toContain('YouTube投稿済み・Video IDを入力')
    expect(html).not.toContain('Publicationを登録')
    expect(html).toContain('公開タイトル')
    expect(html).toContain('概要欄')
    expect(html).toContain('Amazonアソシエイト開示文')
  })

  it('keeps technical revision metadata out of the normal Production surface', () => {
    const html = workspaceMarkup([active()], 'production')
    expect(html).toContain('原稿')
    expect(html).toContain('音声')
    expect(html).toContain('動画')
    expect(html).not.toContain('Creative Revision 2')
    expect(html).not.toContain('制作進捗')
    expect(html).not.toContain('Campaign<select')
    expect(html).not.toContain('過去Revision')
    expect(html).not.toContain('prompt-1')
  })

  it('centers Production on completed artifacts and routes a completed video to publication', () => {
    const audio = ['hook', 'product-1', 'product-2', 'product-3', 'cta'].map(id => artifact(id))
    const composition = { id: 'composition-1', status: 'succeeded', output: { id: 'output-1', durationSeconds: 39 } }
    const campaign = active({ iterations: [{ id: 'iteration-1', iterationNumber: 1, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [plan(2, { audioArtifacts: audio, compositions: [composition] })] }] })
    const html = workspaceMarkup([campaign], 'production')
    expect(html).toContain('✓ 音声完成')
    expect(html).toContain('✓ 動画完成')
    expect(html).toContain('39秒')
    expect(html).toContain('Previewを開く')
    expect(html).toContain('公開準備へ進む')
    expect(html).not.toContain('segmentId')
    expect(html).not.toContain('Composition timing preflight')
  })

  it('keeps v1 out of the normal Production surface', () => {
    const legacy = active({ iterations: [{ id: 'legacy-i', iterationNumber: 1, productSet: { archetype: 'three_picks_v1', items: [] }, archetypePlans: [plan(1)] }] })
    const html = workspaceMarkup([legacy], 'production')
    expect(html).toContain('制作対象がありません')
    expect(html).not.toContain('Legacy・読取専用')
    expect(html).not.toContain('制作案を生成</button>')
    expect(html).not.toContain('Shorts MP4を生成</button>')
  })

  it('opens Settings and Audit from the header instead of a permanent bottom section', () => {
    const html = fullMarkup([active(), active({ id: 'voided-id', name: 'Voided Campaign', status: 'voided' })], 'production')
    expect(html).toContain('<button type="button" aria-expanded="false">設定・監査</button>')
    expect(html).toContain('<aside class="revenue-audit-drawer" hidden=""')
    expect(html).not.toContain('<details class="revenue-advanced-tools"')
  })

  it('AC-11 disables MP4 generation and displays the timing overflow reason beside it', () => {
    const audio = ['product-1', 'product-2', 'product-3', 'cta'].map(id => artifact(id)); audio.unshift(artifact('hook', 6.2))
    const campaign = active({ iterations: [{ id: 'iteration-1', iterationNumber: 1, registrationOnly: true, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [plan(2, { audioArtifacts: audio })] }] })
    const html = workspaceMarkup([campaign], 'production')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Shorts MP4を生成<\/button>/)
    expect(html).toContain('Hook 6.20s / max 5.00s — ナレーションが長すぎます')
  })
})
