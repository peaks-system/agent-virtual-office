import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createJobHandlers } from '../scripts/revenue-lab/job-handlers.cjs'
import { threePicksCampaignInput } from '../scripts/revenue-api.cjs'

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`

describe('Multi-product Shorts Worker', () => {
  it('persists a valid Three Picks plan without touching legacy creative production', async () => {
    const request = { id: uuid(1), revisionNumber: 1, inputSnapshot: { products: [] } }
    const result = { productionPlan: { archetype: 'three_picks_v1' }, usage: {} }
    const store = { getThreePicksRequest: vi.fn(async () => request), markThreePicksRunning: vi.fn(),
      persistThreePicksSuccess: vi.fn(async () => ({ planId: uuid(2) })), persistThreePicksFailure: vi.fn() }
    const planner = { plan: vi.fn(async () => result) }
    const handler = createJobHandlers({ store, youtube: {}, multiProductShortsPlanner: planner }).get('creative.archetype.plan')
    await expect(handler({ payload: { creative_archetype_request_id: request.id } })).resolves.toMatchObject({ planId: uuid(2) })
    expect(store.persistThreePicksSuccess).toHaveBeenCalledWith(request, result)
  })

  it('propagates sealed schema-v4 identity diagnostics through the failed job', async () => {
    const request = { id: uuid(1), archetype: 'three_picks_v2', revisionNumber: 8, inputSnapshot: { products: [] } }
    const safeDiagnostics = { code: 'THREE_PICKS_V2_IDENTITY_CHANGED', product_index: 2,
      field_path: '$.product_presentations[1].display_name', reason: 'no compatible identity token found' }
    const failure = Object.assign(new Error('Display identity is incompatible'), {
      code: safeDiagnostics.code, safeDiagnostics,
    })
    const store = { getThreePicksRequest: vi.fn(async () => request), markThreePicksRunning: vi.fn(),
      persistThreePicksV2Success: vi.fn(), persistThreePicksFailure: vi.fn() }
    const planner = { plan: vi.fn(async () => { throw failure }) }
    const handler = createJobHandlers({ store, youtube: {}, multiProductShortsV2Planner: planner }).get('creative.archetype.plan')
    await expect(handler({ payload: { creative_archetype_request_id: request.id } })).rejects.toMatchObject({
      code: safeDiagnostics.code,
      message: 'Three Picks planning failed: product 2; $.product_presentations[1].display_name; no compatible identity token found',
      safeDiagnostics,
    })
    expect(store.persistThreePicksFailure).toHaveBeenCalledWith(request.id, failure)
    expect(store.persistThreePicksV2Success).not.toHaveBeenCalled()
  })

  it('propagates sealed schema-v4 grounding diagnostics through the failed job', async () => {
    const request = { id: uuid(1), archetype: 'three_picks_v2', revisionNumber: 9, inputSnapshot: { products: [] } }
    const safeDiagnostics = { code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM', product_index: 3,
      field_path: '$.product_presentations[2].short_appeal', reason: 'claim is not supported by selected evidence candidates',
      field_value_preview: '水なしUSB式で手軽に香る', evidence_candidate_ids: ['summary-1'] }
    const failure = Object.assign(new Error('raw planner output must not be persisted'), {
      code: safeDiagnostics.code, safeDiagnostics,
    })
    const store = { getThreePicksRequest: vi.fn(async () => request), markThreePicksRunning: vi.fn(),
      persistThreePicksV2Success: vi.fn(), persistThreePicksFailure: vi.fn() }
    const planner = { plan: vi.fn(async () => { throw failure }) }
    const handler = createJobHandlers({ store, youtube: {}, multiProductShortsV2Planner: planner }).get('creative.archetype.plan')
    const rejected = await handler({ payload: { creative_archetype_request_id: request.id } }).catch(error => error)
    expect(rejected).toMatchObject({
      code: safeDiagnostics.code,
      safeDiagnostics,
    })
    expect(rejected.message).toContain('field_value_preview=水なしUSB式で手軽に香る')
    expect(rejected.message).toContain('evidence_candidate_ids=summary-1')
    expect(rejected.message).not.toContain(failure.message)
  })

  it('hash-verifies three immutable assets, renders once, and persists an immutable MP4', async () => {
    const bytes = Buffer.from('immutable-product-image')
    const sha = createHash('sha256').update(bytes).digest('hex')
    const composition = { id: uuid(1), campaignId: uuid(2), provider: 'local_ffmpeg',
      providerVersion: 'local-shorts-composer-v1', renderManifest: {},
      assets: [1, 2, 3].map(index => ({ id: uuid(10 + index), immutableObjectKey: `product-assets/${uuid(index)}/${'a'.repeat(64)}.png`, contentSha256: sha })) }
    const rendered = { bytes: Buffer.from('mp4'), durationSeconds: 20, pixelWidth: 1080, pixelHeight: 1920, fps: 30 }
    const store = { getFinalCompositionRequest: vi.fn(async () => composition), markFinalCompositionRendering: vi.fn(),
      persistFinalCompositionSuccess: vi.fn(), persistFinalCompositionFailure: vi.fn() }
    const productAssetBlobStore = { readImmutable: vi.fn(async () => bytes) }
    const finalCompositionProvider = { id: 'local_ffmpeg', version: 'local-shorts-composer-v1',
      render: vi.fn(async () => rendered), normalizeError: error => error }
    const compositionBlobStore = { provider: 'supabase-storage', bucket: 'shorts-private', putImmutable: vi.fn() }
    const handler = createJobHandlers({ store, youtube: {}, finalCompositionProvider,
      compositionBlobStore, productAssetBlobStore }).get('creative.compose.final')
    await expect(handler({ payload: { final_composition_request_id: composition.id } })).resolves.toMatchObject({ status: 'succeeded' })
    expect(productAssetBlobStore.readImmutable).toHaveBeenCalledTimes(3)
    expect(finalCompositionProvider.render).toHaveBeenCalledTimes(1)
    expect(compositionBlobStore.putImmutable).toHaveBeenCalledTimes(1)
    expect(store.persistFinalCompositionSuccess).toHaveBeenCalledWith(composition, expect.objectContaining({
      contentSha256: createHash('sha256').update(rendered.bytes).digest('hex'), durationSeconds: 20,
    }))
  })
})

describe('Three Picks API validation', () => {
  it('accepts exactly three distinct product/revision selections', () => {
    const result = threePicksCampaignInput({ idempotencyKey: uuid(1), campaignName: 'Three Picks',
      items: [1, 2, 3].map(index => ({ curatedProductId: uuid(10 + index),
        productAssetRevisionId: uuid(20 + index), verifiedFactRef: `fact-${index}` })) })
    expect(result.items).toHaveLength(3)
  })

  it('rejects duplicate immutable revisions', () => {
    expect(() => threePicksCampaignInput({ idempotencyKey: uuid(1), campaignName: 'Three Picks',
      items: [1, 2, 3].map(index => ({ curatedProductId: uuid(10 + index),
        productAssetRevisionId: uuid(21), verifiedFactRef: `fact-${index}` })) })).toThrow('Duplicate Three Picks product')
  })
})
