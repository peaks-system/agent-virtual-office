import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createRevenueApi } = require('../scripts/revenue-api.cjs')
const artifactId = '11111111-1111-4111-8111-111111111111'
const idempotencyKey = '22222222-2222-4222-8222-222222222222'

async function invoke(handler, payload) {
  const req = Readable.from([Buffer.from(JSON.stringify(payload))])
  Object.assign(req, { method: 'POST', url: `/api/revenue/creative-audio-artifacts/${artifactId}/generation`,
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, socket: { remoteAddress: '127.0.0.1' } })
  let status = 200; let responseBody = ''
  const res = { setHeader: vi.fn(), writeHead: vi.fn(value => { status = value }), end: vi.fn(value => { responseBody += value || '' }) }
  await handler(req, res)
  return { status, body: JSON.parse(responseBody) }
}

describe('Creative Audio Artifact generation API boundary', () => {
  it('enqueues only the requested artifact with server-side provider configuration', async () => {
    const store = { enqueueCreativeAudioArtifactGeneration: vi.fn()
      .mockResolvedValueOnce({ artifactId, created: true, createdCount: 1 })
      .mockResolvedValueOnce({ artifactId, created: false, createdCount: 0 }) }
    const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-secret', YOUTUBE_API_KEY: 'test',
      ELEVENLABS_API_KEY: 'private-elevenlabs-key', REVENUE_LAB_ELEVENLABS_MODEL_ID: 'eleven_multilingual_v2',
      REVENUE_LAB_ELEVENLABS_VOICE_ID: 'voice-1', REVENUE_LAB_FFPROBE_PATH: 'ffprobe',
      REVENUE_LAB_CREATIVE_AUDIO_BUCKET: 'revenue-lab-creative-audio' }
    const api = createRevenueApi({ env, store, authorize: () => true, permit: () => true })

    const first = await invoke(api.handler, { idempotencyKey, apiKey: 'client-secret', provider: 'untrusted' })
    const duplicate = await invoke(api.handler, { idempotencyKey })

    expect(first.status).toBe(201)
    expect(first.body.data).toMatchObject({ artifactId, created: true, createdCount: 1 })
    expect(duplicate.status).toBe(200)
    expect(duplicate.body.data).toMatchObject({ created: false, createdCount: 0 })
    expect(store.enqueueCreativeAudioArtifactGeneration).toHaveBeenNthCalledWith(1, artifactId, expect.objectContaining({
      idempotencyKey, provider: 'elevenlabs', model: 'eleven_multilingual_v2', voice: 'voice-1',
      outputFormat: 'mp3_44100_128', storageBucket: 'revenue-lab-creative-audio',
    }))
    const serialized = JSON.stringify(store.enqueueCreativeAudioArtifactGeneration.mock.calls)
    expect(serialized).not.toContain('private-elevenlabs-key')
    expect(serialized).not.toContain('client-secret')
    expect(serialized).not.toContain('untrusted')
  })
})
