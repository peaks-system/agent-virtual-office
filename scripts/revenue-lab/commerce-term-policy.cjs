'use strict'

const POLICY_VERSION = 'commerce-term-policy-v1'

const TERM_POLICY = Object.freeze([
  { canonical: 'ダイソー', type: 'retailer', aliases: ['ダイソー', 'daiso'] },
  { canonical: 'セリア', type: 'retailer', aliases: ['セリア', 'seria'] },
  { canonical: 'キャンドゥ', type: 'retailer', aliases: ['キャンドゥ', 'cando', "can do"] },
  { canonical: '100円ショップ', type: 'source_context', aliases: ['100円ショップ', '100均', '百均', 'ひゃっきん'] },
  { canonical: 'コンビニ', type: 'source_context', aliases: ['コンビニ', 'コンビニエンスストア'] },
  { canonical: 'ホームセンター', type: 'source_context', aliases: ['ホームセンター'] },
  { canonical: 'Amazon', type: 'marketplace', aliases: ['amazon', 'アマゾン'] },
  { canonical: '楽天市場', type: 'marketplace', aliases: ['楽天市場', '楽天'] },
  { canonical: 'Yahoo!ショッピング', type: 'marketplace', aliases: ['yahoo!ショッピング', 'ヤフーショッピング'] },
  { canonical: '購入品', type: 'discovery_expression', aliases: ['購入品'] },
  { canonical: 'パトロール', type: 'discovery_expression', aliases: ['パトロール'] },
])

function normalize(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu, ' ').trim()
}

function occurrences(value) {
  const normalized = normalize(value)
  const matches = []
  for (const entry of TERM_POLICY) {
    for (const alias of entry.aliases) {
      const normalizedAlias = normalize(alias)
      if (normalized.includes(normalizedAlias)) {
        matches.push({ term: alias, normalizedTerm: normalizedAlias, canonicalTerm: entry.canonical, termType: entry.type })
        break
      }
    }
  }
  return matches
}

function removeSourceTerms(value, matches = occurrences(value)) {
  let cleaned = normalize(value)
  for (const match of matches) cleaned = cleaned.split(match.normalizedTerm).join(' ')
  return cleaned.replace(/[\s　・、,，/／|｜【】\[\]「」『』（）()]+/gu, ' ').trim()
}

function preprocessCommerceTerms(observations) {
  const normalizedObservations = []
  const retailerSourceTerms = []
  const seenMatches = new Set()
  for (const observation of observations || []) {
    const value = String(observation?.value || '').trim()
    if (!value) continue
    const matches = occurrences(value)
    normalizedObservations.push({ ref: String(observation.ref), value, normalizedValue: normalize(value), commerceText: removeSourceTerms(value, matches) })
    for (const match of matches) {
      const key = `${match.canonicalTerm}:${match.termType}:${observation.ref}`
      if (seenMatches.has(key)) continue
      seenMatches.add(key)
      retailerSourceTerms.push({ ...match, foundIn: String(observation.ref), policyVersion: POLICY_VERSION })
    }
  }
  return { policyVersion: POLICY_VERSION, observations: normalizedObservations, retailerSourceTerms }
}

module.exports = { POLICY_VERSION, TERM_POLICY, normalize, occurrences, preprocessCommerceTerms, removeSourceTerms }
