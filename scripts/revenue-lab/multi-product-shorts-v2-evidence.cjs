'use strict'

const MAX_PRODUCT_NAME = 240
const MAX_FACT_UNIT = 120
const MAX_FACT_CANDIDATES = 12

function normalizeEvidenceText(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const OPEN_BRACKETS = '（([「『【〈《'
const CLOSE_BRACKETS = '）)]」』】〉》'
const CONNECTIVE_BOUNDARY = /(?:、|,)\s*(?=(?:また|さらに|なお|ただし|一方|そのため|そして|加えて|および|または|ならびに|及び))/gu
const LEADING_BOUNDARY = /^(?:(?:[・●■□◆◇▶▷※*]|[-–—])\s*)+/u

function balancedBrackets(value) {
  const stack = []
  for (const character of Array.from(value)) {
    const openIndex = OPEN_BRACKETS.indexOf(character)
    if (openIndex >= 0) stack.push(openIndex)
    const closeIndex = CLOSE_BRACKETS.indexOf(character)
    if (closeIndex >= 0 && stack.pop() !== closeIndex) return false
  }
  return stack.length === 0
}

function completeUnit(value) {
  return Boolean(value) && balancedBrackets(value)
    && !/[（([「『【〈《、,・\-–—]$/u.test(value)
    && !/(?:また|さらに|なお|ただし|そのため|そして|加えて|および|または|ならびに|及び)$/u.test(value)
}

function splitAtSentenceEndings(value) {
  const units = []
  let buffer = ''
  let depth = 0
  for (const character of Array.from(value)) {
    if (OPEN_BRACKETS.includes(character)) depth += 1
    if (CLOSE_BRACKETS.includes(character)) depth = Math.max(0, depth - 1)
    if (depth === 0 && /[。！？!?；;]/u.test(character)) {
      const unit = normalizeEvidenceText(buffer)
      if (unit) units.push(unit)
      buffer = ''
    } else buffer += character
  }
  const tail = normalizeEvidenceText(buffer)
  if (tail) units.push(tail)
  return units
}

function splitOverlongUnit(value) {
  if (Array.from(value).length <= MAX_FACT_UNIT) return [value]
  const parts = value.split(CONNECTIVE_BOUNDARY).map(normalizeEvidenceText).filter(Boolean)
  return parts.length > 1 ? parts.filter(part => Array.from(part).length <= MAX_FACT_UNIT) : []
}

function splitSemanticUnits(value) {
  const text = String(value ?? '').normalize('NFKC').replace(/\r\n?/g, '\n')
  const boundaryUnits = []
  for (const line of text.split('\n')) {
    const withoutHeadings = line.replace(/【[^】]*】|〈[^〉]*〉/gu, '\n')
    for (const section of withoutHeadings.split('\n')) {
      const bulletParts = section.split(/\s*[・●■□◆◇▶▷]\s*|(?:^|\s)[*※\-–—]\s*/u)
      for (const part of bulletParts) {
        const normalized = normalizeEvidenceText(part.replace(LEADING_BOUNDARY, ''))
        if (normalized) boundaryUnits.push(normalized)
      }
    }
  }
  return boundaryUnits
    .flatMap(splitAtSentenceEndings)
    .flatMap(splitOverlongUnit)
    .filter(completeUnit)
}

function prepareThreePicksV2ProductEvidence({ productName, verifiedFactRef, verifiedFact }) {
  const sourceProductName = normalizeEvidenceText(productName)
  if (!sourceProductName || Array.from(sourceProductName).length > MAX_PRODUCT_NAME) {
    throw new TypeError('Product name must be a complete value within the planner evidence limit')
  }
  const factCandidates = splitSemanticUnits(verifiedFact?.value)
    .filter(unit => Array.from(unit).length <= MAX_FACT_UNIT)
    .slice(0, MAX_FACT_CANDIDATES)
    .map((text, index) => ({ id: `${verifiedFactRef}-${index + 1}`, verified_fact_ref: verifiedFactRef, text }))
  if (!verifiedFactRef || factCandidates.length === 0) throw new TypeError('At least one complete verified fact candidate is required')
  return { source_product_name: sourceProductName, fact_candidates: factCandidates }
}

const MATERIALS = Object.freeze([
  ['abs', /ABS樹脂/iu, 'ABS樹脂'], ['aluminum', /アルミ(?:ニウム)?製?/u, 'アルミ製'],
  ['stainless', /ステンレス製?/u, 'ステンレス製'], ['steel', /(?:スチール|鋼|鉄)製/u, 'スチール製'],
  ['silicone', /シリコン製?/u, 'シリコン製'], ['glass', /ガラス製?/u, 'ガラス製'],
])
const MAX_FACT_BADGE_LENGTH = 12

function durationConditions(source) {
  const conditions = []
  const perDay = source.match(/1\s*日(?:あたり|当たり)?\s*(\d+(?:\.\d+)?)\s*(?:h|時間)\s*(?:利用|使用)?/iu)
  if (perDay) conditions.push({ type: 'usage_per_day', value: Number(perDay[1]), unit: 'hour' })
  const usageCount = source.match(/(\d+)\s*回\s*(?:利用|使用)(?:時|した場合|で)?/u)
  if (usageCount) conditions.push({ type: 'usage_count', value: Number(usageCount[1]), unit: 'time' })
  const environment = source.match(/(?:特定条件下|常温環境|室内環境|屋外環境)/u)
  if (environment) conditions.push({ type: 'usage_environment', value: environment[0] })
  return conditions
}

function durationDisplay(value) {
  const daily = value.conditions.find(condition => condition.type === 'usage_per_day')
  const count = value.conditions.find(condition => condition.type === 'usage_count')
  const environment = value.conditions.find(condition => condition.type === 'usage_environment')
  const condition = daily ? `1日${daily.value}hで` : count ? `${count.value}回使用で`
    : environment ? `${environment.value}で` : `${value.amount}${value.amount_unit}`
  const bound = value.bound === 'maximum' ? '最大' : value.bound === 'minimum' ? '最小' : ''
  const approximation = value.approximate ? '約' : ''
  const estimate = value.estimate ? '目安' : ''
  return `${condition}${bound}${approximation}${value.duration}${value.duration_unit}${estimate}`
}

function compileTypedFacts({ candidateId, text }) {
  const source = normalizeEvidenceText(text)
  if (!candidateId || !source) return []
  const facts = []
  const add = (type, key, canonicalValue, displayText) => {
    const factId = `${candidateId}:${type}:${key}`
    if (!facts.some(fact => fact.fact_id === factId)) facts.push({
      fact_id: factId, type, key, canonical_value: canonicalValue, display_text: displayText,
    })
  }

  if (/LED(?:ライト)?(?:付き|搭載|点灯)|(?:ライト|LED)が点灯/iu.test(source)) {
    add('feature', 'led', true, 'LED搭載')
  }
  const magnetGrade = source.match(/\bN(\d{2})\b\s*(?:ネオジム)?\s*(?:磁石|マグネット)/iu)
  if (magnetGrade) add('magnet_grade', 'magnet_grade', `N${magnetGrade[1]}`, `N${magnetGrade[1]}磁石`)
  const magneticFixation = /(?:マグネット\s*(?:固定|式)|磁石\s*固定|強力\s*(?:マグネット|磁石)|(?:鉄壁\s*)?磁力[^。]{0,16}マグネット|\bN\d{2}\b\s*(?:ネオジム)?\s*(?:磁石|マグネット))/iu
  if (magneticFixation.test(source)) add('feature', 'magnetic_fixation', true, 'マグネット固定')

  const forwardDuration = source.match(/(\d+)\s*(本|個|回|枚|台)\s*(?:につき|あたり|当たり|で)?\s*(最大|最長|最小|最短)?\s*(約)?\s*(\d+(?:\.\d+)?)\s*(日|週間|か月|ヶ月|月|時間)/u)
  const reverseDuration = forwardDuration ? null
    : source.match(/(最大|最長|最小|最短)?\s*(約)?\s*(\d+(?:\.\d+)?)\s*(日|週間|か月|ヶ月|月|時間)\s*[／/]\s*(\d+)\s*(本|個|回|枚|台)/u)
  const duration = forwardDuration ? { amount: forwardDuration[1], amountUnit: forwardDuration[2],
    bound: forwardDuration[3], approximate: forwardDuration[4], duration: forwardDuration[5], durationUnit: forwardDuration[6] }
    : reverseDuration ? { amount: reverseDuration[5], amountUnit: reverseDuration[6],
      bound: reverseDuration[1], approximate: reverseDuration[2], duration: reverseDuration[3], durationUnit: reverseDuration[4] }
      : null
  if (duration) {
    const durationUnit = ['月', 'ヶ月'].includes(duration.durationUnit) ? 'か月' : duration.durationUnit
    const value = { amount: Number(duration.amount), amount_unit: duration.amountUnit,
      approximate: Boolean(duration.approximate), duration: Number(duration.duration), duration_unit: durationUnit,
      conditions: durationConditions(source),
      bound: /(?:最大|最長)/u.test(duration.bound || '') ? 'maximum'
        : /(?:最小|最短)/u.test(duration.bound || '') ? 'minimum' : null,
      estimate: /目安/u.test(source) }
    add('duration', 'usage_duration', value, durationDisplay(value))
  }

  const quantity = duration ? null : source.match(/(\d+)\s*(個|本|枚|台|袋|セット|ヶ(?!月))\s*(入り|入)?/u)
  if (quantity) add('quantity', 'package_quantity', { value: Number(quantity[1]), unit: quantity[2] },
    `${quantity[1]}${quantity[2]}${quantity[3] ? '入り' : ''}`)
  for (const [index, multipliedQuantity] of [...source.matchAll(/[×xX]\s*(\d+)/gu)].entries()) {
    add('quantity', index === 0 ? 'package_quantity' : `package_quantity_${index + 1}`,
      { value: Number(multipliedQuantity[1]), unit: null }, `×${multipliedQuantity[1]}`)
  }
  const count = source.match(/(\d+)\s*(種類|段階|パターン|モード)/u)
  if (count) add('count', 'option_count', { value: Number(count[1]), unit: count[2] }, `${count[1]}${count[2]}`)

  const usb = source.match(/USB\s*(?:Type\s*[-‐‑–—]?\s*([ABC])|[-‐‑–—]?\s*([ABC]))?/iu)
  if (usb) {
    const connector = (usb[1] || usb[2] || '').toUpperCase()
    const canonical = connector ? `USB Type-${connector}` : 'USB'
    add('connection', connector ? `usb_type_${connector.toLowerCase()}` : 'usb', canonical, canonical)
  }

  for (const [key, pattern, displayText] of MATERIALS) {
    if (pattern.test(source)) add('material', key, displayText, displayText)
  }
  const model = source.match(/(?:型番|モデル)\s*[:：]?\s*([A-Za-z][A-Za-z0-9._-]{1,20})/u)
  if (model) add('model', 'model_number', model[1], model[1])
  const grade = source.match(/\b(IPX[0-9K]?|IP[0-9]{2}|JIS\s*[A-Za-z0-9.-]+)\b/iu)
  if (grade) add('grade', 'standard_grade', grade[1].toUpperCase().replace(/\s+/g, ''), grade[1].toUpperCase().replace(/\s+/g, ''))
  return facts
}

function compileIdentityCandidates({ productSetItemId, productName }) {
  const source = normalizeEvidenceText(productName)
  const candidates = []
  const add = (key, displayName) => {
    const candidate = { identity_id: `${productSetItemId}:identity:${key}`, display_name: displayName }
    if (!candidates.some(item => item.identity_id === candidate.identity_id)) candidates.push(candidate)
  }
  if (/(?:ゴミ箱|ごみ箱|ダストボックス|くず入れ)/u.test(source)) add('vehicle-dustbox', '車載ダストボックス')
  if (/(?:スマホ|スマートフォン|携帯電話)/u.test(source) && /(?:ホルダー|マウント|スタンド)/u.test(source)) {
    add(/(?:磁石|マグネット)/u.test(source) ? 'magnetic-smartphone-holder' : 'smartphone-holder',
      /(?:磁石|マグネット)/u.test(source) ? 'マグネット式スマホホルダー' : 'スマホホルダー')
  }
  if (/(?:アロマ|芳香剤|フレグランス)/u.test(source) && /(?:ディフューザー|ディフューザ)/u.test(source)) {
    add('vehicle-aroma-diffuser', '車載アロマディフューザー')
  }
  return candidates.slice(0, 3)
}

function prepareThreePicksV2TypedProductEvidence({ productSetItemId, productName, verifiedFactRef, verifiedFact }) {
  const prepared = prepareThreePicksV2ProductEvidence({ productName, verifiedFactRef, verifiedFact })
  const identityCandidates = compileIdentityCandidates({ productSetItemId, productName: prepared.source_product_name })
  if (identityCandidates.length === 0) {
    throw Object.assign(new TypeError('A canonical product identity candidate is required'), {
      code: 'IDENTITY_CANDIDATE_MISSING',
    })
  }
  const factCandidates = prepared.fact_candidates.map(candidate => ({ ...candidate,
    source_anchor: candidate.text,
    facts: compileTypedFacts({ candidateId: candidate.id, text: candidate.text }),
  }))
  if (!factCandidates.some(candidate => candidate.facts.length > 0)) {
    throw Object.assign(new TypeError('At least one typed fact candidate is required'), {
      code: 'TYPED_FACT_CANDIDATE_MISSING',
    })
  }
  const selectableFacts = factCandidates.flatMap(candidate => candidate.facts.map(fact => ({
    ...fact,
    source_candidate_id: candidate.id,
  }))).filter(fact => Array.from(fact.display_text).length <= MAX_FACT_BADGE_LENGTH)
  if (selectableFacts.length === 0) {
    throw Object.assign(new TypeError('At least one display-safe typed fact candidate is required'), {
      code: 'TYPED_FACT_CANDIDATE_MISSING',
    })
  }
  return {
    ...prepared,
    identity_candidates: identityCandidates,
    fact_candidates: factCandidates,
    selectable_facts: selectableFacts,
  }
}

module.exports = { MAX_FACT_CANDIDATES, MAX_FACT_UNIT, MAX_PRODUCT_NAME,
  compileIdentityCandidates, compileTypedFacts, normalizeEvidenceText, prepareThreePicksV2ProductEvidence,
  prepareThreePicksV2TypedProductEvidence, splitSemanticUnits }
