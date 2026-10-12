import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createJobHandlers } = require('../scripts/revenue-lab/job-handlers.cjs')
const { MANIFEST } = require('../scripts/revenue-lab/providers/pollo-wan-video-generation-provider.cjs')

const snapshot = { immutable_object_key: `product-assets/11111111-1111-4111-8111-111111111111/${'a'.repeat(64)}.png`, content_sha256: 'a'.repeat(64), content_type: 'image/png', pixel_width: 720, pixel_height: 1280 }
const scene = overrides => ({
  id: 'scene-i2v', runId: 'run-i2v', generationMode: 'image_to_video', provider: 'pollo',
  providerVersion: 'platform-wan-v1', requestedModel: 'wan-v2-2-flash', providerTaskId: null,
  inputAssetRevisionId: 'revision-1', inputAssetSnapshot: snapshot,
  promptSnapshot: 'identity lock', negativePromptSnapshot: 'no morphing',
  promptBuilderVersion: 'product-i2v-identity-v1', durationSeconds: 5, aspectRatio: '9:16',
  resolution: '720p', attemptNumber: 1, status: 'queued', ...overrides,
})

function storeFor(value) {
  return {
    getVideoGenerationScene: vi.fn(async () => value), markVideoGenerationSubmitting: vi.fn(async () => {}),
    markVideoGenerationPollingResume: vi.fn(async () => {}), persistVideoGenerationTask: vi.fn(async () => {}),
    persistVideoGenerationPolling: vi.fn(async () => {}), persistVideoGenerationPollingInterrupted: vi.fn(async () => {}),
    persistVideoGenerationSuccess: vi.fn(async () => {}), persistVideoGenerationFailure: vi.fn(async () => {}),
    persistVideoGenerationSubmissionUncertain: vi.fn(async () => {}),
  }
}

function provider(overrides = {}) {
  return {
    id: 'pollo', version: 'platform-wan-v1', model: 'wan-v2-2-flash', capabilityManifest: MANIFEST,
    submitScene: vi.fn(async () => ({ providerTaskId: 'provider-task', providerTaskStatus: 'pending' })),
    getTaskStatus: vi.fn(async () => ({ status: 'succeeded', providerTaskStatus: 'succeed', outputUrl: 'https://cdn.example.test/out.mp4', providerCost: null, costProvenance: 'unavailable' })),
    normalizeResult: vi.fn(), normalizeError: vi.fn(error => error), ...overrides,
  }
}

describe('Image-to-Video worker safety', () => {
  it('signs the immutable input just in time and completes one I2V attempt', async () => {
    const item = scene(); const store = storeFor(item); const imageToVideoProvider = provider()
    const productAssetBlobStore = { createTemporaryReadUrl: vi.fn(async () => 'https://signed.example.test/input.png?token=not-persisted') }
    const handler = createJobHandlers({ store, youtube: {}, imageToVideoProvider, productAssetBlobStore, videoPollAttempts: 1 }).get('video.generate.scene')
    await expect(handler({ payload: { video_generation_scene_id: item.id } })).resolves.toMatchObject({ status: 'succeeded', attemptNumber: 1 })
    expect(productAssetBlobStore.createTemporaryReadUrl).toHaveBeenCalledWith(snapshot.immutable_object_key, 3600)
    expect(imageToVideoProvider.submitScene).toHaveBeenCalledWith(expect.objectContaining({ generationMode: 'image_to_video', inputImage: expect.objectContaining({ revisionId: 'revision-1' }), audioEnabled: false }))
    expect(store.persistVideoGenerationTask).toHaveBeenCalledOnce()
    expect(store.persistVideoGenerationSuccess).toHaveBeenCalledOnce()
  })

  it('resumes an existing paid task after restart without signing or submitting again', async () => {
    const item = scene({ providerTaskId: 'existing-task', status: 'polling' }); const store = storeFor(item); const imageToVideoProvider = provider()
    const productAssetBlobStore = { createTemporaryReadUrl: vi.fn() }
    const handler = createJobHandlers({ store, youtube: {}, imageToVideoProvider, productAssetBlobStore, videoPollAttempts: 1 }).get('video.generate.scene')
    await handler({ payload: { video_generation_scene_id: item.id } })
    expect(imageToVideoProvider.submitScene).not.toHaveBeenCalled()
    expect(imageToVideoProvider.getTaskStatus).toHaveBeenCalledWith('existing-task')
    expect(productAssetBlobStore.createTemporaryReadUrl).not.toHaveBeenCalled()
    expect(store.markVideoGenerationPollingResume).toHaveBeenCalledWith(item)
  })

  it('treats timeout as nonterminal and keeps the existing provider task resumable', async () => {
    const item = scene({ providerTaskId: 'existing-task', status: 'polling' }); const store = storeFor(item)
    const imageToVideoProvider = provider({ getTaskStatus: vi.fn(async () => ({ status: 'polling', providerTaskStatus: 'processing', costProvenance: 'unavailable' })) })
    const handler = createJobHandlers({ store, youtube: {}, imageToVideoProvider, productAssetBlobStore: {}, videoPollAttempts: 1 }).get('video.generate.scene')
    await expect(handler({ payload: { video_generation_scene_id: item.id } })).rejects.toMatchObject({ code: 'VIDEO_GENERATION_POLL_TIMEOUT', deferJob: true })
    expect(store.persistVideoGenerationPollingInterrupted).toHaveBeenCalledOnce()
    expect(store.persistVideoGenerationFailure).not.toHaveBeenCalled()
  })

  it('seals an unknown submit outcome and never retries submission automatically', async () => {
    const item = scene(); const store = storeFor(item)
    const transport = Object.assign(new Error('network ended after request write'), { code: 'POLLO_TRANSPORT_ERROR' })
    const imageToVideoProvider = provider({ submitScene: vi.fn(async () => { throw transport }) })
    const handler = createJobHandlers({ store, youtube: {}, imageToVideoProvider,
      productAssetBlobStore: { createTemporaryReadUrl: vi.fn(async () => 'https://signed.example.test/input.png') }, videoPollAttempts: 1 }).get('video.generate.scene')
    await expect(handler({ payload: { video_generation_scene_id: item.id } })).rejects.toMatchObject({ code: 'VIDEO_GENERATION_SUBMISSION_UNCERTAIN' })
    expect(store.persistVideoGenerationSubmissionUncertain).toHaveBeenCalledOnce()
    expect(store.persistVideoGenerationFailure).not.toHaveBeenCalled()
    const uncertain = scene({ status: 'submission_uncertain', submissionUncertain: true })
    const secondStore = storeFor(uncertain)
    const second = createJobHandlers({ store: secondStore, youtube: {}, imageToVideoProvider,
      productAssetBlobStore: {}, videoPollAttempts: 1 }).get('video.generate.scene')
    await expect(second({ payload: { video_generation_scene_id: uncertain.id } })).rejects.toMatchObject({ code: 'VIDEO_GENERATION_SUBMISSION_UNCERTAIN' })
    expect(imageToVideoProvider.submitScene).toHaveBeenCalledTimes(1)
  })

  it('preserves legacy T2V terminal handling for a submit transport failure', async () => {
    const item = { ...scene(), generationMode: 'text_to_video', providerVersion: 'platform-v1', requestedModel: 'pollo-v2', inputAssetSnapshot: null, promptSnapshot: 't2v', resolution: '480p' }
    const store = storeFor(item)
    const error = Object.assign(new Error('transport'), { code: 'POLLO_TRANSPORT_ERROR' })
    const videoGenerationProvider = { ...provider(), version: 'platform-v1', model: 'pollo-v2', capabilityManifest: undefined,
      submitScene: vi.fn(async () => { throw error }), normalizeError: vi.fn(value => value) }
    const handler = createJobHandlers({ store, youtube: {}, videoGenerationProvider, videoPollAttempts: 1 }).get('video.generate.scene')
    await expect(handler({ payload: { video_generation_scene_id: item.id } })).rejects.toMatchObject({ code: 'POLLO_TRANSPORT_ERROR' })
    expect(store.persistVideoGenerationSubmissionUncertain).not.toHaveBeenCalled()
    expect(store.persistVideoGenerationFailure).toHaveBeenCalledOnce()
  })
})
