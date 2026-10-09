import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { SCORE_WEIGHTS, keywordMatchScore, rankProductCandidates } = require('../scripts/revenue-lab/product-ranking.cjs')
const { productSearchTerms } = require('../scripts/revenue-lab/supabase-store.cjs')

const product = (id, values = {}) => ({ providerProductId: id, title: id, catchcopy: '', reviewCount: null, reviewAverage: null, affiliateRate: null, ...values })

describe('Product Candidate deterministic ranking', () => {
  it('takes at most three normalized terms in analyst-output priority order', () => {
    expect(productSearchTerms({ product_search_keywords: ['  便利　グッズ  ', '収納', '収納'], product_or_theme_name: 'テーマ', similar_product_categories: ['雑貨'] })).toEqual(['便利 グッズ', '収納', 'テーマ'])
  })
  it('uses the approved weights and literal NFKC keyword matching', () => {
    expect(SCORE_WEIGHTS).toEqual({ keywordMatch: .25, searchCoverage: .25, providerRank: .25, reviewCount: .10, reviewAverage: .10, affiliateRate: .05 })
    expect(keywordMatchScore(product('x', { title: '便利グッズ　収納用品' }), ['便利グッズ', '収納'])).toBe(100)
    expect(keywordMatchScore(product('x', { title: '別の商品' }), ['便利グッズ'])).toBe(0)
  })

  it('ranks with unrounded values and records every component', () => {
    const ranked = rankProductCandidates([
      { product: product('b', { title: '便利グッズ', reviewCount: 100, reviewAverage: 4.8, affiliateRate: 2 }), matches: [{ keyword: '便利グッズ', position: 2, resultCount: 2 }] },
      { product: product('a', { title: '便利グッズ', reviewCount: 10, reviewAverage: 4, affiliateRate: 1 }), matches: [{ keyword: '便利グッズ', position: 1, resultCount: 2 }, { keyword: '生活雑貨', position: 1, resultCount: 1 }] },
    ], ['便利グッズ', '生活雑貨'])
    expect(ranked[0]).toMatchObject({ rankPosition: 1, scoreVersion: 'product-rakuten-v1', matchedKeywordCount: 2 })
    expect(Object.keys(ranked[0].savedComponents)).toEqual(['keywordMatch', 'searchCoverage', 'providerRank', 'reviewCount', 'reviewAverage', 'affiliateRate'])
    expect(ranked[0].candidateScore).toBe(Math.round(ranked[0].candidateScoreRaw * 100) / 100)
  })

  it('uses provider ID as the final deterministic tie-break and treats missing commercial facts as zero', () => {
    const ranked = rankProductCandidates([
      { product: product('z'), matches: [{ keyword: '共通', position: 1, resultCount: 1 }] },
      { product: product('a'), matches: [{ keyword: '共通', position: 1, resultCount: 1 }] },
    ], ['共通'])
    expect(ranked.map(item => item.product.providerProductId)).toEqual(['a', 'z'])
    expect(ranked[0].components).toMatchObject({ reviewAverage: 0, affiliateRate: 0 })
  })
})
