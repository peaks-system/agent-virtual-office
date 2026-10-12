'use strict'

const { createHash } = require('node:crypto')

class ProductAssetBlobStoreError extends Error {
  constructor(code, message, status = null) {
    super(message)
    this.name = 'ProductAssetBlobStoreError'
    this.code = code
    this.status = status
  }
}

function safeBucket(value) {
  const bucket = String(value || '').trim()
  if (!/^[a-z0-9][a-z0-9._-]{2,62}$/.test(bucket)) throw new TypeError('Invalid private asset bucket')
  return bucket
}

function safeObjectKey(value) {
  const key = String(value || '')
  if (!/^product-assets\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(?:png|jpg|webp)$/.test(key)) throw new TypeError('Invalid immutable object key')
  return key
}

function createSupabaseProductAssetBlobStore({ url, serviceRoleKey, bucket, fetchImpl = globalThis.fetch } = {}) {
  if (!url || !serviceRoleKey) throw new Error('Supabase storage credentials are required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const root = String(url).replace(/\/+$/, '')
  const bucketName = safeBucket(bucket)
  const headers = extra => ({ apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, ...extra })
  const objectPath = key => `${encodeURIComponent(bucketName)}/${safeObjectKey(key).split('/').map(encodeURIComponent).join('/')}`

  async function putImmutable(key, bytes, contentType) {
    const response = await fetchImpl(`${root}/storage/v1/object/${objectPath(key)}`, {
      method: 'POST', headers: headers({ 'content-type': contentType, 'x-upsert': 'false' }), body: bytes,
    })
    if (response.status === 409) {
      const existing = await readImmutable(key, Math.max(bytes.length, 1))
      const expected = createHash('sha256').update(bytes).digest('hex')
      const actual = createHash('sha256').update(existing).digest('hex')
      if (existing.length !== bytes.length || actual !== expected) {
        throw new ProductAssetBlobStoreError('ASSET_STORAGE_IMMUTABILITY_CONFLICT', 'Existing immutable asset bytes do not match')
      }
      return { objectKey: safeObjectKey(key), alreadyExisted: true }
    }
    if (!response.ok) throw new ProductAssetBlobStoreError('ASSET_STORAGE_WRITE_FAILED', 'Private asset storage write failed', response.status)
    return { objectKey: safeObjectKey(key), alreadyExisted: false }
  }

  async function readImmutable(key, maxBytes = 15 * 1024 * 1024) {
    const response = await fetchImpl(`${root}/storage/v1/object/${objectPath(key)}`, { headers: headers({}) })
    if (!response.ok) throw new ProductAssetBlobStoreError('ASSET_STORAGE_READ_FAILED', 'Private asset storage read failed', response.status)
    const length = Number(response.headers?.get?.('content-length'))
    if (Number.isFinite(length) && length > maxBytes) throw new ProductAssetBlobStoreError('ASSET_TOO_LARGE', 'Stored asset exceeds the byte limit')
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length > maxBytes) throw new ProductAssetBlobStoreError('ASSET_TOO_LARGE', 'Stored asset exceeds the byte limit')
    return bytes
  }

  async function createTemporaryReadUrl(key, expiresInSeconds = 3600) {
    const expiresIn = Math.max(300, Math.min(Number(expiresInSeconds) || 3600, 3600))
    const response = await fetchImpl(`${root}/storage/v1/object/sign/${objectPath(key)}`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ expiresIn }),
    })
    if (!response.ok) throw new ProductAssetBlobStoreError('ASSET_SIGNED_URL_FAILED', 'Temporary provider input URL could not be created', response.status)
    const payload = await response.json()
    const path = payload?.signedURL || payload?.signedUrl
    const signed = /^https:\/\//.test(path || '') ? path : path ? `${root}/storage/v1${path.startsWith('/') ? '' : '/'}${path}` : null
    if (!signed || !/^https:\/\//.test(signed)) throw new ProductAssetBlobStoreError('ASSET_SIGNED_URL_FAILED', 'Storage returned an invalid temporary URL')
    return signed
  }

  return { provider: 'supabase-storage', bucket: bucketName, putImmutable, readImmutable, createTemporaryReadUrl }
}

module.exports = { ProductAssetBlobStoreError, createSupabaseProductAssetBlobStore, safeBucket, safeObjectKey }
