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
For every product return identity_anchor copied from source_product_name, 1-3 evidence_candidate_ids copied from selected fact_candidates, and matching evidence_anchors copied exactly from those candidates. Every appeal, badge, and narration must be supported by the explicitly selected candidates. Never use image text as evidence.
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
        'tts', 'verified_fact_ref', 'identity_anchor', 'evidence_candidate_ids', 'evidence_anchors'], properties: {
        product_set_item_id: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
        presentation_order: { type: 'integer', minimum: 1, maximum: 3 },
        display_name: { type: 'string', minLength: 4, maxLength: LIMITS.displayName },
        short_appeal: { type: 'string', minLength: 8, maxLength: LIMITS.shortAppeal },
        fact_badge: { type: 'string', minLength: 3, maxLength: LIMITS.factBadge },
        tts: { type: 'string', minLength: 12, maxLength: LIMITS.productTts },
        verified_fact_ref: { type: 'string', minLength: 1, maxLength: 160 },
        identity_anchor: { type: 'string', minLength: 2, maxLength: 80 },
        evidence_candidate_ids: { type: 'array', minItems: 1, maxItems: 3,
          items: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,80}$' } },
        evidence_anchors: { type: 'array', minItems: 1, maxItems: 3,
          items: { type: 'string', minLength: 2, maxLength: 80 } } } } },
    cta: { type: 'object', additionalProperties: false, required: ['display_text', 'tts'], properties: {
      display_text: { type: 'string', minLength: 1, maxLength: LIMITS.ctaDisplay },
      tts: { type: 'string', minLength: 1, maxLength: LIMITS.ctaTts } } },
  } }

const SAFE_VALIDATION_REASONS = Object.freeze({
  THREE_PICKS_V2_INVALID_OUTPUT: 'planner output does not contain exactly three product presentations',
  THREE_PICKS_V2_TEXT_LIMIT: 'text is outside the allowed length',
  THREE_PICKS_V2_RANKING_LANGUAGE: 'ranking language is prohibited',
  THREE_PICKS_V2_INCOMPLETE_COPY: 'copy is not a complete Japanese phrase',
  THREE_PICKS_V2_EVIDENCE_ANCHOR_INVALID: 'evidence anchor is not present in selected verified candidates',
  THREE_PICKS_V2_UNGROUNDED_CLAIM: 'claim is not supported by selected evidence candidates',
  THREE_PICKS_V2_HOOK_SEGMENT_COUNT: 'hook narration must produce exactly one segment',
  THREE_PICKS_V2_CTA_DESTINATION_REQUIRED: 'CTA does not identify the description destination',
  THREE_PICKS_V2_INVALID_INPUT: 'planner input does not contain exactly three products',
  THREE_PICKS_V2_PRODUCT_MISMATCH: 'product identity is missing or duplicated',
  THREE_PICKS_V2_ORDER_INVALID: 'presentation order is invalid or duplicated',
  THREE_PICKS_V2_ORDER_CHANGED: 'presentation order differs from frozen input',
  THREE_PICKS_V2_UNVERIFIED_FACT: 'verified fact reference is not allowed',
  THREE_PICKS_V2_PROMOTIONAL_COPY: 'promotional authority language is prohibited',
  THREE_PICKS_V2_TTS_DUPLICATES_DISPLAY: 'narration duplicates on-screen copy',
})

function productIndexFromPath(fieldPath) {
  const match = String(fieldPath || '').match(/^\$\.product_presentations\[([0-2])\](?:\.|$)/u)
  return match ? Number(match[1]) + 1 : null
}

const safeFieldPreview = value => Array.from(compact(value).replace(/[\u0000-\u001f\u007f]/gu, ' ')).slice(0, 100).join('').trim()
const safeEvidenceCandidateIds = value => [...new Set((Array.isArray(value) ? value : [])
  .filter(candidateId => /^[A-Za-z0-9_.:-]{1,80}$/u.test(candidateId)))].slice(0, 3)

class ThreePicksV2ValidationError extends Error {
  constructor(code, message, fieldPath = null, { productIndex = null, reason = null,
    fieldValuePreview = null, evidenceCandidateIds = [] } = {}) {
    super(message); this.name = 'ThreePicksV2ValidationError'; this.code = code; this.fieldPath = fieldPath
    const safeProductIndex = productIndex ?? productIndexFromPath(fieldPath)
    const safeReason = reason || SAFE_VALIDATION_REASONS[code] || 'schema-v4 validation failed'
    this.productIndex = safeProductIndex; this.reason = safeReason
    this.product_index = safeProductIndex; this.field_path = fieldPath
    this.fieldValuePreview = safeFieldPreview(fieldValuePreview)
    this.evidenceCandidateIds = safeEvidenceCandidateIds(evidenceCandidateIds)
    this.refreshSafeDiagnostics()
  }

  refreshSafeDiagnostics() {
    this.safeDiagnostics = { code: this.code, product_index: this.productIndex,
      field_path: this.fieldPath, reason: this.reason }
    if (this.fieldValuePreview) this.safeDiagnostics.field_value_preview = this.fieldValuePreview
    if (this.evidenceCandidateIds.length > 0) this.safeDiagnostics.evidence_candidate_ids = this.evidenceCandidateIds
  }

  withSafeContext(fieldValue, evidenceCandidateIds) {
    if (!this.fieldValuePreview) this.fieldValuePreview = safeFieldPreview(fieldValue)
    if (this.evidenceCandidateIds.length === 0) this.evidenceCandidateIds = safeEvidenceCandidateIds(evidenceCandidateIds)
    this.refreshSafeDiagnostics(); return this
  }
}

const RANKING_PATTERN = /(?:ランキング|順位|第\s*[一二三123]\s*位|[一二三123]\s*位|best\s*(?:one|two|three|[123])|top\s*[123]|rank(?:ed|ing)?)/iu
const PROMOTIONAL_PATTERN = /(?:業界最大級|業界初|最高級|最上級|権威|監修|公認|No\.?\s*1)/iu
const UNSUPPORTED_FEATURE_PATTERN = /(?:自動(?:開閉|点灯)?|充電(?:式)?|防水|防滴|抗菌|消臭|急速|ワイヤレス|回転|調整|大容量|最強|高性能|耐熱|防火|省電力)/gu
const EXPLICIT_HARD_FACT_PATTERN = /(?:アルミニウム製?|アルミ製?|ステンレス製?|スチール製?|鋼製|鉄製|樹脂製|ABS樹脂|シリコン製?|木製|ガラス製|カーボン製?)/giu
const IDENTITY_MODEL_PATTERN = /(?:\d|^[a-z][a-z\d_.-]*$)/iu
const IDENTITY_MERCHANT_PATTERN = /(?:公式|正規)?(?:ショップ|ストア|商店|販売店|ブランド|セレクト)$/iu
const IDENTITY_FEATURE_PATTERN = /(?:led|usb|磁石|マグネット|ライト|折りたたみ|給電|防水|強力|高性能|便利)$/iu
const IDENTITY_CONCEPTS = Object.freeze([
  ['waste-container', ['ゴミ箱', 'ごみ箱', 'ダストボックス', 'くず入れ', 'ゴミ入れ']],
  ['smartphone', ['スマートフォン', 'スマホ', '携帯電話']],
  ['holder', ['ホルダー', 'マウント', 'スタンド']],
  ['aroma', ['アロマ', '芳香剤', 'フレグランス']],
  ['diffuser', ['ディフューザー', 'ディフューザ']],
  ['charger', ['ワイヤレス充電器', '充電器', 'チャージャー']],
])
const compact = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
const length = value => Array.from(compact(value)).length

function bounded(value, minimum, maximum, path) {
  const text = compact(value)
  if (!text || length(text) < minimum || length(text) > maximum) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_TEXT_LIMIT', `Text must contain ${minimum}-${maximum} characters`, path,
      { fieldValuePreview: text })
  }
  if (RANKING_PATTERN.test(text)) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_RANKING_LANGUAGE', 'Ranking language is prohibited', path,
    { fieldValuePreview: text })
  return text
}

function assertCompletePhrase(value, path) {
  const text = compact(value); const pairs = [['（', '）'], ['(', ')'], ['「', '」'], ['『', '』'], ['【', '】'], ['[', ']']]
  if (pairs.some(([open, close]) => Array.from(text).filter(char => char === open).length !== Array.from(text).filter(char => char === close).length)
    || /(?:[、,・\/]|(?:から|まで|より|ので|ため|こと|もの|付きの|式の))$/u.test(text)) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_INCOMPLETE_COPY', 'Copy must be a complete Japanese phrase', path,
      { fieldValuePreview: text })
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
const normalizeFactLiteral = value => normalizeForEvidence(value).replace(/(\d+[本個枚台回])で(?=約?\d)/gu, '$1')
const structuredTokens = value => compact(value).match(/[A-Za-z]+\d*|\d+(?:\.\d+)?/gu) || []
const normalizeIdentityText = value => compact(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function identityDescriptor(value) {
  const normalized = normalizeIdentityText(value); const joined = normalized.replace(/\s+/gu, '')
  const concepts = new Set(IDENTITY_CONCEPTS
    .filter(([, aliases]) => aliases.some(alias => joined.includes(normalizeIdentityText(alias).replace(/\s+/gu, ''))))
    .map(([concept]) => concept))
  const tokens = normalized.split(/\s+/u).map(token => token
    .replace(/^(?:自動車用|車載|車用|カー)/u, '')
    .replace(/(?:専用|用品|商品|アイテム|グッズ|タイプ|モデル|本体|セット|用|式)$/u, ''))
    .filter(token => Array.from(token).length >= 2
      && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token)
      && !IDENTITY_MODEL_PATTERN.test(token) && !IDENTITY_MERCHANT_PATTERN.test(token)
      && !IDENTITY_FEATURE_PATTERN.test(token))
  return { concepts, joined, tokens }
}

function compatibleIdentity(anchor, displayName) {
  const anchorIdentity = identityDescriptor(anchor); const displayIdentity = identityDescriptor(displayName)
  if (anchorIdentity.concepts.size > 0) {
    return [...anchorIdentity.concepts].every(concept => displayIdentity.concepts.has(concept))
  }
  if (anchorIdentity.tokens.length === 0) return false
  return anchorIdentity.tokens.some(token => displayIdentity.joined.includes(token)
    || displayIdentity.tokens.some(displayToken => token.includes(displayToken) && Array.from(displayToken).length >= 2))
}

const PARAPHRASE_CONCEPTS = Object.freeze([
  ['night', /(?:夜間|夜|暗闇|暗い車内)/gu],
  ['usable', /(?:問題なく(?:ご)?使用(?:頂け|でき)|使用でき|使いやす|使え)/gu],
  ['light', /(?:LEDライト|LED|ライトがつく|ライト|点灯)/giu],
  ['smartphone', /(?:スマートフォン|スマホ|携帯電話)/gu],
  ['rough-road', /(?:悪路|振動|揺れ)/gu],
  ['strong-hold', /(?:ガッチリ|しっかり|強力)/gu],
  ['magnet', /(?:磁石|マグネット)/gu],
  ['fix', /(?:固定|保持|ホールド|離さ(?:ない|ず)|離れにくい)/gu],
  ['choose', /(?:選べ|選ぶ|選択)/gu],
  ['fragrance', /(?:香り|アロマ|フレグランス)/gu],
])

function paraphraseConcepts(value) {
  const text = compact(value)
  return new Set(PARAPHRASE_CONCEPTS.filter(([, pattern]) => { pattern.lastIndex = 0; return pattern.test(text) })
    .map(([concept]) => concept))
}

function selectedEvidenceCandidates(item, product, path) {
  const ids = Array.isArray(item.evidence_candidate_ids) ? item.evidence_candidate_ids : []
  const safeIds = safeEvidenceCandidateIds(ids)
  if (ids.length < 1 || ids.length > 3 || safeIds.length !== ids.length) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_EVIDENCE_ANCHOR_INVALID',
      'Evidence candidate IDs must identify one to three verified candidates', `${path}.evidence_candidate_ids`)
  }
  const candidates = (product.fact_candidates || []).filter(candidate => candidate.verified_fact_ref === item.verified_fact_ref)
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const selected = safeIds.map(candidateId => byId.get(candidateId))
  if (selected.some(candidate => !candidate)) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_EVIDENCE_ANCHOR_INVALID',
      'Evidence candidate ID is not present in selected verified candidates', `${path}.evidence_candidate_ids`)
  }
  return selected
}

function paraphraseIsGrounded(value, candidates) {
  const claim = compact(value); const evidence = candidates.map(candidate => compact(candidate.text)).join(' ')
  const normalizedEvidence = normalizeForEvidence(evidence)
  if (structuredTokens(claim).some(token => !normalizedEvidence.includes(normalizeForEvidence(token)))) return false
  const explicitHardFacts = claim.match(EXPLICIT_HARD_FACT_PATTERN) || []
  if (explicitHardFacts.some(fact => !normalizedEvidence.includes(normalizeForEvidence(fact)))) return false
  const unsupportedFeatures = claim.match(UNSUPPORTED_FEATURE_PATTERN) || []
  if (unsupportedFeatures.some(feature => !normalizedEvidence.includes(normalizeForEvidence(feature)))) return false
  const claimConcepts = paraphraseConcepts(claim); const evidenceConcepts = paraphraseConcepts(evidence)
  if (/(?:種類|選択肢)/u.test(evidence)) evidenceConcepts.add('choose')
  const directGrounding = candidates.some(candidate => {
    const normalizedCandidate = normalizeForEvidence(candidate.text)
    return normalizedCandidate.length >= 2
      && (normalizeForEvidence(claim).includes(normalizedCandidate) || normalizedCandidate.includes(normalizeForEvidence(claim)))
  })
  return directGrounding || (claimConcepts.size > 0 && [...claimConcepts].every(concept => evidenceConcepts.has(concept)))
}

function validateGroundedPresentation(item, product, path, productIndex) {
  const sourceName = normalizeForEvidence(product.source_product_name); const identityAnchor = normalizeForEvidence(item.identity_anchor)
  const displayName = normalizeForEvidence(item.display_name)
  const identityField = `${path}.display_name`
  let identityReason = null
  if (identityAnchor.length < 2 || !sourceName.includes(identityAnchor)) identityReason = 'identity anchor is not grounded in source product name'
  else if (displayName === sourceName) identityReason = 'display name must not copy the formal product title'
  else if (identityDescriptor(item.identity_anchor).concepts.size === 0
    && identityDescriptor(item.identity_anchor).tokens.length === 0) identityReason = 'identity anchor has no distinctive category token'
  else if (!compatibleIdentity(item.identity_anchor, item.display_name)) identityReason = 'no compatible identity token found'
  if (identityReason) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_IDENTITY_CHANGED',
      'Display identity is not compatible with the frozen product lineage', identityField,
      { productIndex, reason: identityReason })
  }
  const selectedCandidates = selectedEvidenceCandidates(item, product, path)
  const selectedCandidateIds = selectedCandidates.map(candidate => candidate.id)
  const selectedEvidenceText = normalizeForEvidence(selectedCandidates.map(candidate => candidate.text).join(' '))
  const anchors = Array.isArray(item.evidence_anchors) ? item.evidence_anchors.map(compact) : []
  if (anchors.length < 1 || anchors.length > 3 || new Set(anchors).size !== anchors.length
    || anchors.some(anchor => !selectedEvidenceText.includes(normalizeForEvidence(anchor)))) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_EVIDENCE_ANCHOR_INVALID', 'Evidence anchors must be copied from verified fact candidates', `${path}.evidence_anchors`)
  }
  for (const [field, value] of [['short_appeal', item.short_appeal], ['tts', item.tts]]) {
    if (!paraphraseIsGrounded(value, selectedCandidates)) {
      throw new ThreePicksV2ValidationError('THREE_PICKS_V2_UNGROUNDED_CLAIM', 'Copy must be grounded in verified evidence', `${path}.${field}`)
    }
  }
  if (!selectedCandidates.some(candidate => normalizeFactLiteral(candidate.text).includes(normalizeFactLiteral(item.fact_badge)))) {
    throw new ThreePicksV2ValidationError('THREE_PICKS_V2_UNGROUNDED_CLAIM', 'Fact badge must be a verified fact substring', `${path}.fact_badge`)
  }
  return selectedCandidateIds
}

function validateThreePicksV2Output(output, input) {
  if (!output || output.archetype !== ARCHETYPE || !Array.isArray(output.product_presentations)
    || output.product_presentations.length !== 3) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_INVALID_OUTPUT', 'Exactly three product presentations are required', '$.product_presentations')
  bounded(output.theme, 1, 48, '$.theme'); bounded(output.hook?.display_text, 1, LIMITS.hookDisplay, '$.hook.display_text')
  const hookTts = bounded(output.hook?.tts, 1, LIMITS.hookTts, '$.hook.tts')
  if (narrationSegments('hook', hookTts).length !== 1) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_HOOK_SEGMENT_COUNT', 'Hook narration must produce exactly one narration segment', '$.hook.tts',
    { fieldValuePreview: hookTts })
  const ctaDisplay = bounded(output.cta?.display_text, 1, LIMITS.ctaDisplay, '$.cta.display_text')
  const ctaTts = bounded(output.cta?.tts, 1, LIMITS.ctaTts, '$.cta.tts')
  if (!ctaDisplay.includes('概要欄') || !ctaTts.includes('概要欄')) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_CTA_DESTINATION_REQUIRED', 'CTA must identify the description destination', '$.cta',
    { fieldValuePreview: `${ctaDisplay} / ${ctaTts}` })
  const source = Array.isArray(input?.products) ? input.products : []
  if (source.length !== 3) throw new ThreePicksV2ValidationError('THREE_PICKS_V2_INVALID_INPUT', 'Exactly three products are required', '$input.products')
  const byId = new Map(source.map(product => [product.product_set_item_id, product])); const ids = new Set(); const orders = new Set()
  output.product_presentations.forEach((item, index) => {
    const path = `$.product_presentations[${index}]`; const product = byId.get(item.product_set_item_id)
    try {
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
      validateGroundedPresentation(item, product, path, index + 1); ids.add(item.product_set_item_id); orders.add(item.presentation_order)
    } catch (error) {
      if (!(error instanceof ThreePicksV2ValidationError)) throw error
      const fieldName = String(error.fieldPath || '').match(/\.([a-z_]+)$/u)?.[1]
      throw error.withSafeContext(fieldName ? item[fieldName] : null, item.evidence_candidate_ids)
    }
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
  LIMITS, MANIFEST_VERSION, PROMPT_VERSION, SAFE_VALIDATION_REASONS, SCHEMA_VERSION, SYSTEM_PROMPT, TEMPLATE_ID,
  THREE_PICKS_V2_JSON_SCHEMA, ThreePicksV2ValidationError, narrationSegments, planNarrationSegments,
  validateThreePicksV2Output }
