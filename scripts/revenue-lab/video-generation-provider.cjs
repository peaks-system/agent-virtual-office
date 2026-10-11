'use strict'

const NORMALIZED_STATUSES = ['queued', 'submitting', 'polling', 'succeeded', 'failed']
const COST_PROVENANCE = ['actual', 'estimated', 'unavailable']

class VideoGenerationProviderError extends Error {
  constructor(code, message, { status = null, retryable = false } = {}) {
    super(message)
    this.name = 'VideoGenerationProviderError'
    this.code = code
    this.status = status
    this.retryable = retryable
  }
}

function assertVideoGenerationProvider(provider) {
  if (!provider || typeof provider.id !== 'string' || typeof provider.version !== 'string') throw new TypeError('VideoGenerationProvider identity is required')
  for (const method of ['submitScene', 'getTaskStatus', 'normalizeResult', 'normalizeError']) {
    if (typeof provider[method] !== 'function') throw new TypeError(`VideoGenerationProvider.${method} is required`)
  }
  return provider
}

module.exports = { COST_PROVENANCE, NORMALIZED_STATUSES, VideoGenerationProviderError, assertVideoGenerationProvider }
