'use strict'

const DIRECT_PRODUCT_PLACEHOLDERS = Object.freeze({
  appealHypothesis: '[INTERNAL:DIRECT_PRODUCT_REGISTRATION_ONLY]',
  hookText: '[INTERNAL:NO_CREATIVE_HOOK]',
  contentOutline: '[INTERNAL:NO_CREATIVE_OUTLINE]',
})

function boundedCharacters(value, max) {
  return Array.from(String(value || '').trim().replace(/\s+/g, ' ')).slice(0, max).join('')
}

function directProductCampaignName(productName) {
  const suffix = ' · 商品登録'
  return `${boundedCharacters(productName, 120 - Array.from(suffix).length)}${suffix}`
}

function directProductCreativeSnapshot() {
  return {
    appeal_hypothesis: DIRECT_PRODUCT_PLACEHOLDERS.appealHypothesis,
    hook_text: DIRECT_PRODUCT_PLACEHOLDERS.hookText,
    content_outline: { format: 'internal_placeholder', text: DIRECT_PRODUCT_PLACEHOLDERS.contentOutline, reusable: false },
    script_text: null,
  }
}

function isDirectProductRegistrationPlaceholder(value) {
  const candidate = value || {}
  const outline = candidate.content_outline || candidate.outline || {}
  return candidate.appeal_hypothesis === DIRECT_PRODUCT_PLACEHOLDERS.appealHypothesis
    || candidate.hook_text === DIRECT_PRODUCT_PLACEHOLDERS.hookText
    || candidate.hook === DIRECT_PRODUCT_PLACEHOLDERS.hookText
    || outline.text === DIRECT_PRODUCT_PLACEHOLDERS.contentOutline
    || outline.format === 'internal_placeholder'
    || outline.reusable === false
}

module.exports = { DIRECT_PRODUCT_PLACEHOLDERS, directProductCampaignName, directProductCreativeSnapshot,
  isDirectProductRegistrationPlaceholder }
