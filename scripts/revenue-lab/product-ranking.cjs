'use strict'

const SCORE_VERSION = 'product-rakuten-v1'
const SCORE_WEIGHTS = Object.freeze({
  keywordMatch: 0.25,
  searchCoverage: 0.25,
  providerRank: 0.25,
  reviewCount: 0.10,
  reviewAverage: 0.10,
  affiliateRate: 0.05,
})

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, Number(value) || 0))
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu, '')
}

function keywordTerms(keywords) {
  const output = []
  const seen = new Set()
  for (const keyword of keywords || []) {
    for (const raw of String(keyword || '').normalize('NFKC').toLocaleLowerCase('ja-JP').split(/\s+/u)) {
      const term = normalizeText(raw)
      if (term && !seen.has(term)) { seen.add(term); output.push(term) }
    }
  }
  return output
}

function keywordMatchScore(product, keywords) {
  const terms = keywordTerms(keywords)
  if (!terms.length) return 0
  const haystack = normalizeText(`${product.title || ''}${product.catchcopy || ''}`)
  const totalWeight = terms.reduce((sum, term) => sum + [...term].length, 0)
  const matchedWeight = terms.reduce((sum, term) => sum + (haystack.includes(term) ? [...term].length : 0), 0)
  return totalWeight ? 100 * matchedWeight / totalWeight : 0
}

function averageRankPercentiles(values, accessor, { missing = 0 } = {}) {
  const present = values.map((value, index) => { const raw = accessor(value); return { index, value: raw == null ? Number.NaN : Number(raw) } })
    .filter(entry => Number.isFinite(entry.value))
    .sort((a, b) => a.value - b.value)
  const result = Array(values.length).fill(missing)
  if (present.length === 1) { result[present[0].index] = 50; return result }
  for (let start = 0; start < present.length;) {
    let end = start
    while (end + 1 < present.length && present[end + 1].value === present[start].value) end += 1
    const averageRank = ((start + 1) + (end + 1)) / 2
    const percentile = 100 * (averageRank - 1) / (present.length - 1)
    for (let cursor = start; cursor <= end; cursor += 1) result[present[cursor].index] = percentile
    start = end + 1
  }
  return result
}

function providerPositionScore(matches) {
  return Math.max(0, ...(matches || []).map(match => {
    const count = Math.max(1, Number(match.resultCount) || 1)
    const position = Math.max(1, Number(match.position) || count)
    return count === 1 ? 100 : clamp(100 * (count - position) / (count - 1))
  }))
}

function rankProductCandidates(records, keywords) {
  const uniqueKeywords = [...new Set((keywords || []).map(value => String(value).trim()).filter(Boolean))]
  const reviewPercentiles = averageRankPercentiles(records, record => record.product.reviewCount)
  const affiliatePercentiles = averageRankPercentiles(records, record => record.product.affiliateRate)
  const ranked = records.map((record, index) => {
    const matchedKeywords = [...new Set((record.matches || []).map(match => match.keyword))]
    const components = {
      keywordMatch: keywordMatchScore(record.product, uniqueKeywords),
      searchCoverage: uniqueKeywords.length ? 100 * matchedKeywords.length / uniqueKeywords.length : 0,
      providerRank: providerPositionScore(record.matches),
      reviewCount: reviewPercentiles[index],
      reviewAverage: record.product.reviewAverage == null ? 0 : clamp(Number(record.product.reviewAverage) / 5 * 100),
      affiliateRate: affiliatePercentiles[index],
    }
    const raw = Object.entries(SCORE_WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight, 0)
    return {
      ...record,
      matchedKeywords,
      matchedKeywordCount: matchedKeywords.length,
      components,
      candidateScoreRaw: raw,
      candidateScore: round(raw, 2),
      savedComponents: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value, 4)])),
      scoreVersion: SCORE_VERSION,
    }
  })
  ranked.sort((a, b) => b.candidateScoreRaw - a.candidateScoreRaw
    || b.components.searchCoverage - a.components.searchCoverage
    || Number(b.product.reviewCount || 0) - Number(a.product.reviewCount || 0)
    || String(a.product.providerProductId).localeCompare(String(b.product.providerProductId)))
  return ranked.map((record, index) => ({ ...record, rankPosition: index + 1 }))
}

const SCORE_PARAMETERS = Object.freeze({
  weights: SCORE_WEIGHTS,
  keyword_match: 'NFKC lowercase whitespace-token literal substring; code-point-length weighted',
  search_coverage: 'distinct matched request keywords / requested keywords',
  provider_rank: 'best descending position percentile; singleton=100',
  review_count: 'average-rank percentile; singleton=50; missing=0',
  review_average: 'review_average / 5 * 100; missing=0',
  affiliate_rate: 'average-rank percentile; singleton=50; missing=0',
  rounding: 'Math.round(value * 10^digits) / 10^digits; raw score used for ranking',
  tie_break: ['candidate_score_raw desc', 'search_coverage desc', 'review_count desc', 'provider_product_id asc'],
})

module.exports = { SCORE_PARAMETERS, SCORE_VERSION, SCORE_WEIGHTS, averageRankPercentiles, keywordMatchScore, keywordTerms, normalizeText, rankProductCandidates, round }
