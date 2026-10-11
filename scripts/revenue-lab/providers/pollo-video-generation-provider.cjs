'use strict'

const { VideoGenerationProviderError } = require('../video-generation-provider.cjs')

const PROVIDER_ID = 'pollo'
const PROVIDER_VERSION = 'platform-v1'
const DEFAULT_MODEL = 'pollo-v2'
const DEFAULT_RESOLUTION = '480p'
const BASE_URL = 'https://pollo.ai/api/platform/v1'
const SAFE_MODEL = /^pollo-v[0-9]+(?:-[0-9]+)*$/

function validatedModel(value = DEFAULT_MODEL) {
  const model = String(value || DEFAULT_MODEL).trim().toLowerCase()
  if (!SAFE_MODEL.test(model)) throw new TypeError('Invalid Pollo model')
  return model
}

function normalizedDuration(seconds) {
  const duration = Number(seconds)
  if (!Number.isFinite(duration) || duration <= 0) throw new TypeError('Invalid scene duration')
  return duration <= 5 ? 5 : 10
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch { return null }
}

function providerError(status, operation) {
  const code = status === 400 ? 'POLLO_INVALID_REQUEST'
    : status === 401 || status === 403 ? 'POLLO_AUTH_FAILED'
      : status === 404 ? 'POLLO_TASK_OR_MODEL_NOT_FOUND'
        : status === 429 ? 'POLLO_RATE_LIMITED'
          : status >= 500 ? 'POLLO_UNAVAILABLE' : 'POLLO_HTTP_ERROR'
  return new VideoGenerationProviderError(code, `Pollo ${operation} failed`, { status, retryable: status === 429 || status >= 500 })
}

function normalizedProviderStatus(payload) {
  const generation = Array.isArray(payload?.generations) ? payload.generations[0] : null
  const raw = String(generation?.status || payload?.status || 'pending').toLowerCase()
  if (['succeed', 'succeeded', 'success', 'completed'].includes(raw)) return { status: 'succeeded', providerTaskStatus: raw, generation }
  if (['failed', 'failure', 'canceled', 'cancelled'].includes(raw)) return { status: 'failed', providerTaskStatus: raw, generation }
  return { status: 'polling', providerTaskStatus: raw.slice(0, 40), generation }
}

function safeTopLevelKeys(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  return Object.keys(payload).slice(0, 30).map(key => /^[A-Za-z0-9_.-]{1,80}$/.test(key) ? key : '[unsafe-key]')
}

function unwrapProviderPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const directKeys = ['taskId', 'status', 'generations', 'costUsd', 'credit']
  if (directKeys.some(key => Object.prototype.hasOwnProperty.call(payload, key))) return payload
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data
  return payload
}

function responseDiagnostic(response, payload, { endpointPath, jsonParsed }) {
  const keys = safeTopLevelKeys(payload)
  const dataIsObject = Boolean(payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data))
  return {
    httpStatus: Number(response?.status) || null,
    contentType: String(response?.headers?.get?.('content-type') || '').slice(0, 120),
    jsonParsed,
    topLevelKeys: keys,
    hasTaskId: keys.includes('taskId'),
    hasStatus: keys.includes('status'),
    dataIsObject,
    dataTopLevelKeys: dataIsObject ? safeTopLevelKeys(payload.data) : [],
    endpointPath,
  }
}

function createPolloVideoGenerationProvider({
  apiKey = process.env.POLLO_API_KEY,
  model = process.env.REVENUE_LAB_POLLO_MODEL || DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  baseUrl = BASE_URL,
  logger = console,
} = {}) {
  if (!apiKey) throw new Error('POLLO_API_KEY is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const selectedModel = validatedModel(model)
  const root = String(baseUrl).replace(/\/+$/, '')

  async function providerRequest(url, options, operation, endpointPath) {
    let response
    try { response = await fetchImpl(url, options) }
    catch { throw new VideoGenerationProviderError('POLLO_TRANSPORT_ERROR', `Pollo ${operation} transport failed`, { retryable: true }) }
    const text = await response.text()
    let payload = null
    try { payload = text ? JSON.parse(text.replace(/^\uFEFF/, '')) : {} }
    catch {
      logger?.error?.('[revenue-lab] Pollo response validation failed', responseDiagnostic(response, null, { endpointPath, jsonParsed: false }))
      throw new VideoGenerationProviderError('POLLO_INVALID_RESPONSE', `Pollo ${operation} returned invalid JSON`, { status: response.status })
    }
    if (!response.ok) throw providerError(response.status, operation)
    return { payload, response }
  }

  function normalizeError(error) {
    if (error instanceof VideoGenerationProviderError) return error
    if (/^POLLO_[A-Z0-9_]+$/.test(error?.code || '')) return new VideoGenerationProviderError(error.code, 'Pollo provider operation failed')
    return new VideoGenerationProviderError('POLLO_PROVIDER_ERROR', 'Pollo provider operation failed')
  }

  function normalizeResult(payload) {
    const resultPayload = unwrapProviderPayload(payload)
    const state = normalizedProviderStatus(resultPayload)
    const cost = Number(resultPayload?.costUsd)
    const hasActualCost = Number.isFinite(cost) && cost >= 0
    const outputUrl = state.status === 'succeeded' ? safeHttpsUrl(state.generation?.url) : null
    if (state.status === 'succeeded' && (!outputUrl || state.generation?.mediaType !== 'video')) {
      throw new VideoGenerationProviderError('POLLO_INVALID_OUTPUT', 'Pollo succeeded without a safe video output')
    }
    return {
      status: state.status, providerTaskStatus: state.providerTaskStatus,
      outputUrl, providerCost: hasActualCost ? cost : null,
      costCurrency: hasActualCost ? 'USD' : null,
      costProvenance: hasActualCost ? 'actual' : 'unavailable',
      safeErrorCode: state.status === 'failed' ? 'POLLO_GENERATION_FAILED' : null,
    }
  }

  async function submitScene({ prompt, durationSeconds, aspectRatio = '9:16', resolution = DEFAULT_RESOLUTION }) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) throw new TypeError('Invalid Pollo prompt')
    if (aspectRatio !== '9:16') throw new TypeError('Pollo v1 requires 9:16')
    if (!['480p', '720p', '1080p'].includes(resolution)) throw new TypeError('Invalid Pollo resolution')
    const { payload, response } = await providerRequest(`${root}/generation/pollo-ai/${selectedModel}/video`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ input: { prompt: prompt.trim(), resolution, duration: normalizedDuration(durationSeconds), aspectRatio, generateAudio: false } }),
    }, 'submit', `/api/platform/v1/generation/pollo-ai/${selectedModel}/video`)
    const submitPayload = unwrapProviderPayload(payload)
    if (typeof submitPayload?.taskId !== 'string' || !submitPayload.taskId.trim()) {
      logger?.error?.('[revenue-lab] Pollo response validation failed', responseDiagnostic(
        response, payload,
        { endpointPath: `/api/platform/v1/generation/pollo-ai/${selectedModel}/video`, jsonParsed: true },
      ))
      throw new VideoGenerationProviderError('POLLO_INVALID_RESPONSE', 'Pollo submit response did not include a task ID')
    }
    return {
      providerTaskId: submitPayload.taskId.trim(), status: 'polling',
      providerTaskStatus: String(submitPayload.status || 'pending').slice(0, 40),
    }
  }

  async function getTaskStatus(providerTaskId) {
    if (typeof providerTaskId !== 'string' || !providerTaskId.trim() || providerTaskId.length > 200) throw new TypeError('Invalid Pollo task ID')
    const { payload } = await providerRequest(`${root}/generation/${encodeURIComponent(providerTaskId.trim())}/status`, {
      method: 'GET', headers: { 'x-api-key': apiKey },
    }, 'status', '/api/platform/v1/generation/{taskId}/status')
    return normalizeResult(payload)
  }

  return { id: PROVIDER_ID, version: PROVIDER_VERSION, model: selectedModel, submitScene, getTaskStatus, normalizeResult, normalizeError }
}

module.exports = {
  BASE_URL, DEFAULT_MODEL, DEFAULT_RESOLUTION, PROVIDER_ID, PROVIDER_VERSION,
  createPolloVideoGenerationProvider, normalizedDuration, responseDiagnostic, safeTopLevelKeys,
  unwrapProviderPayload, validatedModel,
}
