import { describe, expect, it, vi } from 'vitest'
import { createJobHandlers } from '../scripts/revenue-lab/job-handlers.cjs'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

describe('Creative Archetype v2 worker routing', () => {
  it('routes v2 planning to the isolated client and persistence path', async () => {
    const request = { id: uuid(1), archetype: 'three_picks_v2', revisionNumber: 1, inputSnapshot: { products: [] } }
    const result = { productionPlan: { archetype: 'three_picks_v2' }, usage: {} }
    const store = { getThreePicksRequest: vi.fn(async () => request), markThreePicksRunning: vi.fn(),
      persistThreePicksV2Success: vi.fn(async () => ({ planId: uuid(2) })), persistThreePicksFailure: vi.fn() }
    const v1 = { plan: vi.fn() }; const v2 = { plan: vi.fn(async () => result) }
    const handler = createJobHandlers({ store, youtube: {}, multiProductShortsPlanner: v1,
      multiProductShortsV2Planner: v2 }).get('creative.archetype.plan')
    await expect(handler({ payload: { creative_archetype_request_id: request.id } })).resolves.toMatchObject({ planId: uuid(2) })
    expect(v1.plan).not.toHaveBeenCalled()
    expect(v2.plan).toHaveBeenCalledWith(request.inputSnapshot)
    expect(store.persistThreePicksV2Success).toHaveBeenCalledWith(request, result)
  })

  it('preserves allowlisted schema-v5 lineage diagnostics for future bounded repair', async () => {
    const request = { id: uuid(1), archetype: 'three_picks_v2', revisionNumber: 14,
      inputSnapshot: { contract: { schema_version: 'multi-product-shorts-plan-v5' }, products: [] } }
    const failure = Object.assign(new Error('unknown fact'), {
      code: 'THREE_PICKS_V2_FACT_UNKNOWN',
      safeDiagnostics: { code: 'THREE_PICKS_V2_FACT_UNKNOWN', product_index: 2,
        field_path: '$.product_presentations[1].fact_id',
        reason: 'selected fact ID is not present in typed evidence',
        field_value_preview: 'unknown:fact', evidence_candidate_ids: ['summary-2'] },
    })
    const store = { getThreePicksRequest: vi.fn(async () => request), markThreePicksRunning: vi.fn(),
      persistThreePicksV2Success: vi.fn(), persistThreePicksFailure: vi.fn() }
    const handler = createJobHandlers({ store, youtube: {}, multiProductShortsV2Planner: {
      plan: vi.fn(async () => { throw failure }),
    } }).get('creative.archetype.plan')
    await expect(handler({ payload: { creative_archetype_request_id: request.id } })).rejects.toMatchObject({
      code: 'THREE_PICKS_V2_FACT_UNKNOWN',
      safeDiagnostics: { product_index: 2, field_path: '$.product_presentations[1].fact_id',
        evidence_candidate_ids: ['summary-2'] },
    })
    expect(store.persistThreePicksFailure).toHaveBeenCalledWith(request.id, failure)
  })

  it('routes v2 composition with hash-verified product and segment audio bytes', async () => {
    const productBytes = Buffer.from('product'); const audioBytes = Buffer.from('audio')
    const { createHash } = await import('node:crypto')
    const composition = { id: uuid(1), campaignId: uuid(2), archetype: 'three_picks_v2',
      provider: 'local_ffmpeg', providerVersion: 'local-shorts-composer-v2', renderManifest: {},
      assets: [{ id: uuid(3), immutableObjectKey: 'product-key', contentSha256: createHash('sha256').update(productBytes).digest('hex') }],
      audioAssets: [{ id: uuid(4), immutableObjectKey: 'audio-key', contentSha256: createHash('sha256').update(audioBytes).digest('hex') }] }
    const store = { getFinalCompositionRequest: vi.fn(async () => composition), markFinalCompositionRendering: vi.fn(),
      persistFinalCompositionSuccess: vi.fn(), persistFinalCompositionFailure: vi.fn() }
    const finalCompositionV2Provider = { id: 'local_ffmpeg', version: 'local-shorts-composer-v2',
      render: vi.fn(async ({ assets, audioAssets }) => ({ bytes: Buffer.from('mp4'), durationSeconds: 39,
        pixelWidth: 1080, pixelHeight: 1920, fps: 30, assets, audioAssets })), normalizeError: error => error }
    const compositionBlobStore = { provider: 'supabase-storage', bucket: 'shorts-private', putImmutable: vi.fn() }
    const handler = createJobHandlers({ store, youtube: {}, finalCompositionV2Provider, compositionBlobStore,
      productAssetBlobStore: { readImmutable: vi.fn(async () => productBytes) },
      creativeAudioBlobStore: { readImmutable: vi.fn(async () => audioBytes) } }).get('creative.compose.final')
    await expect(handler({ payload: { final_composition_request_id: composition.id } })).resolves.toMatchObject({ status: 'succeeded' })
    expect(finalCompositionV2Provider.render).toHaveBeenCalledWith(expect.objectContaining({
      assets: expect.any(Map), audioAssets: expect.any(Map),
    }))
    expect(store.persistFinalCompositionSuccess).toHaveBeenCalledOnce()
  })
})
