'use strict'

const { createHash } = require('node:crypto')

class CompositionBlobStoreError extends Error {
  constructor(code, message, status = null) { super(message); this.name = 'CompositionBlobStoreError'; this.code = code; this.status = status }
}

function safeBucket(value) {
  const bucket = String(value || '').trim()
  if (!/^[a-z0-9][a-z0-9._-]{2,62}$/.test(bucket)) throw new TypeError('Invalid private composition bucket')
  return bucket
}
function safeKey(value) {
  const key = String(value || '')
  if (!/^shorts-outputs\/[0-9a-f-]{36}\/[0-9a-f]{64}\.mp4$/.test(key)) throw new TypeError('Invalid immutable composition object key')
  return key
}

function createSupabaseCompositionBlobStore({ url, serviceRoleKey, bucket, fetchImpl = globalThis.fetch } = {}) {
  if (!url || !serviceRoleKey) throw new Error('Supabase storage credentials are required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const root = String(url).replace(/\/+$/, ''); const bucketName = safeBucket(bucket)
  const headers = extra => ({ apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, ...extra })
  const pathFor = key => `${encodeURIComponent(bucketName)}/${safeKey(key).split('/').map(encodeURIComponent).join('/')}`
  async function putImmutable(key, bytes) {
    const response = await fetchImpl(`${root}/storage/v1/object/${pathFor(key)}`, {
      method: 'POST', headers: headers({ 'content-type': 'video/mp4', 'x-upsert': 'false' }), body: bytes,
    })
    if (response.status === 409) {
      const existing = await readImmutable(key)
      if (createHash('sha256').update(existing).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) {
        throw new CompositionBlobStoreError('COMPOSITION_IMMUTABILITY_CONFLICT', 'Existing output bytes do not match')
      }
      return { alreadyExisted: true }
    }
    if (!response.ok) throw new CompositionBlobStoreError('COMPOSITION_STORAGE_WRITE_FAILED', 'Composition storage write failed', response.status)
    return { alreadyExisted: false }
  }
  async function readImmutable(key) {
    const response = await fetchImpl(`${root}/storage/v1/object/${pathFor(key)}`, { headers: headers({}) })
    if (!response.ok) throw new CompositionBlobStoreError('COMPOSITION_STORAGE_READ_FAILED', 'Composition storage read failed', response.status)
    return Buffer.from(await response.arrayBuffer())
  }
  async function createTemporaryReadUrl(key, expiresInSeconds = 900) {
    const response = await fetchImpl(`${root}/storage/v1/object/sign/${pathFor(key)}`, {
      method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ expiresIn: Math.max(300, Math.min(3600, expiresInSeconds)) }),
    })
    if (!response.ok) throw new CompositionBlobStoreError('COMPOSITION_SIGNED_URL_FAILED', 'Composition preview URL could not be created', response.status)
    const payload = await response.json(); const path = payload?.signedURL || payload?.signedUrl
    const urlValue = /^https:\/\//.test(path || '') ? path : path ? `${root}/storage/v1${path.startsWith('/') ? '' : '/'}${path}` : null
    if (!urlValue || !/^https:\/\//.test(urlValue)) throw new CompositionBlobStoreError('COMPOSITION_SIGNED_URL_FAILED', 'Storage returned an invalid preview URL')
    return urlValue
  }
  return { provider: 'supabase-storage', bucket: bucketName, putImmutable, readImmutable, createTemporaryReadUrl }
}

module.exports = { CompositionBlobStoreError, createSupabaseCompositionBlobStore, safeBucket, safeKey }
