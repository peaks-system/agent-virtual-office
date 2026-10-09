'use strict'

const PROVIDER_ID = 'rakuten-ichiba'
const API_VERSION = '20260701'
const ENDPOINT = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/${API_VERSION}`

class ProductProviderError extends Error {
  constructor(code, message, status = null) {
    super(message)
    this.name = 'ProductProviderError'
    this.code = code
    this.status = status
  }
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function imageUrls(item) {
  const values = [...(item.mediumImageUrls || []), ...(item.smallImageUrls || [])]
  return [...new Set(values.map(value => typeof value === 'string' ? value : value?.imageUrl).filter(value => /^https:\/\//i.test(value || '')))]
}

function normalizeRakutenItem(item, capturedAt) {
  if (!item?.itemCode || !item?.itemName || !item?.itemUrl) throw new ProductProviderError('INVALID_PROVIDER_RESPONSE', 'Rakuten product fields were incomplete')
  return {
    provider: PROVIDER_ID,
    providerProductId: String(item.itemCode),
    title: String(item.itemName),
    catchcopy: item.catchcopy == null ? null : String(item.catchcopy),
    productUrl: String(item.itemUrl),
    affiliateUrl: item.affiliateUrl ? String(item.affiliateUrl) : null,
    imageUrls: imageUrls(item),
    priceAmount: finiteOrNull(item.itemPrice),
    currency: 'JPY',
    availability: 'available',
    shop: { id: item.shopCode ? String(item.shopCode) : null, name: item.shopName ? String(item.shopName) : null, url: item.shopUrl ? String(item.shopUrl) : null },
    genreId: item.genreId == null ? null : String(item.genreId),
    reviewCount: finiteOrNull(item.reviewCount),
    reviewAverage: finiteOrNull(item.reviewAverage),
    affiliateRate: finiteOrNull(item.affiliateRate),
    capturedAt,
    providerFacts: item,
  }
}

function createRakutenProductProvider({
  applicationId = process.env.RAKUTEN_APPLICATION_ID,
  accessKey = process.env.RAKUTEN_ACCESS_KEY,
  affiliateId = process.env.RAKUTEN_AFFILIATE_ID,
  fetchImpl = globalThis.fetch,
  clock = () => new Date(),
} = {}) {
  if (!applicationId || !accessKey) throw new ProductProviderError('RAKUTEN_NOT_CONFIGURED', 'Rakuten application ID and access key are required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')

  async function search({ keyword, limit = 10, signal } = {}) {
    const term = String(keyword || '').trim()
    if (!term || term.length > 128) throw new ProductProviderError('INVALID_PRODUCT_KEYWORD', 'Rakuten keyword must contain 1-128 characters')
    const hits = Math.max(1, Math.min(Number(limit) || 10, 10))
    const url = new URL(ENDPOINT)
    url.searchParams.set('applicationId', applicationId)
    if (affiliateId) url.searchParams.set('affiliateId', affiliateId)
    url.searchParams.set('format', 'json')
    url.searchParams.set('formatVersion', '2')
    url.searchParams.set('keyword', term)
    url.searchParams.set('hits', String(hits))
    url.searchParams.set('availability', '1')
    url.searchParams.set('elements', 'itemName,catchcopy,itemCode,itemPrice,itemUrl,affiliateUrl,smallImageUrls,mediumImageUrls,availability,affiliateRate,reviewCount,reviewAverage,shopName,shopCode,shopUrl,genreId')
    let response
    try { response = await fetchImpl(url, { headers: { accept: 'application/json', accessKey }, signal }) }
    catch { throw new ProductProviderError('PROVIDER_TRANSPORT_ERROR', 'Rakuten product search transport failed') }
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const code = response.status === 429 ? 'RATE_LIMITED' : response.status === 503 ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_HTTP_ERROR'
      throw new ProductProviderError(code, 'Rakuten product search was rejected', response.status)
    }
    const rawItems = payload?.Items || payload?.items
    if (!Array.isArray(rawItems)) throw new ProductProviderError('INVALID_PROVIDER_RESPONSE', 'Rakuten product response was invalid', response.status)
    const fetchedAt = clock().toISOString()
    const availableItems = rawItems.map(item => item?.Item || item?.item || item).filter(item => Number(item?.availability) === 1)
    return {
      provider: PROVIDER_ID,
      apiVersion: API_VERSION,
      fetchedAt,
      totalResults: Math.max(0, Number(payload.count) || 0),
      items: availableItems.map(item => normalizeRakutenItem(item, fetchedAt)),
      requestMetadata: { page: Number(payload.page) || 1, hits: Number(payload.hits) || availableItems.length, availability: 1 },
    }
  }

  return { id: PROVIDER_ID, apiVersion: API_VERSION, search }
}

module.exports = { API_VERSION, ENDPOINT, PROVIDER_ID, ProductProviderError, createRakutenProductProvider, normalizeRakutenItem }
