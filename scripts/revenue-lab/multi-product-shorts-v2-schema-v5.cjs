'use strict'

const legacy = require('./multi-product-shorts-v2-schema.cjs')

const { ARCHETYPE, DEFAULT_MODEL, LAYOUT_ID, LEGACY_LAYOUT_ID, LEGACY_MANIFEST_VERSION,
  LIMITS, MANIFEST_VERSION, TEMPLATE_ID, narrationSegments, planNarrationSegments } = legacy
const PROMPT_VERSION = 'three-picks-production-planner-v4'
const SCHEMA_VERSION = 'multi-product-shorts-plan-v5'

const SYSTEM_PROMPT = `Create natural Japanese soft copy for a three-product YouTube Short from the supplied frozen evidence.
The server fixes the template and deterministically formats product identities and fact badges. Select identity_id exactly from that product's identity_candidates[].identity_id and fact_id exactly from that product's selectable_facts[].fact_id. Never output display_name or fact_badge.
fact_candidates[].id values are evidence candidate IDs for soft-copy grounding only. Never use a fact_candidates[].id as fact_id. selectable_facts[].source_candidate_id is lineage metadata, not a selectable fact_id.
Generate only the shared Hook, one short_appeal and one product tts per product, and the CTA. For each product, cite one to three existing evidence candidate IDs separately for short_appeal and tts.
Material conditions and qualifiers attached to quantitative facts must not be omitted. Preserve usage-per-day, usage-count, environment, maximum/minimum, estimate, and approximation qualifiers exactly; never add an approximation that is absent from the source fact.
Do not invent numbers, models, grades, materials, quantities, interfaces, functions, or other hard specifications. Soft copy may paraphrase or omit concepts from the selected evidence but may not add a new product claim. Never use image text as evidence.
Hook display and narration must express the shared theme, contain no product hard fact, and remain at most 14 characters. CTA must explicitly send viewers to the description, normally 気になる商品は概要欄へ. Do not output coordinates, durations, effects, providers, rankings, prices, reviews, or URLs.`

const REPAIR_SYSTEM_PROMPT = `Repair only the rejected Three Picks soft-copy fields supplied by the server.
Return exactly one replacement for every listed field and do not rewrite any successful field. Stay close to the selected verified evidence, canonical identity, and typed fact. Preserve every material condition and qualifier. Never add numbers, functions, models, materials, specifications, grades, interfaces, or stronger claims. Use the exact field keys and evidence candidate IDs supplied by the server.`

const evidenceIdsSchema = { type: 'array', minItems: 1, maxItems: 3,
  items: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,160}$' } }
const THREE_PICKS_V2_JSON_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['archetype', 'theme', 'hook', 'product_presentations', 'cta'], properties: {
    archetype: { type: 'string', const: ARCHETYPE },
    theme: { type: 'string', minLength: 1, maxLength: 48 },
    hook: { type: 'object', additionalProperties: false, required: ['display_text', 'tts'], properties: {
      display_text: { type: 'string', minLength: 1, maxLength: LIMITS.hookDisplay },
      tts: { type: 'string', minLength: 1, maxLength: LIMITS.hookTts },
    } },
    product_presentations: { type: 'array', minItems: 3, maxItems: 3, items: {
      type: 'object', additionalProperties: false,
      required: ['product_set_item_id', 'presentation_order', 'identity_id', 'fact_id', 'short_appeal',
        'short_appeal_evidence_ids', 'tts', 'tts_evidence_ids'], properties: {
        product_set_item_id: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
        presentation_order: { type: 'integer', minimum: 1, maximum: 3 },
        identity_id: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,160}$' },
        fact_id: { type: 'string', pattern: '^[A-Za-z0-9_.:-]{1,160}$' },
        short_appeal: { type: 'string', minLength: 8, maxLength: LIMITS.shortAppeal },
        short_appeal_evidence_ids: evidenceIdsSchema,
        tts: { type: 'string', minLength: 12, maxLength: LIMITS.productTts },
        tts_evidence_ids: evidenceIdsSchema,
      },
    } },
    cta: { type: 'object', additionalProperties: false, required: ['display_text', 'tts'], properties: {
      display_text: { type: 'string', minLength: 1, maxLength: LIMITS.ctaDisplay },
      tts: { type: 'string', minLength: 1, maxLength: LIMITS.ctaTts },
    } },
  } }

function plannerInput(input) {
  return { ...input, products: (input?.products || []).map(product => ({
    ...product,
    fact_candidates: (product.fact_candidates || []).map(({ facts: _facts, ...candidate }) => candidate),
    selectable_facts: (product.selectable_facts || []).map(fact => ({ ...fact })),
  })) }
}

function responseSchemaForInput(input) {
  const schema = JSON.parse(JSON.stringify(THREE_PICKS_V2_JSON_SCHEMA))
  const base = schema.properties.product_presentations.items
  schema.properties.product_presentations.items = { anyOf: (input?.products || []).map(product => ({
    ...base,
    properties: {
      ...base.properties,
      product_set_item_id: { type: 'string', const: product.product_set_item_id },
      presentation_order: { type: 'integer', const: product.presentation_order },
      identity_id: { type: 'string', enum: (product.identity_candidates || []).map(candidate => candidate.identity_id) },
      fact_id: { type: 'string', enum: (product.selectable_facts || []).map(fact => fact.fact_id) },
    },
  })) }
  return schema
}

const SAFE_REASONS = Object.freeze({
  THREE_PICKS_V2_INVALID_OUTPUT: 'planner output does not contain exactly three product presentations',
  THREE_PICKS_V2_INVALID_INPUT: 'planner input does not contain exactly three products',
  THREE_PICKS_V2_PRODUCT_MISMATCH: 'product identity is missing or duplicated',
  THREE_PICKS_V2_ORDER_INVALID: 'presentation order differs from frozen input',
  THREE_PICKS_V2_TEXT_LIMIT: 'text is outside the allowed length',
  THREE_PICKS_V2_IDENTITY_CANDIDATE_UNKNOWN: 'selected identity ID is not present in the input snapshot',
  THREE_PICKS_V2_FACT_UNKNOWN: 'selected fact ID is not present in typed evidence',
  THREE_PICKS_V2_EVIDENCE_ANCHOR_INVALID: 'selected evidence candidate ID is not present in the input snapshot',
  THREE_PICKS_V2_UNGROUNDED_CLAIM: 'claim is not supported by selected evidence candidates',
  THREE_PICKS_V2_HOOK_HARD_FACT: 'hook must not contain product hard facts',
  THREE_PICKS_V2_CTA_HARD_FACT: 'CTA must not contain product hard facts',
  THREE_PICKS_V2_HOOK_SEGMENT_COUNT: 'hook narration must produce exactly one segment',
  THREE_PICKS_V2_CTA_DESTINATION_REQUIRED: 'CTA does not identify the description destination',
  THREE_PICKS_V2_FORMAT_MISMATCH: 'formatted hard fact or identity differs from canonical input',
})

const compact = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim()
const normalized = value => compact(value).replace(/[\s。、，,.・「」『』【】（）()\[\]]/gu, '').toLowerCase()
const length = value => Array.from(compact(value)).length
const safePreview = value => Array.from(compact(value).replace(/[\u0000-\u001f\u007f]/gu, ' ')).slice(0, 100).join('').trim()
const safeIds = value => [...new Set((Array.isArray(value) ? value : [])
  .filter(id => /^[A-Za-z0-9_.:-]{1,160}$/u.test(id)))].slice(0, 3)
const productIndexFromPath = path => {
  const match = String(path || '').match(/^\$\.product_presentations\[([0-2])\]/u)
  return match ? Number(match[1]) + 1 : null
}

class ThreePicksV5ValidationError extends Error {
  constructor(code, message, fieldPath, { fieldValuePreview = null, evidenceCandidateIds = [] } = {}) {
    super(message); this.name = 'ThreePicksV5ValidationError'; this.code = code
    this.fieldPath = fieldPath; this.field_path = fieldPath
    this.productIndex = productIndexFromPath(fieldPath); this.product_index = this.productIndex
    this.reason = SAFE_REASONS[code] || 'schema-v5 validation failed'
    this.safeDiagnostics = { code, product_index: this.productIndex, field_path: fieldPath, reason: this.reason }
    const preview = safePreview(fieldValuePreview)
    if (preview) this.safeDiagnostics.field_value_preview = preview
    const ids = safeIds(evidenceCandidateIds)
    if (ids.length) this.safeDiagnostics.evidence_candidate_ids = ids
  }
}

function fail(code, path, value = null, evidenceIds = []) {
  throw new ThreePicksV5ValidationError(code, SAFE_REASONS[code], path,
    { fieldValuePreview: value, evidenceCandidateIds: evidenceIds })
}

function bounded(value, minimum, maximum, path, evidenceIds = []) {
  const text = compact(value)
  if (!text || length(text) < minimum || length(text) > maximum) fail('THREE_PICKS_V2_TEXT_LIMIT', path, text, evidenceIds)
  return text
}

const CONCEPTS = Object.freeze([
  ['night', /(?:夜間|夜|暗闇|暗い車内)/gu],
  ['usable', /(?:問題なく(?:ご)?使用(?:頂け|でき)|使用でき|使いやす|使え|利用|便利)/gu],
  ['light', /(?:LEDライト|LED|ライトがつく|ライト|点灯)/giu],
  ['open', /(?:(?:ふた|蓋|ゴミ箱)を開け|開く)/gu],
  ['smartphone', /(?:スマートフォン|スマホ|携帯電話)/gu],
  ['rough-road', /(?:悪路|振動|揺れ)/gu],
  ['strong-hold', /(?:ガッチリ|しっかり|強力)/gu],
  ['fix', /(?:固定|保持|ホールド|離さ(?:ない|ず)|離れにくい)/gu],
  ['choose', /(?:選べ|選ぶ|選択)/gu],
  ['fragrance', /(?:香り|アロマ|フレグランス)/gu],
])
const HARD_PATTERN = /(?:\d+(?:\.\d+)?|[A-Za-z]+\d*|アルミ(?:ニウム)?製?|ステンレス製?|スチール製?|鋼製|鉄製|樹脂製|シリコン製?|ガラス製?)/giu
const PROHIBITED_ADDITION_PATTERN = /(?:自動(?:開閉|点灯)?|充電(?:式)?|防水|防滴|抗菌|消臭|急速|ワイヤレス|回転|調整|大容量|最強|高性能|耐熱|防火|省電力)/gu
const HOOK_HARD_FACT_PATTERN = /(?:LED|USB|N\d{2}|IPX?\d|アルミ|ステンレス|\d+(?:個|本|週間|日|か月|色|度|cm|mm|%))/iu

function concepts(value) {
  const text = compact(value)
  return new Set(CONCEPTS.filter(([, pattern]) => { pattern.lastIndex = 0; return pattern.test(text) }).map(([key]) => key))
}

function selectedCandidates(product, ids, path) {
  const selectedIds = safeIds(ids)
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || selectedIds.length !== ids.length) {
    fail('THREE_PICKS_V2_EVIDENCE_ANCHOR_INVALID', path, null, ids)
  }
  const byId = new Map((product.fact_candidates || []).map(candidate => [candidate.id, candidate]))
  const selected = selectedIds.map(id => byId.get(id))
  if (selected.some(candidate => !candidate)) fail('THREE_PICKS_V2_EVIDENCE_ANCHOR_INVALID', path, null, ids)
  return selected
}

function selectedFact(product, factId) {
  const fact = (product.selectable_facts || []).find(candidate => candidate.fact_id === factId)
  if (!fact) return null
  const candidate = (product.fact_candidates || []).find(entry => entry.id === fact.source_candidate_id)
  const sourceFact = candidate?.facts?.find(entry => entry.fact_id === fact.fact_id)
  if (!candidate || !sourceFact || sourceFact.display_text !== fact.display_text) return null
  return { fact, candidate }
}

function durationUnitPattern(unit) {
  if (unit === 'か月') return '(?:か月|ヶ月|月)'
  if (unit === '時間') return '(?:時間|h)'
  return unit.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

const DURATION_APPROXIMATION_MARKER_PATTERN = /(?:約|およそ|ほど|くらい|ぐらい|程度)/u
const hasDurationApproximationMarker = value => DURATION_APPROXIMATION_MARKER_PATTERN.test(value)

function durationFactMatchesClaim(claim, fact) {
  const value = fact.canonical_value || {}
  const duration = new RegExp(`${value.duration}\\s*${durationUnitPattern(value.duration_unit)}`, 'iu')
  if (!duration.test(claim)) return false
  const claimedAmounts = [...claim.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${durationUnitPattern(value.amount_unit)}`, 'giu'))]
  if (claimedAmounts.some(match => Number(match[1]) !== Number(value.amount))) return false
  const approximate = hasDurationApproximationMarker(claim)
  if (approximate !== Boolean(value.approximate)) return false
  const estimate = /目安/u.test(claim)
  if (estimate !== Boolean(value.estimate)) return false
  const maximum = /(?:最大|最長)/u.test(claim)
  const minimum = /(?:最小|最短)/u.test(claim)
  if (maximum !== (value.bound === 'maximum') || minimum !== (value.bound === 'minimum')) return false
  return (value.conditions || []).every(condition => {
    if (condition.type === 'usage_per_day') {
      return new RegExp(`1\\s*日(?:あたり|当たり)?[^。]{0,12}${condition.value}\\s*(?:h|時間)`, 'iu').test(claim)
    }
    if (condition.type === 'usage_count') return new RegExp(`${condition.value}\\s*回`, 'u').test(claim)
    if (condition.type === 'usage_environment') return normalized(claim).includes(normalized(condition.value))
    return false
  })
}

const DURATION_VALUE_PATTERN = /\d+(?:\.\d+)?\s*(?:日|週間|か月|ヶ月|月|時間|h)/iu

function durationClaimsGrounded(claim, candidates) {
  const durationClaim = DURATION_VALUE_PATTERN.test(claim)
  if (!durationClaim) return true
  const durationFacts = candidates.flatMap(candidate => candidate.facts || []).filter(fact => fact.type === 'duration')
  return durationFacts.some(fact => durationFactMatchesClaim(claim, fact))
}

function softCopyIsGrounded(value, candidates) {
  const claim = compact(value)
  if (!durationClaimsGrounded(claim, candidates)) return false
  const evidence = candidates.map(candidate => compact(candidate.text)).join(' ')
  const normalizedEvidence = normalized(evidence)
  const hardClaims = claim.match(HARD_PATTERN) || []
  if (hardClaims.some(token => !normalizedEvidence.includes(normalized(token)))) return false
  const prohibited = claim.match(PROHIBITED_ADDITION_PATTERN) || []
  if (prohibited.some(token => !normalizedEvidence.includes(normalized(token)))) return false
  const claimConcepts = concepts(claim)
  const evidenceConcepts = concepts(evidence)
  if (/(?:種類|選択肢)/u.test(evidence)) evidenceConcepts.add('choose')
  const direct = candidates.some(candidate => normalized(candidate.text).includes(normalized(claim))
    || normalized(claim).includes(normalized(candidate.text)))
  return direct || (DURATION_VALUE_PATTERN.test(claim) && claimConcepts.size === 0)
    || (claimConcepts.size > 0 && [...claimConcepts].every(concept => evidenceConcepts.has(concept)))
}

function validateThreePicksV5HardContract(output, input) {
  if (!output || output.archetype !== ARCHETYPE || !Array.isArray(output.product_presentations)
    || output.product_presentations.length !== 3) fail('THREE_PICKS_V2_INVALID_OUTPUT', '$.product_presentations')
  const products = Array.isArray(input?.products) ? input.products : []
  if (products.length !== 3) fail('THREE_PICKS_V2_INVALID_INPUT', '$input.products')
  bounded(output.theme, 1, 48, '$.theme')
  const byId = new Map(products.map(product => [product.product_set_item_id, product]))
  const seen = new Set()
  output.product_presentations.forEach((item, index) => {
    const path = `$.product_presentations[${index}]`
    const product = byId.get(item.product_set_item_id)
    if (!product || seen.has(item.product_set_item_id)) fail('THREE_PICKS_V2_PRODUCT_MISMATCH', `${path}.product_set_item_id`)
    if (item.presentation_order !== product.presentation_order) fail('THREE_PICKS_V2_ORDER_INVALID', `${path}.presentation_order`, item.presentation_order)
    const identity = (product.identity_candidates || []).find(candidate => candidate.identity_id === item.identity_id)
    if (!identity) fail('THREE_PICKS_V2_IDENTITY_CANDIDATE_UNKNOWN', `${path}.identity_id`, item.identity_id)
    if (!selectedFact(product, item.fact_id)) fail('THREE_PICKS_V2_FACT_UNKNOWN', `${path}.fact_id`, item.fact_id)
    seen.add(item.product_set_item_id)
  })
  return { products, byId }
}

function validateHook(output) {
  bounded(output.hook?.display_text, 1, LIMITS.hookDisplay, '$.hook.display_text')
  const hookTts = bounded(output.hook?.tts, 1, LIMITS.hookTts, '$.hook.tts')
  if (HOOK_HARD_FACT_PATTERN.test(`${output.hook.display_text} ${hookTts}`)) fail('THREE_PICKS_V2_HOOK_HARD_FACT', '$.hook')
  if (narrationSegments('hook', hookTts).length !== 1) fail('THREE_PICKS_V2_HOOK_SEGMENT_COUNT', '$.hook.tts', hookTts)
}

function validateCta(output) {
  const ctaDisplay = bounded(output.cta?.display_text, 1, LIMITS.ctaDisplay, '$.cta.display_text')
  const ctaTts = bounded(output.cta?.tts, 1, LIMITS.ctaTts, '$.cta.tts')
  if (HOOK_HARD_FACT_PATTERN.test(`${ctaDisplay} ${ctaTts}`)) fail('THREE_PICKS_V2_CTA_HARD_FACT', '$.cta')
  if (!ctaDisplay.includes('概要欄') || !ctaTts.includes('概要欄')) fail('THREE_PICKS_V2_CTA_DESTINATION_REQUIRED', '$.cta', `${ctaDisplay} / ${ctaTts}`)
}

function validateProductSoftField(item, product, index, field) {
  const path = `$.product_presentations[${index}]`
  const idsField = field === 'short_appeal' ? 'short_appeal_evidence_ids' : 'tts_evidence_ids'
  const minimum = field === 'short_appeal' ? 8 : 12
  const maximum = field === 'short_appeal' ? LIMITS.shortAppeal : LIMITS.productTts
  const ids = item[idsField]
  const value = bounded(item[field], minimum, maximum, `${path}.${field}`, ids)
  const selected = selectedCandidates(product, ids, `${path}.${idsField}`)
  if (!softCopyIsGrounded(value, selected)) fail('THREE_PICKS_V2_UNGROUNDED_CLAIM', `${path}.${field}`, value, ids)
}

function softFieldDefinitions(output, input) {
  const products = input.products
  return [
    { field: 'hook', validate: () => validateHook(output), rejectedValue: output.hook },
    ...output.product_presentations.flatMap((item, index) => {
      const product = products.find(candidate => candidate.product_set_item_id === item.product_set_item_id)
      return ['short_appeal', 'tts'].map(name => ({ field: `products[${item.presentation_order - 1}].${name}`,
        validate: () => validateProductSoftField(item, product, index, name), rejectedValue: item[name],
        evidenceCandidateIds: item[name === 'short_appeal' ? 'short_appeal_evidence_ids' : 'tts_evidence_ids'],
        product, item, name, index }))
    }),
    { field: 'cta', validate: () => validateCta(output), rejectedValue: output.cta },
  ]
}

function collectSoftCopyFailures(output, input) {
  validateThreePicksV5HardContract(output, input)
  const failures = []
  for (const definition of softFieldDefinitions(output, input)) {
    try { definition.validate() }
    catch (error) {
      if (!(error instanceof ThreePicksV5ValidationError)) throw error
      failures.push({ ...definition, error })
    }
  }
  return failures
}

function validateThreePicksV5PlannerOutput(output, input) {
  const failures = collectSoftCopyFailures(output, input)
  if (failures.length) throw failures[0].error
  return output
}

function durationSafeCopy(value, narration = false) {
  const daily = (value.conditions || []).find(condition => condition.type === 'usage_per_day')
  const count = (value.conditions || []).find(condition => condition.type === 'usage_count')
  const environment = (value.conditions || []).find(condition => condition.type === 'usage_environment')
  const prefix = daily ? `1日${daily.value}時間${narration ? 'の' : ''}使用で`
    : count ? `${count.value}回使用で` : environment ? `${environment.value}で` : ''
  const bound = value.bound === 'maximum' ? '最大' : value.bound === 'minimum' ? '最小' : ''
  const approximate = value.approximate ? '約' : ''
  const estimate = value.estimate ? '目安' : ''
  const base = `${value.amount}${value.amount_unit}${bound}${approximate}${value.duration}${value.duration_unit}${estimate}`
  return narration ? value.estimate
    ? `${prefix}${value.amount}${value.amount_unit}あたり${bound}${approximate}${value.duration}${value.duration_unit}が目安です`
    : `${prefix}${value.amount}${value.amount_unit}を${bound}${approximate}${value.duration}${value.duration_unit}使えます`
    : `${prefix}${base}`
}

function canonicalProductCopy(product, item, field) {
  const identity = product.identity_candidates.find(candidate => candidate.identity_id === item.identity_id)
  const resolved = selectedFact(product, item.fact_id)
  const fact = resolved.fact
  let shortAppeal
  let narration
  if (fact.type === 'duration') {
    shortAppeal = durationSafeCopy(fact.canonical_value)
    narration = durationSafeCopy(fact.canonical_value, true)
  } else if (fact.key === 'led') {
    shortAppeal = 'LEDを搭載した仕様です'; narration = 'LEDを搭載しています'
  } else if (fact.key === 'magnetic_fixation') {
    shortAppeal = 'マグネットで固定できます'; narration = 'マグネットで固定できます'
  } else if (['quantity', 'count'].includes(fact.type)) {
    const quantity = fact.canonical_value || {}
    shortAppeal = quantity.unit ? `${quantity.value}${quantity.unit}入りの商品です` : `付属数量は${quantity.value}です`
    narration = shortAppeal
  } else if (fact.type === 'material') {
    shortAppeal = `${fact.display_text}を使用しています`; narration = shortAppeal
  } else if (['model', 'grade', 'magnet_grade'].includes(fact.type)) {
    shortAppeal = `${fact.display_text}を採用しています`; narration = shortAppeal
  } else if (fact.type === 'connection') {
    shortAppeal = `${fact.display_text}に対応しています`; narration = shortAppeal
  } else {
    shortAppeal = `${fact.display_text}の特徴があります`; narration = `${fact.display_text}の特徴があります`
  }
  const value = field === 'short_appeal' ? shortAppeal : `${identity.display_name}は、${narration}。`
  bounded(value, field === 'short_appeal' ? 8 : 12,
    field === 'short_appeal' ? LIMITS.shortAppeal : LIMITS.productTts, `canonical.${field}`)
  return { value, evidence_candidate_ids: [fact.source_candidate_id || resolved.candidate.id] }
}

function canonicalReplacement(definition) {
  if (definition.field === 'hook') return { display_text: '車内が快適になる3アイテム', tts: '車内が快適になる3アイテム' }
  if (definition.field === 'cta') return { display_text: '気になる商品は概要欄へ', tts: '気になる商品は概要欄へ' }
  return canonicalProductCopy(definition.product, definition.item, definition.name)
}

function repairInput(output, input, failures) {
  return { archetype: ARCHETYPE, repair_level: 'grounded', successful_fields_immutable: true,
    failures: failures.map(definition => {
      const base = { field: definition.field, field_path: definition.error.field_path,
        rejected_value: definition.rejectedValue, validation_reason: definition.error.reason,
        selected_evidence_candidate_ids: definition.evidenceCandidateIds || [],
        length_constraint: definition.name === 'short_appeal' ? { minimum: 8, maximum: LIMITS.shortAppeal }
          : definition.name === 'tts' ? { minimum: 12, maximum: LIMITS.productTts }
            : definition.field === 'hook' ? { maximum: LIMITS.hookTts } : { maximum: LIMITS.ctaTts } }
      if (!definition.product) return base
      const identity = definition.product.identity_candidates.find(candidate => candidate.identity_id === definition.item.identity_id)
      const fact = selectedFact(definition.product, definition.item.fact_id)?.fact
      const evidenceById = new Map(definition.product.fact_candidates.map(candidate => [candidate.id, candidate]))
      return { ...base, canonical_identity: identity.display_name, selected_identity_id: definition.item.identity_id,
        selected_fact_id: definition.item.fact_id, selected_typed_fact: fact,
        selected_evidence: (definition.evidenceCandidateIds || []).map(id => ({ id, text: evidenceById.get(id)?.text })).filter(item => item.text) }
    }) }
}

function repairResponseSchema(failures) {
  const variants = failures.map(definition => definition.field === 'hook' || definition.field === 'cta'
    ? { type: 'object', additionalProperties: false, required: ['field', 'display_text', 'tts'], properties: {
      field: { type: 'string', const: definition.field }, display_text: { type: 'string' }, tts: { type: 'string' },
    } }
    : { type: 'object', additionalProperties: false, required: ['field', 'value', 'evidence_candidate_ids'], properties: {
      field: { type: 'string', const: definition.field }, value: { type: 'string' }, evidence_candidate_ids: evidenceIdsSchema,
    } })
  return { type: 'object', additionalProperties: false, required: ['repairs'], properties: {
    repairs: { type: 'array', minItems: failures.length, maxItems: failures.length, items: { anyOf: variants } },
  } }
}

function applyReplacement(output, definition, replacement) {
  if (definition.field === 'hook') output.hook = { display_text: replacement.display_text, tts: replacement.tts }
  else if (definition.field === 'cta') output.cta = { display_text: replacement.display_text, tts: replacement.tts }
  else {
    const item = output.product_presentations[definition.index]
    item[definition.name] = replacement.value
    item[definition.name === 'short_appeal' ? 'short_appeal_evidence_ids' : 'tts_evidence_ids'] = [...replacement.evidence_candidate_ids]
  }
}

function completeThreePicksV5Plan(output, input, repairOutput = null) {
  validateThreePicksV5HardContract(output, input)
  const draft = JSON.parse(JSON.stringify(output))
  const initialFailures = collectSoftCopyFailures(draft, input)
  const failedByField = new Map(initialFailures.map(definition => [definition.field, definition]))
  const repairByField = new Map()
  if (Array.isArray(repairOutput?.repairs)) for (const repair of repairOutput.repairs) {
    if (failedByField.has(repair?.field) && !repairByField.has(repair.field)) repairByField.set(repair.field, repair)
  }
  const modes = []
  for (const definition of softFieldDefinitions(draft, input)) {
    const initialFailure = failedByField.get(definition.field)
    if (!initialFailure) {
      modes.push({ field: definition.field, generation_mode: 'ai_generated', repair_count: 0,
        ...(definition.item ? { product_set_item_id: definition.item.product_set_item_id,
          identity_id: definition.item.identity_id, fact_id: definition.item.fact_id,
          evidence_candidate_ids: [...definition.evidenceCandidateIds] } : {}) })
      continue
    }
    const replacement = repairByField.get(definition.field)
    let repaired = false
    if (replacement) {
      try {
        applyReplacement(draft, definition, replacement)
        const current = softFieldDefinitions(draft, input).find(item => item.field === definition.field)
        current.validate(); repaired = true
      } catch (error) {
        if (!(error instanceof ThreePicksV5ValidationError) && !(error instanceof TypeError)) throw error
      }
    }
    if (!repaired) {
      const current = softFieldDefinitions(draft, input).find(item => item.field === definition.field)
      applyReplacement(draft, current, canonicalReplacement(current))
    }
    const current = softFieldDefinitions(draft, input).find(item => item.field === definition.field)
    modes.push({ field: definition.field, generation_mode: repaired ? 'ai_repaired' : 'canonical_fallback', repair_count: 1,
      ...(current.item ? { product_set_item_id: current.item.product_set_item_id,
        identity_id: current.item.identity_id, fact_id: current.item.fact_id,
        evidence_candidate_ids: [...current.evidenceCandidateIds] } : {}) })
  }
  for (const mode of modes) {
    const current = softFieldDefinitions(draft, input).find(item => item.field === mode.field)
    if (mode.generation_mode !== 'canonical_fallback') current.validate()
    else {
      const expected = canonicalReplacement(current)
      if (current.field === 'hook' || current.field === 'cta') {
        if (JSON.stringify(current.rejectedValue) !== JSON.stringify(expected)) fail('THREE_PICKS_V2_FORMAT_MISMATCH', `$.${current.field}`)
      } else if (current.rejectedValue !== expected.value
        || JSON.stringify(current.evidenceCandidateIds) !== JSON.stringify(expected.evidence_candidate_ids)) {
        fail('THREE_PICKS_V2_FORMAT_MISMATCH', `$.product_presentations[${current.index}].${current.name}`)
      }
    }
  }
  return formatThreePicksV5Plan(draft, input, { skipPlannerValidation: true, softCopyFields: modes })
}

function formatThreePicksV5Plan(output, input, { skipPlannerValidation = false, softCopyFields = null } = {}) {
  if (!skipPlannerValidation) validateThreePicksV5PlannerOutput(output, input)
  else validateThreePicksV5HardContract(output, input)
  const byId = new Map(input.products.map(product => [product.product_set_item_id, product]))
  const productPresentations = output.product_presentations.map(item => {
    const product = byId.get(item.product_set_item_id)
    const identity = product.identity_candidates.find(candidate => candidate.identity_id === item.identity_id)
    const resolvedFact = selectedFact(product, item.fact_id)
    const evidenceIds = [...new Set([...item.short_appeal_evidence_ids, ...item.tts_evidence_ids])]
    const evidenceById = new Map(product.fact_candidates.map(candidate => [candidate.id, candidate]))
    return {
      product_set_item_id: item.product_set_item_id,
      presentation_order: item.presentation_order,
      display_name: identity.display_name,
      short_appeal: item.short_appeal,
      fact_badge: resolvedFact.fact.display_text,
      tts: item.tts,
      verified_fact_ref: resolvedFact.candidate.verified_fact_ref,
      identity_id: item.identity_id,
      fact_id: item.fact_id,
      short_appeal_evidence_ids: [...item.short_appeal_evidence_ids],
      tts_evidence_ids: [...item.tts_evidence_ids],
      evidence_candidate_ids: evidenceIds,
      evidence_anchors: evidenceIds.map(id => evidenceById.get(id)?.source_anchor || evidenceById.get(id)?.text).filter(Boolean),
      lineage: { identity_id: item.identity_id, fact_id: item.fact_id,
        evidence_candidate_ids: evidenceIds },
    }
  })
  const formatted = { archetype: ARCHETYPE, theme: output.theme, hook: { ...output.hook },
    product_presentations: productPresentations, cta: { ...output.cta },
    ...(softCopyFields ? { soft_copy_fields: softCopyFields } : {}),
    contract: { prompt_version: PROMPT_VERSION, schema_version: SCHEMA_VERSION,
      manifest_version: MANIFEST_VERSION, layout_id: LAYOUT_ID } }
  validateFormattedThreePicksV5Output(formatted, input)
  return formatted
}

function validateFormattedThreePicksV5Output(plan, input) {
  const byId = new Map(input.products.map(product => [product.product_set_item_id, product]))
  for (let index = 0; index < plan.product_presentations.length; index += 1) {
    const item = plan.product_presentations[index]
    const product = byId.get(item.product_set_item_id)
    const identity = product?.identity_candidates?.find(candidate => candidate.identity_id === item.identity_id)
    const fact = product ? selectedFact(product, item.fact_id)?.fact : null
    if (!identity || item.display_name !== identity.display_name) fail('THREE_PICKS_V2_FORMAT_MISMATCH', `$.product_presentations[${index}].display_name`, item.display_name)
    if (!fact || item.fact_badge !== fact.display_text) fail('THREE_PICKS_V2_FORMAT_MISMATCH', `$.product_presentations[${index}].fact_badge`, item.fact_badge)
    bounded(item.display_name, 4, LIMITS.displayName, `$.product_presentations[${index}].display_name`)
    bounded(item.fact_badge, 2, LIMITS.factBadge, `$.product_presentations[${index}].fact_badge`)
  }
  return plan
}

module.exports = { ARCHETYPE, DEFAULT_MODEL, LAYOUT_ID, LEGACY_LAYOUT_ID, LEGACY_MANIFEST_VERSION,
  LIMITS, MANIFEST_VERSION, PROMPT_VERSION, REPAIR_SYSTEM_PROMPT, SAFE_REASONS, SCHEMA_VERSION, SYSTEM_PROMPT, TEMPLATE_ID,
  THREE_PICKS_V2_JSON_SCHEMA, ThreePicksV5ValidationError, collectSoftCopyFailures, completeThreePicksV5Plan,
  formatThreePicksV5Plan, narrationSegments, plannerInput, repairInput, repairResponseSchema, responseSchemaForInput,
  planNarrationSegments, validateFormattedThreePicksV5Output, validateThreePicksV5PlannerOutput }
