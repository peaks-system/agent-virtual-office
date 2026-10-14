'use strict'

const ARCHETYPE = 'three_picks_v2'
const PROMPT_VERSION = 'three-picks-production-planner-v1'
const SCHEMA_VERSION = 'multi-product-shorts-plan-v3'
const DEFAULT_MODEL = 'gpt-5-mini'
const TEMPLATE_ID = 'hero-carousel-v2'
const LAYOUT_ID = 'hero-product-layout-v1'
const MANIFEST_VERSION = 'three-picks-composition-manifest-v2'

const LIMITS = Object.freeze({
  hookDisplay: 22, hookTts: 80, displayName: 18, shortAppeal: 28,
  factBadge: 18, productTts: 140, ctaDisplay: 18, ctaTts: 70, segment: 42,
})

const SYSTEM_PROMPT = `Create a Japanese three-product Shorts production plan from frozen verified evidence.
The server fixes the template. Do not output a template, layout, coordinates, durations, effects, provider, or ranking.
Copy display_name and fact_badge exactly. Cite exactly one allowed verified_fact_ref per product.
Generate only a concise theme, Hook display text and narration, one short appeal and narration per product, and CTA display text and narration.
Never invent or alter product identity, price, specification, review, rating, URL, or verified fact.`

const THREE_PICKS_V2_JSON_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['archetype', 'theme', 'hook', 'product_presentations', 'cta'],
  properties: {
    archetype: { type: 'string', const: ARCHETYPE },
    theme: { type: 'string', minLength: 1, maxLength: 48 },
    hook: {
      type: 'object', additionalProperties: false, required: ['display_text', 'tts'],
      properties: { display_text: { type: 'string', minLength: 1, maxLength: LIMITS.hookDisplay },
        tts: { type: 'string', minLength: 1, maxLength: LIMITS.hookTts } },
    },
    product_presentations: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['product_set_item_id', 'presentation_order', 'display_name', 'short_appeal', 'fact_badge', 'tts', 'verified_fact_ref'],
        properties: {
          product_set_item_id: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
          presentation_order: { type: 'integer', minimum: 1, maximum: 3 },
          display_name: { type: 'string', minLength: 1, maxLength: LIMITS.displayName },
          short_appeal: { type: 'string', minLength: 1, maxLength: LIMITS.shortAppeal },
          fact_badge: { type: 'string', minLength: 1, maxLength: LIMITS.factBadge },
          tts: { type: 'string', minLength: 1, maxLength: LIMITS.productTts },
          verified_fact_ref: { type: 'string', minLength: 1, maxLength: 160 },
        },
      },
    },
    cta: {
      type: 'object', additionalProperties: false, required: ['display_text', 'tts'],
      properties: { display_text: { type: 'string', minLength: 1, maxLength: LIMITS.ctaDisplay },
        tts: { type: 'string', minLength: 1, maxLength: LIMITS.ctaTts } },
    },
  },
}

class ThreePicksV2ValidationError extends Error {
  constructor(code, message, fieldPath = null) {
    super(message); this.name = 'ThreePicksV2ValidationError'; this.code = code; this.fieldPath = fieldPath
  }
}

const RANKING_PATTERN = /(?:ランキング|順位|第\s*[一二三123]\s*位|[一二三123]\s*位|best\s*(?:one|two|three|[123])|top\s*[123]|rank(?:ed|ing)?)/iu
const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const length = value => Array.from(compact(value)).length

function bounded(value, max, path) {
  const text = compact(value)
  if (!text || length(text) > max) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_TEXT_LIMIT', `Text must contain 1-${max} characters`, path)
  if (RANKING_PATTERN.test(text.normalize('NFKC'))) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_RANKING_LANGUAGE', 'Ranking language is prohibited', path)
  return text
}

function narrationSegments(scope, value) {
  const text = compact(value)
  if (!text) return []
  const phrases = text.match(/[^。！？!?、,]+[。！？!?、,]?/gu) || [text]
  const chunks = []
  for (const phraseValue of phrases) {
    let phrase = phraseValue.trim()
    while (Array.from(phrase).length > LIMITS.segment) {
      const chars = Array.from(phrase)
      chunks.push(chars.slice(0, LIMITS.segment).join(''))
      phrase = chars.slice(LIMITS.segment).join('').trim()
    }
    if (phrase) chunks.push(phrase)
  }
  return chunks.map((segmentText, index) => ({ segment_id: `${scope}-${index + 1}`, segment_order: index + 1, text: segmentText }))
}

function validateThreePicksV2Output(output, input) {
  if (!output || output.archetype !== ARCHETYPE || !Array.isArray(output.product_presentations)
    || output.product_presentations.length !== 3) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_INVALID_OUTPUT', 'Exactly three product presentations are required', '$.product_presentations')
  }
  bounded(output.theme, 48, '$.theme')
  bounded(output.hook?.display_text, LIMITS.hookDisplay, '$.hook.display_text')
  bounded(output.hook?.tts, LIMITS.hookTts, '$.hook.tts')
  bounded(output.cta?.display_text, LIMITS.ctaDisplay, '$.cta.display_text')
  bounded(output.cta?.tts, LIMITS.ctaTts, '$.cta.tts')
  const source = Array.isArray(input?.products) ? input.products : []
  if (source.length !== 3) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_INVALID_INPUT', 'Exactly three products are required', '$input.products')
  const byId = new Map(source.map(product => [product.product_set_item_id, product]))
  const ids = new Set(); const orders = new Set()
  output.product_presentations.forEach((item, index) => {
    const path = `$.product_presentations[${index}]`; const product = byId.get(item.product_set_item_id)
    if (!product || ids.has(item.product_set_item_id)) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_PRODUCT_MISMATCH', 'Product identity is missing or duplicated', `${path}.product_set_item_id`)
    if (![1, 2, 3].includes(item.presentation_order) || orders.has(item.presentation_order)) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_ORDER_INVALID', 'Presentation order must be unique', `${path}.presentation_order`)
    if (item.presentation_order !== product.presentation_order) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_ORDER_CHANGED', 'Presentation order changed frozen input', `${path}.presentation_order`)
    if (item.display_name !== product.display_name || item.fact_badge !== product.fact_badge) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_DISPLAY_EVIDENCE_MISMATCH', 'Display evidence changed frozen input', path)
    if (!product.allowed_verified_fact_refs?.includes(item.verified_fact_ref)) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_UNVERIFIED_FACT', 'Verified fact reference is not allowed', `${path}.verified_fact_ref`)
    bounded(item.display_name, LIMITS.displayName, `${path}.display_name`)
    bounded(item.short_appeal, LIMITS.shortAppeal, `${path}.short_appeal`)
    bounded(item.fact_badge, LIMITS.factBadge, `${path}.fact_badge`)
    bounded(item.tts, LIMITS.productTts, `${path}.tts`)
    ids.add(item.product_set_item_id); orders.add(item.presentation_order)
  })
  return output
}

function planNarrationSegments(plan) {
  return [
    ...narrationSegments('hook', plan.hook.tts).map(item => ({ ...item, scene: 'hook' })),
    ...[...plan.product_presentations].sort((a, b) => a.presentation_order - b.presentation_order)
      .flatMap(item => narrationSegments(`product-${item.presentation_order}`, item.tts)
        .map(segment => ({ ...segment, scene: `product-${item.presentation_order}`, product_set_item_id: item.product_set_item_id }))),
    ...narrationSegments('cta', plan.cta.tts).map(item => ({ ...item, scene: 'cta' })),
  ]
}

module.exports = { ARCHETYPE, DEFAULT_MODEL, LAYOUT_ID, LIMITS, MANIFEST_VERSION, PROMPT_VERSION,
  SCHEMA_VERSION, SYSTEM_PROMPT, TEMPLATE_ID, THREE_PICKS_V2_JSON_SCHEMA,
  ThreePicksV2ValidationError, narrationSegments, planNarrationSegments, validateThreePicksV2Output }
