import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  ADAPTER_VERSION, OUTPUT_FORMAT, PROVIDER_ID,
  createElevenLabsTtsProvider,
} from '../scripts/revenue-lab/providers/elevenlabs-tts-provider.cjs'

describe('ElevenLabs TTS Adapter v1', () => {
  it('exposes a fixed adapter identity while leaving model and voice configurable', () => {
    const provider = createElevenLabsTtsProvider({ apiKey: 'test-only', model: 'configured-model',
      voice: 'configured-voice', fetchImpl: vi.fn() })
    expect(provider).toMatchObject({ id: PROVIDER_ID, version: ADAPTER_VERSION,
      model: 'configured-model', voice: 'configured-voice', outputFormat: OUTPUT_FORMAT })
  })

  it('sends one Japanese segment with fixed output format and captures billing headers', async () => {
    const bytes = Buffer.from('test mp3 bytes')
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200, headers: {
      'content-type': 'audio/mpeg', 'character-cost': '18', 'request-id': 'req-1', 'x-trace-id': 'trace-1',
    } }))
    const provider = createElevenLabsTtsProvider({ apiKey: 'test-only', model: 'configured-model',
      voice: 'configured-voice', fetchImpl })
    const result = await provider.synthesizeSegment({ inputText: '日本語の短いナレーションです。', stableSeed: 42 })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toContain('/v1/text-to-speech/configured-voice?output_format=mp3_44100_128')
    expect(options.headers['xi-api-key']).toBe('test-only')
    expect(JSON.parse(options.body)).toMatchObject({ model_id: 'configured-model', seed: 42,
      apply_language_text_normalization: true })
    expect(result).toMatchObject({ providerRequestId: 'req-1', providerTraceId: 'trace-1',
      characterCost: 18, contentType: 'audio/mpeg', outputFormat: OUTPUT_FORMAT })
    expect(result.audioSha256).toBe(createHash('sha256').update(bytes).digest('hex'))
  })

  it('marks transport and malformed-success outcomes uncertain and never returns silent audio', async () => {
    const transport = createElevenLabsTtsProvider({ apiKey: 'test-only', model: 'model', voice: 'voice',
      fetchImpl: vi.fn(async () => { throw new TypeError('network') }) })
    await expect(transport.synthesizeSegment({ inputText: '送信結果不明', stableSeed: 1 }))
      .rejects.toMatchObject({ code: 'ELEVENLABS_SUBMISSION_UNCERTAIN', submissionUncertain: true })
    const empty = createElevenLabsTtsProvider({ apiKey: 'test-only', model: 'model', voice: 'voice',
      fetchImpl: vi.fn(async () => new Response(new Uint8Array(), { status: 200,
        headers: { 'content-type': 'audio/mpeg', 'request-id': 'req-2' } })) })
    await expect(empty.synthesizeSegment({ inputText: '空音声は禁止', stableSeed: 1 }))
      .rejects.toMatchObject({ code: 'ELEVENLABS_SUBMISSION_UNCERTAIN', submissionUncertain: true })
  })

  it('treats a definitive HTTP rejection as failed without exposing response text', async () => {
    const provider = createElevenLabsTtsProvider({ apiKey: 'test-only', model: 'model', voice: 'voice',
      fetchImpl: vi.fn(async () => new Response('provider detail', { status: 401 })) })
    await expect(provider.synthesizeSegment({ inputText: '認証失敗', stableSeed: 1 }))
      .rejects.toMatchObject({ code: 'ELEVENLABS_AUTH_FAILED', submissionUncertain: false, status: 401 })
  })
})
