'use strict'

const MAX_PRODUCT_NAME = 240
const MAX_FACT_UNIT = 120
const MAX_FACT_CANDIDATES = 12

function normalizeEvidenceText(value) {
  return String(value ?? '').normalize('NFKC').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function splitSemanticUnits(value) {
  const text = normalizeEvidenceText(value)
  const units = []
  let buffer = ''
  let depth = 0
  for (const character of Array.from(text)) {
    if ('（([「『【〈《'.includes(character)) depth += 1
    if ('）)]」』】〉》'.includes(character)) depth = Math.max(0, depth - 1)
    if (depth === 0 && /[。！？!?；;]/u.test(character)) {
      const unit = buffer.replace(/^[・●■□◆◇▶▷※\s]+/u, '').trim()
      if (unit) units.push(unit)
      buffer = ''
    } else buffer += character
  }
  const tail = buffer.replace(/^[・●■□◆◇▶▷※\s]+/u, '').trim()
  if (tail) units.push(tail)
  return units
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
