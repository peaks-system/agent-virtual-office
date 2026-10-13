'use strict'

class FinalCompositionProviderError extends Error {
  constructor(code, message) { super(message); this.name = 'FinalCompositionProviderError'; this.code = code }
}

class FinalCompositionProvider {
  constructor({ id, version }) {
    if (new.target === FinalCompositionProvider) throw new TypeError('FinalCompositionProvider is abstract')
    this.id = id; this.version = version
  }
  async render() { throw new FinalCompositionProviderError('COMPOSITION_NOT_IMPLEMENTED', 'Final composition is not implemented') }
  normalizeError() { return new FinalCompositionProviderError('COMPOSITION_FAILED', 'Final composition failed') }
}

module.exports = { FinalCompositionProvider, FinalCompositionProviderError }
