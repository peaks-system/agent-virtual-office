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

module.exports = { MAX_FACT_CANDIDATES, MAX_FACT_UNIT, MAX_PRODUCT_NAME,
  normalizeEvidenceText, prepareThreePicksV2ProductEvidence, splitSemanticUnits }
