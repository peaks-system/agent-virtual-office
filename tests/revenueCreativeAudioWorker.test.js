import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createJobHandlers } from '../scripts/revenue-lab/job-handlers.cjs'

const fingerprint = 'f'.repeat(64)
const artifact = { id: 'audio-1', creativeArchetypePlanId: 'plan-1', segmentId: 'hook-1',
  inputText: '短いナレーションです。', inputSha256: createHash('sha256').update('短いナレーションです。').digest('hex'),
  generationFingerprint: fingerprint, stableSeed: 7,
  provider: 'elevenlabs', providerAdapterVersion: 'elevenlabs-tts-adapter-v1', model: 'model', voice: 'voice',
  outputFormat: 'mp3_44100_128', storageBucket: 'revenue-lab-creative-audio', status: 'generating',
  immutableObjectKey: `creative-audio/00000000-0000-4000-8000-000000000001/hook-1/${fingerprint}.mp3` }

function dependencies(overrides = {}) {
  const bytes = Buffer.from('mp3-audio')
  const store = {
    claimCreativeAudioGeneration: vi.fn(async () => ({ claimed: true, artifact })),
    recordCreativeAudioProviderReceipt: vi.fn(async () => ({})),
    completeCreativeAudioGeneration: vi.fn(async () => ({})),
    failCreativeAudioGeneration: vi.fn(async () => ({})),
    ...overrides.store,
  }
  const textToSpeechProvider = { id: 'elevenlabs', version: 'elevenlabs-tts-adapter-v1',
    model: 'model', voice: 'voice', outputFormat: 'mp3_44100_128',
    normalizeError: error => error,
    synthesizeSegment: vi.fn(async () => ({ bytes, audioSha256: createHash('sha256').update(bytes).digest('hex'),
      contentType: 'audio/mpeg', outputFormat: 'mp3_44100_128', providerRequestId: 'req-1',
      providerTraceId: 'trace-1', characterCost: 12 })), ...overrides.provider }
  const creativeAudioBlobStore = { provider: 'supabase-storage', bucket: 'revenue-lab-creative-audio',
    readIfExists: vi.fn(async () => null), putImmutable: vi.fn(async () => ({ alreadyExisted: false })),
    ...overrides.blob }
  const audioDurationProbe = vi.fn(async () => 1.234)
  const handlers = createJobHandlers({ store, youtube: {}, textToSpeechProvider, creativeAudioBlobStore,
    audioDurationProbe, ...overrides.handlers })
  return { handler: handlers.get('creative.audio.generate'), store, textToSpeechProvider,
    creativeAudioBlobStore, audioDurationProbe, bytes }
}

describe('Creative Audio generation worker', () => {
  it('claims before the only provider call, measures with FFprobe adapter, stores, and completes', async () => {
    const value = dependencies()
    await expect(value.handler({ payload: { creative_audio_artifact_id: artifact.id,
      generation_fingerprint: fingerprint } })).resolves.toMatchObject({ status: 'ready' })
    expect(value.store.claimCreativeAudioGeneration.mock.invocationCallOrder[0])
      .toBeLessThan(value.textToSpeechProvider.synthesizeSegment.mock.invocationCallOrder[0])
    expect(value.audioDurationProbe).toHaveBeenCalledWith(value.bytes)
    expect(value.creativeAudioBlobStore.putImmutable).toHaveBeenCalledWith(artifact.immutableObjectKey, value.bytes, 'audio/mpeg')
    expect(value.store.completeCreativeAudioGeneration).toHaveBeenCalledWith(artifact.id, fingerprint,
      expect.objectContaining({ durationSeconds: 1.234, providerRequestId: 'req-1', characterCost: 12 }))
  })

  it('does not call the provider when claim fails for any non-planned state', async () => {
    for (const status of ['generating', 'ready', 'failed', 'submission_uncertain']) {
      const value = dependencies({ store: { claimCreativeAudioGeneration: vi.fn(async () => ({ claimed: false,
        artifact: { ...artifact, status } })) } })
      await expect(value.handler({ payload: { creative_audio_artifact_id: artifact.id,
        generation_fingerprint: fingerprint } })).resolves.toMatchObject({
        status: status === 'generating' ? 'submission_uncertain' : status, providerCalled: false })
      expect(value.textToSpeechProvider.synthesizeSegment).not.toHaveBeenCalled()
    }
  })

  it('recovers an existing deterministic blob without a provider call', async () => {
    const bytes = Buffer.from('existing-mp3')
    const value = dependencies({ store: { claimCreativeAudioGeneration: vi.fn(async () => ({ claimed: false,
      artifact: { ...artifact, providerRequestId: 'req-existing', audioSha256: createHash('sha256').update(bytes).digest('hex') } })) },
    blob: { readIfExists: vi.fn(async () => bytes) } })
    await value.handler({ payload: { creative_audio_artifact_id: artifact.id,
      generation_fingerprint: fingerprint } })
    expect(value.textToSpeechProvider.synthesizeSegment).not.toHaveBeenCalled()
    expect(value.store.completeCreativeAudioGeneration).toHaveBeenCalledWith(artifact.id, fingerprint,
      expect.objectContaining({ audioSha256: createHash('sha256').update(bytes).digest('hex'), recovered: true }))
  })

  it('persists uncertain transport outcomes and never creates a silent fallback', async () => {
    const error = Object.assign(new Error('uncertain'), { code: 'ELEVENLABS_SUBMISSION_UNCERTAIN', submissionUncertain: true })
    const value = dependencies({ provider: { synthesizeSegment: vi.fn(async () => { throw error }) } })
    await expect(value.handler({ payload: { creative_audio_artifact_id: artifact.id,
      generation_fingerprint: fingerprint } })).rejects.toMatchObject({ code: 'ELEVENLABS_SUBMISSION_UNCERTAIN' })
    expect(value.store.failCreativeAudioGeneration).toHaveBeenCalledWith(artifact.id, fingerprint,
      expect.objectContaining({ status: 'submission_uncertain' }))
    expect(value.creativeAudioBlobStore.putImmutable).not.toHaveBeenCalled()
  })

  it('persists provider receipt headers when FFprobe rejects the returned audio', async () => {
    const value = dependencies({ handlers: { audioDurationProbe: vi.fn(async () => { throw new Error('bad mp3') }) } })
    await expect(value.handler({ payload: { creative_audio_artifact_id: artifact.id,
      generation_fingerprint: fingerprint } })).rejects.toMatchObject({ code: 'TTS_DURATION_MEASUREMENT_FAILED' })
    expect(value.store.failCreativeAudioGeneration).toHaveBeenCalledWith(artifact.id, fingerprint,
      expect.objectContaining({ status: 'failed', providerRequestId: 'req-1',
        providerTraceId: 'trace-1', characterCost: 12 }))
    expect(value.creativeAudioBlobStore.putImmutable).not.toHaveBeenCalled()
  })

  it('keeps pre-provider storage failures out of the ElevenLabs error boundary', async () => {
    const storageError = Object.assign(new Error('storage read failed'), {
      code: 'CREATIVE_AUDIO_STORAGE_READ_FAILED', status: 400,
    })
    const value = dependencies({ blob: { readIfExists: vi.fn(async () => { throw storageError }) },
      provider: { normalizeError: vi.fn(() => new Error('must not normalize storage')) } })
    await expect(value.handler({ payload: { creative_audio_artifact_id: artifact.id,
      generation_fingerprint: fingerprint } })).rejects.toMatchObject({
      code: 'CREATIVE_AUDIO_STORAGE_ERROR', safeDiagnostics: { httpStatus: 400 },
    })
    expect(value.textToSpeechProvider.synthesizeSegment).not.toHaveBeenCalled()
    expect(value.textToSpeechProvider.normalizeError).not.toHaveBeenCalled()
    expect(value.store.failCreativeAudioGeneration).toHaveBeenCalledWith(artifact.id, fingerprint,
      expect.objectContaining({ status: 'failed', safeErrorCode: 'CREATIVE_AUDIO_STORAGE_ERROR' }))
  })
})
