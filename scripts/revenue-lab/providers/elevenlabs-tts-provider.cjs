'use strict'

const { createHash } = require('node:crypto')
const { TextToSpeechProviderError } = require('../text-to-speech-provider.cjs')

const PROVIDER_ID = 'elevenlabs'
const ADAPTER_VERSION = 'elevenlabs-tts-adapter-v1'
const OUTPUT_FORMAT = 'mp3_44100_128'
const BASE_URL = 'https://api.elevenlabs.io'
const VOICE_SETTINGS = Object.freeze({ stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 })

function safeIdentifier(value, label) {
  const result = String(value || '').trim()
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(result)) throw new TypeError(`Invalid ElevenLabs ${label}`)
  return result
}

function finiteHeaderInteger(response, name) {
  const value = Number.parseInt(response.headers.get(name) || '', 10)
  return Number.isInteger(value) && value >= 0 ? value : null
}

function safeToken(value) {
  const token = String(value || '').trim()
  return /^[A-Za-z0-9_.-]{1,120}$/.test(token) ? token : null
}

function safeProviderMessage(value) {
  const message = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\bsk_[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\b(Bearer|xi-api-key|api[ _-]?key)(\s*[:=]?\s*)\S+/gi, '$1$2[redacted]')
  return message ? message.slice(0, 240) : 'ElevenLabs rejected the speech request'
}

async function safeErrorDiagnostics(response) {
  let payload = null
  try { payload = await response.json() }
  catch { /* A non-JSON provider error has no safe body diagnostics. */ }
  const detail = payload?.detail && typeof payload.detail === 'object' ? payload.detail : null
  const detailMessage = typeof payload?.detail === 'string' ? payload.detail : null
  return Object.freeze({
    httpStatus: response.status,
    errorType: safeToken(detail?.type ?? payload?.type),
    errorCode: safeToken(detail?.status ?? detail?.code ?? payload?.status ?? payload?.code),
    message: safeProviderMessage(detail?.message ?? detailMessage ?? payload?.message),
  })
}

async function httpError(response) {
  const status = response.status
  const code = status === 401 || status === 403 ? 'ELEVENLABS_AUTH_FAILED'
    : status === 429 ? 'ELEVENLABS_RATE_LIMITED'
      : status >= 500 ? 'ELEVENLABS_UNAVAILABLE' : 'ELEVENLABS_REQUEST_REJECTED'
  const safeDiagnostics = await safeErrorDiagnostics(response)
  return new TextToSpeechProviderError(code, 'ElevenLabs rejected the speech request', { status, safeDiagnostics })
}

function createElevenLabsTtsProvider({
  apiKey = process.env.ELEVENLABS_API_KEY,
  model = process.env.REVENUE_LAB_ELEVENLABS_MODEL_ID,
  voice = process.env.REVENUE_LAB_ELEVENLABS_VOICE_ID,
  timeoutMs = Number(process.env.REVENUE_LAB_ELEVENLABS_TIMEOUT_MS) || 45_000,
  fetchImpl = globalThis.fetch,
  baseUrl = BASE_URL,
} = {}) {
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const selectedModel = safeIdentifier(model, 'model ID')
  const selectedVoice = safeIdentifier(voice, 'voice ID')
  if (!Number.isFinite(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) throw new TypeError('Invalid ElevenLabs timeout')
  const root = String(baseUrl).replace(/\/+$/, '')

  function normalizeError(error) {
    if (error instanceof TextToSpeechProviderError) return error
    return new TextToSpeechProviderError('ELEVENLABS_PROVIDER_ERROR', 'ElevenLabs speech generation failed')
  }

  async function synthesizeSegment({ inputText, stableSeed }) {
    const text = String(inputText || '').trim()
    if (!text || Array.from(text).length > 80) throw new TypeError('Narration segment must contain 1-80 characters')
    if (!Number.isInteger(stableSeed) || stableSeed < 0 || stableSeed > 2147483647) throw new TypeError('Invalid stable seed')
    let response
    try {
      response = await fetchImpl(`${root}/v1/text-to-speech/${encodeURIComponent(selectedVoice)}?output_format=${OUTPUT_FORMAT}`, {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', accept: 'audio/mpeg', 'xi-api-key': apiKey },
        body: JSON.stringify({ text, model_id: selectedModel, voice_settings: VOICE_SETTINGS,
          seed: stableSeed, apply_text_normalization: 'auto', apply_language_text_normalization: true }),
      })
    } catch {
      throw new TextToSpeechProviderError('ELEVENLABS_SUBMISSION_UNCERTAIN', 'ElevenLabs submission outcome is uncertain', { submissionUncertain: true })
    }
    if (!response.ok) throw await httpError(response)
    let bytes
    try { bytes = Buffer.from(await response.arrayBuffer()) }
    catch {
      throw new TextToSpeechProviderError('ELEVENLABS_SUBMISSION_UNCERTAIN', 'ElevenLabs audio response was incomplete', { status: response.status, submissionUncertain: true })
    }
    const providerRequestId = String(response.headers.get('request-id') || '').trim()
    const responseContentType = String(response.headers.get('content-type') || '').toLowerCase()
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !providerRequestId
      || (!responseContentType.startsWith('audio/') && responseContentType !== 'application/octet-stream')) {
      throw new TextToSpeechProviderError('ELEVENLABS_SUBMISSION_UNCERTAIN', 'ElevenLabs audio response could not be verified', { status: response.status, submissionUncertain: true })
    }
    return { bytes, audioSha256: createHash('sha256').update(bytes).digest('hex'),
      contentType: 'audio/mpeg', outputFormat: OUTPUT_FORMAT, providerRequestId,
      providerTraceId: String(response.headers.get('x-trace-id') || '').trim() || null,
      characterCost: finiteHeaderInteger(response, 'character-cost') }
  }

  return { id: PROVIDER_ID, version: ADAPTER_VERSION, model: selectedModel, voice: selectedVoice,
    outputFormat: OUTPUT_FORMAT, voiceSettings: VOICE_SETTINGS, synthesizeSegment, normalizeError }
}

module.exports = { ADAPTER_VERSION, BASE_URL, OUTPUT_FORMAT, PROVIDER_ID, VOICE_SETTINGS,
  createElevenLabsTtsProvider, safeErrorDiagnostics, safeProviderMessage }
