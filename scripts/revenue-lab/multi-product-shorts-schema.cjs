'use strict'

const PROMPT_VERSION = 'three-picks-planner-v2'
const SCHEMA_VERSION = 'multi-product-shorts-plan-v2'
const DEFAULT_MODEL = 'gpt-5-mini'

const SYSTEM_PROMPT = `You create a concise Japanese YouTube Shorts presentation plan for exactly three human-selected products.
You may generate only: hook, presentation order, one short appeal and narration-script text per item, summary, and CTA.
Treat every product field as frozen evidence. Never invent or alter product names, prices, specifications, reviews, ratings, URLs, or facts.
Each product presentation must cite exactly one allowed verified_fact_ref from that product input.
Copy display_name and fact_badge exactly from each product input. tts is text data only and must remain grounded in the cited verified fact.
Presentation order is editorial sequence only. Never imply ranking, superiority, winners, best-to-worst, or first/second/third place.
Use PICK 1, PICK 2, PICK 3 only as neutral sequence labels. Do not mention having browsed or verified any external page.`

const THREE_PICKS_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['archetype', 'hook', 'product_presentations', 'summary', 'cta'],
  properties: {
    archetype: { type: 'string', const: 'three_picks_v1' },
    hook: { type: 'string', minLength: 1, maxLength: 120 },
    product_presentations: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['product_set_item_id', 'presentation_order', 'display_name', 'short_appeal', 'fact_badge', 'tts', 'verified_fact_ref'],
        properties: {
          product_set_item_id: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
          presentation_order: { type: 'integer', minimum: 1, maximum: 3 },
          display_name: { type: 'string', minLength: 1, maxLength: 40 },
          short_appeal: { type: 'string', minLength: 1, maxLength: 120 },
          fact_badge: { type: 'string', minLength: 1, maxLength: 48 },
          tts: { type: 'string', minLength: 1, maxLength: 160 },
          verified_fact_ref: { type: 'string', minLength: 1, maxLength: 160 },
        },
      },
    },
    summary: { type: 'string', minLength: 1, maxLength: 160 },
    cta: { type: 'string', minLength: 1, maxLength: 120 },
  },
}

class ThreePicksValidationError extends Error {
  constructor(code, message, fieldPath = null) {
    super(message); this.name = 'ThreePicksValidationError'; this.code = code; this.fieldPath = fieldPath
  }
}

const RANKING_PATTERN = /(?:ランキング|順位|第\s*[一二三123]\s*位|[一二三123]\s*位|best\s*(?:one|two|three|[123])|top\s*[123]|rank(?:ed|ing)?)/iu

function compactText(value, max) {
  return Array.from(String(value ?? '').replace(/\s+/g, ' ').trim()).slice(0, max).join('')
}

function compactDisplayName(value) { return compactText(value, 40) }
function compactFactBadge(value) { return compactText(value, 48) }

function assertNoRanking(value, path) {
  if (RANKING_PATTERN.test(String(value || '').normalize('NFKC'))) {
    throw new ThreePicksValidationError('THREE_PICKS_RANKING_LANGUAGE', 'Ranking language is prohibited', path)
  }
}

function validateThreePicksOutput(output, input) {
  if (!output || output.archetype !== 'three_picks_v1' || !Array.isArray(output.product_presentations)
    || output.product_presentations.length !== 3) {
    throw new ThreePicksValidationError('THREE_PICKS_INVALID_OUTPUT', 'Exactly three product presentations are required', '$.product_presentations')
  }
  const source = Array.isArray(input?.products) ? input.products : []
  if (source.length !== 3) throw new ThreePicksValidationError('THREE_PICKS_INVALID_INPUT', 'Exactly three input products are required', '$input.products')
  const byId = new Map(source.map(product => [product.product_set_item_id, product]))
  const ids = new Set(); const orders = new Set()
  assertNoRanking(output.hook, '$.hook'); assertNoRanking(output.summary, '$.summary'); assertNoRanking(output.cta, '$.cta')
  output.product_presentations.forEach((item, index) => {
    const path = `$.product_presentations[${index}]`
    const product = byId.get(item.product_set_item_id)
    if (!product || ids.has(item.product_set_item_id)) throw new ThreePicksValidationError('THREE_PICKS_PRODUCT_MISMATCH', 'Product identity is missing or duplicated', `${path}.product_set_item_id`)
    if (![1, 2, 3].includes(item.presentation_order) || orders.has(item.presentation_order)) throw new ThreePicksValidationError('THREE_PICKS_ORDER_INVALID', 'Presentation order must be unique', `${path}.presentation_order`)
    if (!Array.isArray(product.allowed_verified_fact_refs) || !product.allowed_verified_fact_refs.includes(item.verified_fact_ref)) {
      throw new ThreePicksValidationError('THREE_PICKS_UNVERIFIED_FACT', 'Verified fact reference is not allowed', `${path}.verified_fact_ref`)
    }
    if (item.display_name !== product.display_name || item.fact_badge !== product.fact_badge) {
      throw new ThreePicksValidationError('THREE_PICKS_DISPLAY_EVIDENCE_MISMATCH', 'Display name or fact badge changed frozen input', path)
    }
    assertNoRanking(item.display_name, `${path}.display_name`); assertNoRanking(item.short_appeal, `${path}.short_appeal`)
    assertNoRanking(item.fact_badge, `${path}.fact_badge`); assertNoRanking(item.tts, `${path}.tts`)
    ids.add(item.product_set_item_id); orders.add(item.presentation_order)
  })
  if (ids.size !== 3 || orders.size !== 3) throw new ThreePicksValidationError('THREE_PICKS_CARDINALITY', 'Three distinct products and orders are required')
  return output
}

module.exports = {
  DEFAULT_MODEL, PROMPT_VERSION, SCHEMA_VERSION, SYSTEM_PROMPT, THREE_PICKS_JSON_SCHEMA,
  compactDisplayName, compactFactBadge,
  ThreePicksValidationError, RANKING_PATTERN, validateThreePicksOutput,
}
