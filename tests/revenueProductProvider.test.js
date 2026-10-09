import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { API_VERSION, ENDPOINT, createRakutenProductProvider, normalizeRakutenItem } = require('../scripts/revenue-lab/providers/rakuten-product-provider.cjs')

describe('Rakuten product provider', () => {
  it('requires application ID and access key but not affiliate ID', () => {
    expect(() => createRakutenProductProvider({ applicationId: '', accessKey: '' })).toThrow(/required/)
    expect(createRakutenProductProvider({ applicationId: 'app', accessKey: 'key', fetchImpl: vi.fn() }).apiVersion).toBe('20260701')
  })

  it('uses the current endpoint, server header, and availability=1', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 1, page: 1, hits: 1, Items: [{
      itemCode: 'shop:1', itemName: '便利グッズ', itemUrl: 'https://item.rakuten.co.jp/shop/1', itemPrice: 980,
      availability: 1, reviewCount: 2, reviewAverage: 4.5, affiliateRate: 1,
    }] }) }))
    const provider = createRakutenProductProvider({ applicationId: 'app-id', accessKey: 'access-key', affiliateId: 'affiliate-id', fetchImpl, clock: () => new Date('2026-10-09T00:00:00Z') })
    const result = await provider.search({ keyword: '便利グッズ', limit: 30 })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(ENDPOINT).toContain(API_VERSION)
    expect(url.searchParams.get('availability')).toBe('1')
    expect(url.searchParams.get('hits')).toBe('10')
    expect(url.searchParams.get('applicationId')).toBe('app-id')
    expect(url.searchParams.get('affiliateId')).toBe('affiliate-id')
    expect(url.searchParams.has('accessKey')).toBe(false)
    expect(options.headers.accessKey).toBe('access-key')
    expect(result.items[0]).toMatchObject({ providerProductId: 'shop:1', priceAmount: 980, availability: 'available', capturedAt: '2026-10-09T00:00:00.000Z' })
  })

  it('normalizes only provider facts and rejects incomplete products', () => {
    const item = normalizeRakutenItem({ itemCode: 's:1', itemName: '商品', itemUrl: 'https://item.rakuten.co.jp/s/1', mediumImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg' }] }, '2026-10-09T00:00:00Z')
    expect(item.imageUrls).toEqual(['https://thumbnail.image.rakuten.co.jp/a.jpg'])
    expect(item.affiliateUrl).toBeNull()
    expect(() => normalizeRakutenItem({ itemCode: 's:1' }, '2026-10-09T00:00:00Z')).toThrow(/incomplete/)
  })
})
