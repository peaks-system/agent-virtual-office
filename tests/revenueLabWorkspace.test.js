import { describe, expect, it, vi } from 'vitest'
// spec_ref: docs/specs/revenue-lab-workspace-ux.md
import {
  buildWorkspaceUrl, campaignFromLocation, createLatestRequestSequence, departmentFromLocation, deriveWorkspace,
  installRevenueRefreshLifecycle, installWorkspacePopstate, selectActiveCampaign, shouldPollRevenueLab,
} from '../src/components/revenueLabWorkspace'

const readyAudio = (sceneId, durationSeconds = 2) => ({ id: `${sceneId}-audio`, sceneId, status: 'ready', durationSeconds, creativeArchetypePlanId: 'plan-2' })
const revision = (overrides = {}) => ({ planId: 'plan-2', revisionNumber: 2, generatedAt: '2026-10-19T02:00:00Z', status: 'succeeded', audioArtifacts: [], compositions: [], ...overrides })
const campaign = (overrides = {}) => ({ id: 'campaign-2', name: 'Latest', status: 'active', createdAt: '2026-10-19T00:00:00Z', iterations: [{ id: 'iteration-2', iterationNumber: 2, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [] }], ...overrides })

describe('Revenue Lab route state', () => {
  it('AC-1/AC-4 restores Revenue Lab and the campaign from the canonical URL on initial mount or F5', () => {
    const location = { pathname: '/revenue-lab', search: '?lang=ja&campaign=campaign-2' }
    expect(departmentFromLocation(location)).toBe('revenue')
    expect(campaignFromLocation(location)).toBe('campaign-2')
  })

  it('AC-2 preserves lang and unrelated parameters when entering and leaving Revenue Lab', () => {
    expect(buildWorkspaceUrl({ pathname: '/', search: '?lang=ja&mode=compact' }, 'revenue', 'campaign-2')).toBe('/revenue-lab?lang=ja&mode=compact&campaign=campaign-2')
    expect(buildWorkspaceUrl({ pathname: '/revenue-lab', search: '?lang=ja&campaign=campaign-2&mode=compact' }, 'office')).toBe('/?lang=ja&mode=compact')
  })

  it('AC-3 maps back and forward locations directly to their workspace', () => {
    const listeners = {}; const changes = []
    const windowRef = { location: { pathname: '/', search: '?lang=ja' }, addEventListener: (name, fn) => { listeners[name] = fn }, removeEventListener: vi.fn() }
    const dispose = installWorkspacePopstate(windowRef, route => changes.push(route))
    listeners.popstate()
    windowRef.location = { pathname: '/revenue-lab', search: '?lang=ja&campaign=campaign-2' }; listeners.popstate()
    expect(changes).toEqual([{ department: 'office', campaignId: null }, { department: 'revenue', campaignId: 'campaign-2' }])
    dispose(); expect(windowRef.removeEventListener).toHaveBeenCalledWith('popstate', listeners.popstate)
  })
})

describe('Revenue Lab workspace derivation', () => {
  it('maps a safe provider schema failure to user copy and keeps technical fields in audit data', () => {
    const failed = revision({ revisionNumber: 12, status: 'failed', planId: null, output: null,
      safeErrorCode: 'OPENAI_HTTP_ERROR' })
    const model = deriveWorkspace({ campaigns: [campaign({ iterations: [{ id: 'iteration-2', iterationNumber: 2,
      productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [failed] }] })],
    latestJob: { jobType: 'creative.archetype.plan', status: 'failed', errorCode: 'OPENAI_HTTP_ERROR',
      errorMessage: 'Three Picks planning failed: provider; http_status=400; provider_error_code=invalid_json_schema; provider_error_type=invalid_request_error; reason=response schema contains an unsupported keyword' } })
    expect(model.planFeedback).toEqual({ kind: 'error', message: '制作案の生成に失敗しました',
      detail: 'AI生成設定の形式に問題があります。', audit: { httpStatus: 400,
        providerErrorCode: 'invalid_json_schema', providerErrorType: 'invalid_request_error',
        reason: 'response schema contains an unsupported keyword' } })
  })

  it('AC-5/AC-6 selects an explicit active Campaign and deterministically falls back from invalid or voided IDs', () => {
    const older = campaign({ id: 'a', name: 'Older', createdAt: '2026-10-18T00:00:00Z' })
    const newerById = campaign({ id: 'z', name: 'Newest stable', createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T01:00:00Z' })
    const sameTime = campaign({ id: 'b', name: 'Same time', createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' })
    const voided = campaign({ id: 'void', status: 'voided', createdAt: '2026-10-20T00:00:00Z' })
    const campaigns = [older, voided, sameTime, newerById]
    expect(selectActiveCampaign(campaigns, 'a').campaign.id).toBe('a')
    expect(selectActiveCampaign(campaigns, 'missing')).toMatchObject({ campaign: { id: 'z' }, normalized: true })
    expect(selectActiveCampaign(campaigns, 'void')).toMatchObject({ campaign: { id: 'z' }, normalized: true })
    expect(selectActiveCampaign([...campaigns].reverse(), null).campaign.id).toBe('z')
  })

  it('AC-8/AC-9 derives the five steps and primary action from the latest v2 Revision only', () => {
    const planned = campaign({ iterations: [{ id: 'i', iterationNumber: 1, productSet: { archetype: 'three_picks_v2', items: [{ id: 'p' }] }, archetypePlans: [revision({ revisionNumber: 1 }), revision()] }] })
    const model = deriveWorkspace({ campaigns: [planned] }, planned.id)
    expect(model.latestRevision.revisionNumber).toBe(2)
    expect(model.steps.map(step => step.label)).toEqual(['商品', '制作案', '音声', '動画', '公開・分析'])
    expect(model.primaryAction).toMatchObject({ id: 'generate-audio', label: 'この原稿で音声を生成' })

    const audio = ['hook', 'product-1', 'product-2', 'product-3', 'cta'].map(id => readyAudio(id))
    const composable = deriveWorkspace({ campaigns: [campaign({ iterations: [{ id: 'i', iterationNumber: 1, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [revision({ audioArtifacts: audio })] }] })] })
    expect(composable.primaryAction.id).toBe('compose')
  })

  it('AC-10 transitions the primary action from plan through preview and analytics', () => {
    const productSet = { archetype: 'three_picks_v2', items: [] }
    expect(deriveWorkspace({ campaigns: [campaign({ iterations: [{ id: 'i', iterationNumber: 1, productSet, archetypePlans: [] }] })] }).primaryAction.id).toBe('generate-plan')
    const audio = ['hook', 'product-1', 'product-2', 'product-3', 'cta'].map(id => readyAudio(id))
    const completeRevision = revision({ audioArtifacts: audio, compositions: [{ id: 'composition-1', status: 'succeeded', output: { id: 'output-1' } }] })
    const completed = campaign({ iterations: [{ id: 'i', iterationNumber: 1, productSet, archetypePlans: [completeRevision] }] })
    expect(deriveWorkspace({ campaigns: [completed] }).primaryAction).toMatchObject({ id: 'preview', outputId: 'output-1' })
    completed.iterations[0].publication = { id: 'publication-1', publishedAt: '2026-10-18T00:00:00Z' }
    expect(deriveWorkspace({ campaigns: [completed] }).primaryAction.id).toBe('analytics')
    completed.iterations[0].publication.latestPerformance = { views: 10 }
    expect(deriveWorkspace({ campaigns: [completed] }).primaryAction.id).toBe('complete')
  })

  it('distinguishes queued, succeeded, and failed plan generation from hydrated revision state', () => {
    const productSet = { archetype: 'three_picks_v2', items: [] }
    const withRevision = latest => ({ campaigns: [campaign({ iterations: [{ id: 'i', iterationNumber: 1, productSet, archetypePlans: [latest] }] })] })
    expect(deriveWorkspace(withRevision(revision({ revisionNumber: 9, status: 'queued', planId: null })))).toMatchObject({
      planFeedback: { kind: 'pending', message: 'Revision 9の制作案を生成中' },
    })
    expect(deriveWorkspace(withRevision(revision({ revisionNumber: 9, status: 'succeeded', output: {} })))).toMatchObject({
      planFeedback: { kind: 'success', message: '✓ Revision 9の制作案を生成しました' },
    })
    expect(deriveWorkspace({ ...withRevision(revision({ revisionNumber: 9, status: 'failed', planId: null,
      safeErrorCode: 'THREE_PICKS_V2_UNGROUNDED_CLAIM' })), latestJob: { jobType: 'creative.archetype.plan', status: 'failed',
      errorCode: 'THREE_PICKS_V2_UNGROUNDED_CLAIM',
      errorMessage: 'Three Picks planning failed: product 3; $.product_presentations[2].short_appeal; claim is not supported by selected evidence candidates; field_value_preview=水なしUSB式で手軽に香る; evidence_candidate_ids=summary-1' } })).toMatchObject({
      planFeedback: { kind: 'error', message: '制作案の生成に失敗しました',
        detail: 'PICK 3のshort_appealが選択した根拠データで確認できませんでした。' },
      primaryAction: { id: 'generate-plan' },
    })
  })

  it('AC-11 disables composition and exposes the local reason when Hook timing overflows', () => {
    const audio = ['product-1', 'product-2', 'product-3', 'cta'].map(id => readyAudio(id))
    audio.unshift(readyAudio('hook', 6.2))
    const model = deriveWorkspace({ campaigns: [campaign({ iterations: [{ id: 'i', iterationNumber: 1, productSet: { archetype: 'three_picks_v2', items: [] }, archetypePlans: [revision({ audioArtifacts: audio })] }] })] })
    expect(model.primaryAction).toMatchObject({ id: 'compose', disabled: true })
    expect(model.primaryAction.reason).toContain('Hook 6.20s / max 5.00s')
  })

  it('AC-12/AC-13 keeps v1 read-only and separates non-active Campaigns into Archive', () => {
    const legacy = campaign({ id: 'legacy', iterations: [{ id: 'i', iterationNumber: 1, productSet: { archetype: 'three_picks_v1' }, archetypePlans: [revision()] }] })
    const voided = campaign({ id: 'voided', status: 'voided' })
    const model = deriveWorkspace({ campaigns: [voided, legacy] }, 'legacy')
    expect(model.legacy).toBe(true)
    expect(model.primaryAction.id).toBe('legacy-read-only')
    expect(model.archive.map(item => item.id)).toEqual(['voided'])
  })
})

describe('Revenue Lab refresh lifecycle', () => {
  it('keeps only the latest overlapping refresh eligible to update state', () => {
    const sequence = createLatestRequestSequence()
    const slow = sequence.begin(); const fast = sequence.begin()
    expect(sequence.isLatest(slow)).toBe(false)
    expect(sequence.isLatest(fast)).toBe(true)
  })

  it('AC-15 polls only during transient work, pauses while hidden, and refreshes once on focus', () => {
    expect(shouldPollRevenueLab({ latestJob: { status: 'running' } })).toBe(true)
    expect(shouldPollRevenueLab({ latestJob: { status: 'succeeded' }, campaigns: [] })).toBe(false)
    const listeners = {}; const documentListeners = {}; const refresh = vi.fn(); let tick
    const windowRef = { addEventListener: (name, fn) => { listeners[name] = fn }, removeEventListener: vi.fn() }
    const documentRef = { hidden: false, addEventListener: (name, fn) => { documentListeners[name] = fn }, removeEventListener: vi.fn() }
    const clearIntervalFn = vi.fn()
    const dispose = installRevenueRefreshLifecycle({ windowRef, documentRef, refresh, shouldPoll: () => true, setIntervalFn: fn => { tick = fn; return 7 }, clearIntervalFn })
    tick(); expect(refresh).toHaveBeenCalledTimes(1)
    documentRef.hidden = true; documentListeners.visibilitychange(); expect(clearIntervalFn).toHaveBeenCalledWith(7)
    documentRef.hidden = false; documentListeners.visibilitychange(); expect(refresh).toHaveBeenCalledTimes(2)
    listeners.focus(); expect(refresh).toHaveBeenCalledTimes(2)
    dispose()
  })
})

describe('Revenue Lab workspace edge cases', () => {
  it('normalizes a trailing slash when restoring the Revenue Lab route', () => {
    expect(departmentFromLocation({ pathname: '/revenue-lab/' })).toBe('revenue')
  })

  it('preserves lang when Revenue Lab has no selected Campaign yet', () => {
    expect(buildWorkspaceUrl({ pathname: '/', search: '?lang=ja' }, 'revenue')).toBe('/revenue-lab?lang=ja')
  })

  it('uses the stable Campaign ID as the final deterministic tie-breaker', () => {
    const left = campaign({ id: 'a', createdAt: '2026-10-19T00:00:00Z' })
    const right = campaign({ id: 'z', createdAt: '2026-10-19T00:00:00Z' })
    expect(selectActiveCampaign([left, right]).campaign.id).toBe('z')
  })

  it('returns no normal selection when every Campaign is archived', () => {
    const archived = campaign({ id: 'voided', status: 'voided' })
    expect(selectActiveCampaign([archived])).toMatchObject({ campaign: null, active: [], archive: [archived] })
  })

  it('polls while an audio artifact is queued even when the latest job is idle', () => {
    const queued = revision({ audioArtifacts: [{ ...readyAudio('hook'), status: 'queued' }] })
    expect(shouldPollRevenueLab({ campaigns: [campaign({ iterations: [{ id: 'i', iterationNumber: 1, archetypePlans: [queued] }] })] })).toBe(true)
  })

  it('removes focus and visibility listeners when refresh lifecycle is disposed', () => {
    const windowRef = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const documentRef = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    const dispose = installRevenueRefreshLifecycle({ windowRef, documentRef, refresh: vi.fn(), shouldPoll: () => false })
    dispose()
    expect(windowRef.removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function))
    expect(documentRef.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})
