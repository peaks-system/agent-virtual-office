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
const workspaceMarkup = campaigns => renderToStaticMarkup(<RevenueLabView state={state(campaigns)} requestedCampaignId="campaign-active" {...handlers} />).split('<details class="revenue-advanced-tools"')[0]

describe('Revenue Lab Workspace UX v2', () => {
  it('AC-9/AC-14 shows the latest Revision in normal workspace and puts past Revisions in audit', () => {
    const html = workspaceMarkup([active()])
    expect(html).toContain('Creative Revision 2')
    expect(html).toContain('過去Revision（1件）')
    expect(html).not.toContain('prompt-1')
  })

  it('AC-7/AC-8 renders five-step progress and one state-derived primary CTA', () => {
    const html = workspaceMarkup([active()])
    for (const label of ['商品', '制作案', '音声', '動画', '公開・分析']) expect(html).toContain(label)
    expect(html.match(/<button[^>]*>ナレーションを生成<\/button>/g)).toHaveLength(1)
  })

  it('AC-12 keeps v1 in Legacy read-only without production CTAs', () => {
    const legacy = active({ iterations: [{ id: 'legacy-i', iterationNumber: 1, productSet: { archetype: 'three_picks_v1', items: [] }, archetypePlans: [plan(1)] }] })
    const html = workspaceMarkup([legacy])
    expect(html).toContain('Legacy・読取専用')
    expect(html).not.toContain('制作案を生成</button>')
    expect(html).not.toContain('Shorts MP4を生成</button>')
  })

  it('AC-13 excludes voided Campaigns from the selector and exposes them only in Archive', () => {
    const html = workspaceMarkup([active(), active({ id: 'voided-id', name: 'Voided Campaign', status: 'voided' })])
    expect(html).toContain('Archive（1件）')
    expect(html).toContain('Voided Campaign')
    expect(html).not.toContain('value="voided-id"')
  })

  it('AC-11 disables MP4 generation and displays the timing overflow reason beside it', () => {
    const audio = ['product-1', 'product-2', 'product-3', 'cta'].map(id => artifact(id)); audio.unshift(artifact('hook', 6.2))
    const campaign = active({ iterations: [{ id: 'iteration-1', iterationNumber: 1, registrationOnly: true, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [plan(2, { audioArtifacts: audio })] }] })
    const html = workspaceMarkup([campaign])
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Shorts MP4を生成<\/button>/)
    expect(html).toContain('Hook 6.20s / max 5.00s — ナレーションが長すぎます')
  })
})
