'use strict'

const { CAPABILITY, freezeManifest, validateImageToVideoRequest } = require('../model-capability-manifest.cjs')
const { VideoGenerationProviderError } = require('../video-generation-provider.cjs')
const { responseDiagnostic, unwrapProviderPayload } = require('./pollo-video-generation-provider.cjs')

const PROVIDER_ID = 'pollo'
const PROVIDER_VERSION = 'platform-wan-v1'
const ADAPTER_VERSION = 'pollo-wan-v2-2-flash-i2v-v1'
const MODEL = 'wan-v2-2-flash'
const BASE_URL = 'https://pollo.ai/api/platform'

const MANIFEST = freezeManifest({
  provider: PROVIDER_ID, providerVersion: PROVIDER_VERSION, adapterVersion: ADAPTER_VERSION, model: MODEL,
  supportsImageToVideo: CAPABILITY.SUPPORTED,
  supportsNegativePrompt: CAPABILITY.SUPPORTED,
  supportsTailFrame: CAPABILITY.UNSUPPORTED,
  supportsMovementAmplitude: CAPABILITY.UNSUPPORTED,
  supportedDurations: [5],
  supportedResolutions: ['720p'],
})

function safeHttpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null }
  catch { return null }
}

function providerError(status, operation) {
  const code = status === 400 ? 'POLLO_INVALID_REQUEST'
    : status === 401 || status === 403 ? 'POLLO_AUTH_FAILED'
      : status === 404 ? 'POLLO_TASK_OR_MODEL_NOT_FOUND'
        : status === 429 ? 'POLLO_RATE_LIMITED'
          : status >= 500 ? 'POLLO_UNAVAILABLE' : 'POLLO_HTTP_ERROR'
  return new VideoGenerationProviderError(code, `Pollo Wan ${operation} failed`, { status, retryable: status === 429 || status >= 500 })
}

function createPolloWanVideoGenerationProvider({
  apiKey = process.env.POLLO_API_KEY,
  fetchImpl = globalThis.fetch,
  baseUrl = BASE_URL,
  logger = console,
} = {}) {
  if (!apiKey) throw new Error('POLLO_API_KEY is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const root = String(baseUrl).replace(/\/+$/, '')

  async function request(url, options, operation, endpointPath) {
    let response
    try { response = await fetchImpl(url, options) }
    catch { throw new VideoGenerationProviderError('POLLO_TRANSPORT_ERROR', `Pollo Wan ${operation} transport failed`, { retryable: false }) }
    const text = await response.text()
    let payload
    try { payload = text ? JSON.parse(text.replace(/^\uFEFF/, '')) : {} }
    catch {
      logger?.error?.('[revenue-lab] Pollo Wan response validation failed', responseDiagnostic(response, null, { endpointPath, jsonParsed: false }))
      throw new VideoGenerationProviderError('POLLO_INVALID_RESPONSE', `Pollo Wan ${operation} returned invalid JSON`, { status: response.status })
    }
    if (!response.ok) throw providerError(response.status, operation)
    return { payload, response }
  }

  function normalizeError(error) {
    if (error instanceof VideoGenerationProviderError) return error
    return new VideoGenerationProviderError('POLLO_PROVIDER_ERROR', 'Pollo Wan provider operation failed')
  }

  function normalizeResult(payload) {
    const value = unwrapProviderPayload(payload)
    const generation = Array.isArray(value?.generations) ? value.generations[0] : null
    const raw = String(generation?.status || value?.status || 'pending').toLowerCase()
    const status = ['succeed', 'succeeded', 'success', 'completed'].includes(raw) ? 'succeeded'
      : ['failed', 'failure', 'canceled', 'cancelled'].includes(raw) ? 'failed' : 'polling'
    const cost = Number(value?.costUsd)
    const hasCost = Number.isFinite(cost) && cost >= 0
    const outputUrl = status === 'succeeded' ? safeHttpsUrl(generation?.url) : null
    if (status === 'succeeded' && (!outputUrl || generation?.mediaType !== 'video')) {
      throw new VideoGenerationProviderError('POLLO_INVALID_OUTPUT', 'Pollo Wan succeeded without a safe video output')
    }
    return {
      status, providerTaskStatus: raw.slice(0, 40), outputUrl,
      providerCost: hasCost ? cost : null, costCurrency: hasCost ? 'USD' : null,
      costProvenance: hasCost ? 'actual' : 'unavailable',
      safeErrorCode: status === 'failed' ? 'POLLO_GENERATION_FAILED' : null,
    }
  }

  async function submitScene(input) {
    validateImageToVideoRequest(input, MANIFEST)
    const endpointPath = `/api/platform/generation/wanx/${MODEL}`
    const { payload, response } = await request(`${root}/generation/wanx/${MODEL}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ input: {
        image: input.inputImage.temporaryUrl,
        prompt: input.prompt.trim(), negativePrompt: input.negativePrompt.trim(),
        resolution: '720P', length: 5,
      } }),
    }, 'submit', endpointPath)
    const value = unwrapProviderPayload(payload)
    if (typeof value?.taskId !== 'string' || !value.taskId.trim()) {
      logger?.error?.('[revenue-lab] Pollo Wan response validation failed', responseDiagnostic(response, payload, { endpointPath, jsonParsed: true }))
      throw new VideoGenerationProviderError('POLLO_INVALID_RESPONSE', 'Pollo Wan submit response did not include a task ID')
    }
    return { providerTaskId: value.taskId.trim(), status: 'polling', providerTaskStatus: String(value.status || 'waiting').slice(0, 40) }
  }

  async function getTaskStatus(providerTaskId) {
    if (typeof providerTaskId !== 'string' || !providerTaskId.trim() || providerTaskId.length > 200) throw new TypeError('Invalid Pollo task ID')
    const { payload } = await request(`${root}/v1/generation/${encodeURIComponent(providerTaskId.trim())}/status`, {
      method: 'GET', headers: { 'x-api-key': apiKey },
    }, 'status', '/api/platform/v1/generation/{taskId}/status')
    return normalizeResult(payload)
  }

  return {
    id: PROVIDER_ID, version: PROVIDER_VERSION, adapterVersion: ADAPTER_VERSION, model: MODEL,
    capabilityManifest: MANIFEST, submitScene, getTaskStatus, normalizeResult, normalizeError,
  }
}

module.exports = { ADAPTER_VERSION, BASE_URL, MANIFEST, MODEL, PROVIDER_ID, PROVIDER_VERSION, createPolloWanVideoGenerationProvider }
