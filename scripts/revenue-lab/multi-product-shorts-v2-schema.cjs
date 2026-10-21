'use strict'

const ARCHETYPE = 'three_picks_v2'
const PROMPT_VERSION = 'three-picks-production-planner-v3'
const SCHEMA_VERSION = 'multi-product-shorts-plan-v4'
const DEFAULT_MODEL = 'gpt-5-mini'
const TEMPLATE_ID = 'hero-carousel-v2'
const LAYOUT_ID = 'hero-product-layout-v2'
const MANIFEST_VERSION = 'three-picks-composition-manifest-v3'
const LEGACY_LAYOUT_ID = 'hero-product-layout-v1'
const LEGACY_MANIFEST_VERSION = 'three-picks-composition-manifest-v2'
const LIMITS = Object.freeze({ hookDisplay: 14, hookTts: 14, displayName: 14, shortAppeal: 22,
  factBadge: 12, productTts: 40, ctaDisplay: 18, ctaTts: 40, segment: 42 })

const SYSTEM_PROMPT = `Create natural Japanese copy for a three-product YouTube Short from frozen verified evidence.
The server fixes the template. Do not output coordinates, durations, effects, providers, rankings, prices, reviews, or URLs.
Translate commerce titles into video copy: display_name is a 4-14 character category identity, short_appeal is one complete 8-22 character benefit, fact_badge is one 3-12 character verified fact, and product tts is one natural 12-40 character sentence.
Do not copy the formal commerce title, merchant name, promotional authority language, or unnecessary model numbers. Keep meaningful evidence tokens such as LED, USB, and N56 only when supported.
For every product return identity_anchor copied from source_product_name and 1-3 evidence_anchors copied exactly from the selected fact_candidates. Every appeal, badge, and narration must be supported by those anchors. Never use image text as evidence.
Hook display and narration must express the shared theme and remain at most 14 characters. Do not put product descriptions or lists in the Hook narration. It must produce one segment targeting 3-4.5 seconds of measured speech.
CTA must explicitly send viewers to the description, normally 気になる商品は概要欄へ. Never invent or alter product identity or facts.`

const THREE_PICKS_V2_JSON_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['archetype', 'theme', 'hook', 'product_presentations', 'cta'], properties: {
    archetype: { type: 'string', const: ARCHETYPE }, theme: { type: 'string', minLength: 1, maxLength: 48 },
    hook: { type: 'object', additionalProperties: false, required: ['display_text', 'tts'], properties: {
      display_text: { type: 'string', minLength: 1, maxLength: LIMITS.hookDisplay },
      tts: { type: 'string', minLength: 1, maxLength: LIMITS.hookTts } } },
    product_presentations: { type: 'array', minItems: 3, maxItems: 3, items: {
      type: 'object', additionalProperties: false,
      required: ['product_set_item_id', 'presentation_order', 'display_name', 'short_appeal', 'fact_badge',
        'tts', 'verified_fact_ref', 'identity_anchor', 'evidence_anchors'], properties: {
        product_set_item_id: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
        presentation_order: { type: 'integer', minimum: 1, maximum: 3 },
        display_name: { type: 'string', minLength: 4, maxLength: LIMITS.displayName },
        short_appeal: { type: 'string', minLength: 8, maxLength: LIMITS.shortAppeal },
        fact_badge: { type: 'string', minLength: 3, maxLength: LIMITS.factBadge },
        tts: { type: 'string', minLength: 12, maxLength: LIMITS.productTts },
        verified_fact_ref: { type: 'string', minLength: 1, maxLength: 160 },
        identity_anchor: { type: 'string', minLength: 2, maxLength: 80 },
        evidence_anchors: { type: 'array', minItems: 1, maxItems: 3,
          items: { type: 'string', minLength: 2, maxLength: 80 } } } } },
    cta: { type: 'object', additionalProperties: false, required: ['display_text', 'tts'], properties: {
      display_text: { type: 'string', minLength: 1, maxLength: LIMITS.ctaDisplay },
      tts: { type: 'string', minLength: 1, maxLength: LIMITS.ctaTts } } },
  } }

class ThreePicksV2ValidationError extends Error {
  constructor(code, message, fieldPath = null) {
    super(message); this.name = 'ThreePicksV2ValidationError'; this.code = code; this.fieldPath = fieldPath
  }
}

const RANKING_PATTERN = /(?:ランキング|順位|第\s*[一二三123]\s*位|[一二三123]\s*位|best\s*(?:one|two|three|[123])|top\s*[123]|rank(?:ed|ing)?)/iu
const PROMOTIONAL_PATTERN = /(?:業界最大級|業界初|最高級|最上級|権威|監修|公認|No\.?\s*1)/iu
const compact = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
const length = value => Array.from(compact(value)).length

function bounded(value, minimum, maximum, path) {
  const text = compact(value)
  if (!text || length(text) < minimum || length(text) > maximum) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_TEXT_LIMIT', `Text must contain ${minimum}-${maximum} characters`, path)
  }
  if (RANKING_PATTERN.test(text)) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_RANKING_LANGUAGE', 'Ranking language is prohibited', path)
  return text
}

function assertCompletePhrase(value, path) {
  const text = compact(value); const pairs = [['（', '）'], ['(', ')'], ['「', '」'], ['『', '』'], ['【', '】'], ['[', ']']]
  if (pairs.some(([open, close]) => Array.from(text).filter(char => char === open).length !== Array.from(text).filter(char => char === close).length)
    || /(?:[、,・\/]|(?:から|まで|より|ので|ため|こと|もの|付きの|式の))$/u.test(text)) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_INCOMPLETE_COPY', 'Copy must be a complete Japanese phrase', path)
  }
}

function narrationSegments(scope, value) {
  const text = compact(value); if (!text) return []
  const phrases = text.match(/[^。！？!?、,]+[。！？!?、,]?/gu) || [text]; const chunks = []
  for (const phraseValue of phrases) {
    let phrase = phraseValue.trim()
    while (Array.from(phrase).length > LIMITS.segment) {
      const chars = Array.from(phrase); chunks.push(chars.slice(0, LIMITS.segment).join('')); phrase = chars.slice(LIMITS.segment).join('').trim()
    }
    if (phrase) chunks.push(phrase)
  }
  return chunks.map((textValue, index) => ({ segment_id: `${scope}-${index + 1}`, segment_order: index + 1, text: textValue }))
}

const normalizeForEvidence = value => compact(value).replace(/[\s。、，,.・「」『』【】（）()\[\]]/gu, '').toLowerCase()
const structuredTokens = value => compact(value).match(/[A-Za-z]+\d*|\d+(?:\.\d+)?/gu) || []
function isAnchored(text, anchors) {
  const normalized = normalizeForEvidence(text)
  return anchors.some(anchor => { const candidate = normalizeForEvidence(anchor)
    return candidate.length >= 2 && (normalized.includes(candidate) || candidate.includes(normalized)) })
}

function validateGroundedPresentation(item, product, path) {
  const candidates = (product.fact_candidates || []).filter(candidate => candidate.verified_fact_ref === item.verified_fact_ref)
  const evidenceText = normalizeForEvidence(candidates.map(candidate => candidate.text).join(' '))
  const sourceName = normalizeForEvidence(product.source_product_name); const identityAnchor = normalizeForEvidence(item.identity_anchor)
  const displayName = normalizeForEvidence(item.display_name)
  if (identityAnchor.length < 2 || !sourceName.includes(identityAnchor)
    || !(displayName.includes(identityAnchor) || identityAnchor.includes(displayName)) || displayName === sourceName) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_IDENTITY_CHANGED', 'Display identity is not grounded in the product title', `${path}.display_name`)
  }
  const anchors = Array.isArray(item.evidence_anchors) ? item.evidence_anchors.map(compact) : []
  if (anchors.length < 1 || anchors.length > 3 || anchors.some(anchor => !evidenceText.includes(normalizeForEvidence(anchor)))) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_EVIDENCE_ANCHOR_INVALID', 'Evidence anchors must be copied from verified fact candidates', `${path}.evidence_anchors`)
  }
  for (const [field, value] of [['short_appeal', item.short_appeal], ['fact_badge', item.fact_badge], ['tts', item.tts]]) {
    if (!isAnchored(value, anchors) || structuredTokens(value).some(token => !evidenceText.includes(normalizeForEvidence(token)))) {
      throw new ThreePicksV2ValidationError('THREE_PICKS_V2_UNGROUNDED_CLAIM', 'Copy must be grounded in verified evidence', `${path}.${field}`)
    }
  }
  if (!candidates.some(candidate => normalizeForEvidence(candidate.text).includes(normalizeForEvidence(item.fact_badge)))) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_UNGROUNDED_CLAIM', 'Fact badge must be a verified fact substring', `${path}.fact_badge`)
  }
}

function validateThreePicksV2Output(output, input) {
  if (!output || output.archetype !== ARCHETYPE || !Array.isArray(output.product_presentations)
    || output.product_presentations.length !== 3) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_INVALID_OUTPUT', 'Exactly three product presentations are required', '$.product_presentations')
  bounded(output.theme, 1, 48, '$.theme'); bounded(output.hook?.display_text, 1, LIMITS.hookDisplay, '$.hook.display_text')
  const hookTts = bounded(output.hook?.tts, 1, LIMITS.hookTts, '$.hook.tts')
  if (narrationSegments('hook', hookTts).length !== 1) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_HOOK_SEGMENT_COUNT', 'Hook narration must produce exactly one narration segment', '$.hook.tts')
  const ctaDisplay = bounded(output.cta?.display_text, 1, LIMITS.ctaDisplay, '$.cta.display_text')
  const ctaTts = bounded(output.cta?.tts, 1, LIMITS.ctaTts, '$.cta.tts')
  if (!ctaDisplay.includes('概要欄') || !ctaTts.includes('概要欄')) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_CTA_DESTINATION_REQUIRED', 'CTA must identify the description destination', '$.cta')
  const source = Array.isArray(input?.products) ? input.products : []
  if (source.length !== 3) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_INVALID_INPUT', 'Exactly three products are required', '$input.products')
  const byId = new Map(source.map(product => [product.product_set_item_id, product])); const ids = new Set(); const orders = new Set()
  output.product_presentations.forEach((item, index) => {
    const path = `$.product_presentations[${index}]`; const product = byId.get(item.product_set_item_id)
    if (!product || ids.has(item.product_set_item_id)) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_PRODUCT_MISMATCH', 'Product identity is missing or duplicated', `${path}.product_set_item_id`)
    if (![1, 2, 3].includes(item.presentation_order) || orders.has(item.presentation_order)) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_ORDER_INVALID', 'Presentation order must be unique', `${path}.presentation_order`)
    if (item.presentation_order !== product.presentation_order) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_ORDER_CHANGED', 'Presentation order changed frozen input', `${path}.presentation_order`)
    if (!product.allowed_verified_fact_refs?.includes(item.verified_fact_ref)) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_UNVERIFIED_FACT', 'Verified fact reference is not allowed', `${path}.verified_fact_ref`)
    bounded(item.display_name, 4, LIMITS.displayName, `${path}.display_name`); bounded(item.short_appeal, 8, LIMITS.shortAppeal, `${path}.short_appeal`)
    bounded(item.fact_badge, 3, LIMITS.factBadge, `${path}.fact_badge`); bounded(item.tts, 12, LIMITS.productTts, `${path}.tts`)
    ;[item.display_name, item.short_appeal, item.fact_badge, item.tts].forEach((value, fieldIndex) => assertCompletePhrase(value, `${path}.${['display_name', 'short_appeal', 'fact_badge', 'tts'][fieldIndex]}`))
    if (PROMOTIONAL_PATTERN.test(`${item.display_name} ${item.fact_badge}`)) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_PROMOTIONAL_COPY', 'Promotional authority language is prohibited', path)
    if ([item.display_name, item.short_appeal, item.fact_badge].some(value => normalizeForEvidence(value) === normalizeForEvidence(item.tts))) {
      throw new ThreePicksV2ValidationError('THREE_PICKS_V2_TTS_DUPLICATES_DISPLAY', 'Narration must not repeat on-screen copy verbatim', `${path}.tts`)
    }
    validateGroundedPresentation(item, product, path); ids.add(item.product_set_item_id); orders.add(item.presentation_order)
  })
  return output
}

function planNarrationSegments(plan) {
  return [...narrationSegments('hook', plan.hook.tts).map(item => ({ ...item, scene: 'hook' })),
    ...[...plan.product_presentations].sort((a, b) => a.presentation_order - b.presentation_order)
      .flatMap(item => narrationSegments(`product-${item.presentation_order}`, item.tts)
        .map(segment => ({ ...segment, scene: `product-${item.presentation_order}`, product_set_item_id: item.product_set_item_id }))),
    ...narrationSegments('cta', plan.cta.tts).map(item => ({ ...item, scene: 'cta' }))]
}

module.exports = { ARCHETYPE, DEFAULT_MODEL, LAYOUT_ID, LEGACY_LAYOUT_ID, LEGACY_MANIFEST_VERSION,
  LIMITS, MANIFEST_VERSION, PROMPT_VERSION, SCHEMA_VERSION, SYSTEM_PROMPT, TEMPLATE_ID,
  THREE_PICKS_V2_JSON_SCHEMA, ThreePicksV2ValidationError, narrationSegments, planNarrationSegments,
  validateThreePicksV2Output }
