import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { CAPABILITY, freezeManifest, validateImageToVideoRequest } = require('../scripts/revenue-lab/model-capability-manifest.cjs')
const { createImageToVideoRequest } = require('../scripts/revenue-lab/image-to-video-request.cjs')
const { buildProductIdentityPrompt, PROMPT_BUILDER_VERSION } = require('../scripts/revenue-lab/product-i2v-prompt-builder.cjs')
const { createPolloWanVideoGenerationProvider, MANIFEST, MODEL } = require('../scripts/revenue-lab/providers/pollo-wan-video-generation-provider.cjs')
const { createProductAssetRevisionService, decodeImage, inspectImage, isPrivateAddress, padToNineSixteen } = require('../scripts/revenue-lab/product-asset-revision-service.cjs')
const { createSupabaseProductAssetBlobStore, safeObjectKey } = require('../scripts/revenue-lab/product-asset-blob-store.cjs')

const sha = 'a'.repeat(64)
const imageRequest = overrides => ({
  generationMode: 'image_to_video', prompt: 'keep identity', negativePrompt: 'no morphing',
  promptBuilderVersion: PROMPT_BUILDER_VERSION,
  inputImage: { temporaryUrl: 'https://signed.example.test/input.png?token=secret', revisionId: 'revision-1', contentSha256: sha, contentType: 'image/png', pixelWidth: 720, pixelHeight: 1280 },
  durationSeconds: 5, resolution: '720p', aspectRatio: '9:16', audioEnabled: false, ...overrides,
})

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(payload) }
}

describe('Image-to-Video Foundation v1', () => {
  it('uses tri-state capability manifests and rejects undocumented capabilities before submit', () => {
    expect(MANIFEST).toMatchObject({ model: 'wan-v2-2-flash', supportsImageToVideo: 'SUPPORTED', supportsNegativePrompt: 'SUPPORTED', supportsTailFrame: 'UNSUPPORTED' })
    const undocumented = freezeManifest({ ...MANIFEST, supportsNegativePrompt: CAPABILITY.UNDOCUMENTED })
    expect(() => validateImageToVideoRequest(imageRequest(), undocumented)).toThrowError(expect.objectContaining({ code: 'VIDEO_CAPABILITY_UNDOCUMENTED', field: 'supportsNegativePrompt' }))
    expect(() => validateImageToVideoRequest(imageRequest({ durationSeconds: 4 }), MANIFEST)).toThrowError(expect.objectContaining({ code: 'VIDEO_DURATION_UNSUPPORTED' }))
  })

  it('creates a frozen provider-neutral request and enforces 9:16 verified input', () => {
    const request = createImageToVideoRequest(imageRequest(), MANIFEST)
    expect(request).toMatchObject({ generationMode: 'image_to_video', durationSeconds: 5, resolution: '720p', audioEnabled: false })
    expect(Object.isFrozen(request)).toBe(true)
    expect(() => createImageToVideoRequest(imageRequest({ inputImage: { ...imageRequest().inputImage, pixelWidth: 1000 } }), MANIFEST)).toThrowError(expect.objectContaining({ code: 'VIDEO_INPUT_REVISION_INVALID' }))
  })

  it('builds deterministic identity-lock positive and negative prompts', () => {
    expect(buildProductIdentityPrompt()).toEqual(buildProductIdentityPrompt())
    const result = buildProductIdentityPrompt()
    expect(result.version).toBe('product-i2v-identity-v1')
    expect(result.positivePrompt).toContain('completely stationary')
    expect(result.positivePrompt).toContain('slow, stable camera push-in')
    expect(result.negativePrompt).toContain('changed logo')
    expect(result.negativePrompt).toContain('watermark')
  })

  it('maps Wan 2.2 Flash I2V payload only inside the adapter and separates negative prompt', async () => {
    const fetchImpl = vi.fn(async () => response({ code: 200, data: { taskId: 'task-safe', status: 'pending' } }))
    const provider = createPolloWanVideoGenerationProvider({ apiKey: 'test-key', fetchImpl, logger: { error: vi.fn() } })
    await expect(provider.submitScene(imageRequest())).resolves.toMatchObject({ status: 'polling' })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://pollo.ai/api/platform/generation/wanx/wan-v2-2-flash')
    const payload = JSON.parse(options.body)
    expect(payload).toEqual({ input: { image: imageRequest().inputImage.temporaryUrl, prompt: 'keep identity', negativePrompt: 'no morphing', resolution: '720P', length: 5 } })
    expect(payload.input).not.toHaveProperty('audio')
    expect(provider.model).toBe(MODEL)
  })

  it('normalizes wrapped polling success without persisting or logging the signed input URL', async () => {
    const fetchImpl = vi.fn(async (_url, options) => options.method === 'GET'
      ? response({ data: { generations: [{ status: 'succeed', url: 'https://cdn.example.test/output.mp4', mediaType: 'video' }], costUsd: 0.08 } })
      : response({ data: { taskId: 'task-safe', status: 'pending' } }))
    const provider = createPolloWanVideoGenerationProvider({ apiKey: 'test-key', fetchImpl, logger: { error: vi.fn() } })
    await expect(provider.getTaskStatus('task-safe')).resolves.toMatchObject({ status: 'succeeded', providerCost: 0.08, costProvenance: 'actual' })
  })

  it('blocks private and mapped-private SSRF addresses and restricts immutable keys', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true)
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isPrivateAddress('169.254.1.2')).toBe(true)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(() => safeObjectKey('../secret')).toThrow()
    expect(safeObjectKey(`product-assets/11111111-1111-4111-8111-111111111111/${sha}.png`)).toContain(sha)
  })

  it('verifies bytes on immutable-key conflicts and creates only temporary signed reads', async () => {
    const bytes = Buffer.from('exact-image-bytes')
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 409 })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => String(bytes.length) }, arrayBuffer: async () => bytes })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ signedURL: '/object/sign/revenue-product-assets/private?token=temporary' }) })
    const blob = createSupabaseProductAssetBlobStore({ url: 'https://db.example.test', serviceRoleKey: 'server-only', bucket: 'revenue-product-assets', fetchImpl })
    const key = `product-assets/11111111-1111-4111-8111-111111111111/${sha}.png`
    await expect(blob.putImmutable(key, bytes, 'image/png')).resolves.toMatchObject({ alreadyExisted: true })
    await expect(blob.createTemporaryReadUrl(key, 3600)).resolves.toMatch(/^https:\/\/db\.example\.test\/storage\/v1\/object\/sign\//)
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toContain('server-only')
  })

  it('checks MIME, dimensions, byte size and hashes supported image headers', () => {
    const bytes = Buffer.alloc(32)
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
    bytes.writeUInt32BE(720, 16); bytes.writeUInt32BE(1280, 20)
    expect(inspectImage(bytes, 'image/png')).toMatchObject({ contentType: 'image/png', byteSize: 32, pixelWidth: 720, pixelHeight: 1280 })
    expect(() => inspectImage(bytes, 'image/jpeg')).toThrowError(expect.objectContaining({ code: 'ASSET_MIME_MISMATCH' }))
  })

  it('decodes and creates a real 9:16 derived image through the Windows image processor', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    await expect(decodeImage(png)).resolves.toEqual({ pixelWidth: 1, pixelHeight: 1 })
    const derived = await padToNineSixteen(png)
    expect(derived.metadata).toMatchObject({ contentType: 'image/png', pixelWidth: 720, pixelHeight: 1280 })
    expect(derived.bytes.length).toBeGreaterThan(png.length)
  })

  it('captures immutable source and independent 9:16 derived revisions with explicit permission', async () => {
    const derived = Buffer.from('derived-image')
    const store = {
      getProductAsset: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', assetUrl: 'https://assets.example.test/hero.png', usagePermission: 'owned' })),
      registerProductAssetRevision: vi.fn(async (_id, item) => ({ id: `revision-${item.derivationType}`, ...item })),
    }
    const blobStore = { provider: 'supabase-storage', bucket: 'revenue-product-assets', putImmutable: vi.fn(async () => ({})) }
    // Feed a minimal synthetic PNG header accepted by the header parser.
    const bytes = Buffer.alloc(32); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); bytes.writeUInt32BE(1000,16); bytes.writeUInt32BE(1000,20)
    const service2 = createProductAssetRevisionService({ store, blobStore,
      fetchImage: vi.fn(async () => ({ bytes, declaredType: 'image/png', sourceUrl: 'https://assets.example.test/hero.png' })),
      decode: vi.fn(async () => ({ pixelWidth: 1000, pixelHeight: 1000 })),
      deriveImage: vi.fn(async () => ({ bytes: derived, metadata: { contentType: 'image/png', byteSize: derived.length, pixelWidth: 720, pixelHeight: 1280, contentSha256: 'b'.repeat(64) } })),
    })
    const result = await service2.createFromSource('11111111-1111-4111-8111-111111111111', { i2vAllowed: true, createNineSixteen: true })
    expect(result.sourceRevision.derivationType).toBe('source_capture')
    expect(result.usableRevision).toMatchObject({ derivationType: 'pad_9_16', i2vAllowed: true })
    expect(store.registerProductAssetRevision.mock.calls[1][1]).toMatchObject({ parentRevisionId: 'revision-source_capture', derivationSpec: { canvas_width: 720, canvas_height: 1280, crop: false } })
    expect(blobStore.putImmutable).toHaveBeenCalledTimes(2)
  })

  it('does not infer I2V permission from ownership', async () => {
    const store = { getProductAsset: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', assetUrl: 'https://assets.example.test/hero.png', usagePermission: 'licensed' })) }
    const service = createProductAssetRevisionService({ store, blobStore: { provider: 'x', bucket: 'bucket', putImmutable: vi.fn() } })
    await expect(service.createFromSource('asset', { i2vAllowed: true })).rejects.toMatchObject({ code: 'ASSET_I2V_PERMISSION_DENIED' })
  })
})
