'use strict'

class TextToSpeechProviderError extends Error {
  constructor(code, message, { status = null, submissionUncertain = false, safeDiagnostics = null } = {}) {
    super(message)
    this.name = 'TextToSpeechProviderError'
    this.code = code
    this.status = status
    this.submissionUncertain = submissionUncertain
    this.safeDiagnostics = safeDiagnostics
  }
}

function assertTextToSpeechProvider(provider) {
  if (!provider || typeof provider.synthesizeSegment !== 'function' || typeof provider.normalizeError !== 'function') {
    throw new TypeError('Text-to-speech provider contract is required')
  }
  return provider
}

module.exports = { TextToSpeechProviderError, assertTextToSpeechProvider }
