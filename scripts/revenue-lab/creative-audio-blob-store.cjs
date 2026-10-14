'use strict'

const { createHash } = require('node:crypto')

class CreativeAudioBlobStoreError extends Error {
  constructor(code, message, status = null) { super(message); this.name = 'CreativeAudioBlobStoreError'; this.code = code; this.status = status }
}

function safeAudioBucket(value) {
  const bucket = String(value || '').trim()
  if (!/^[a-z0-9][a-z0-9._-]{2,62}$/.test(bucket)) throw new TypeError('Invalid private Creative Audio bucket')
  return bucket
}

function safeAudioKey(value) {
  const key = String(value || '')
  if (!/^creative-audio\/[0-9a-f-]{36}\/[a-z0-9-]{3,80}\/[0-9a-f]{64}\.(mp3|wav|m4a)$/.test(key)) {
    throw new TypeError('Invalid immutable Creative Audio object key')
  }
  return key
}

function createSupabaseCreativeAudioBlobStore({ url, serviceRoleKey, bucket, fetchImpl = globalThis.fetch } = {}) {
  if (!url || !serviceRoleKey) throw new Error('Supabase storage credentials are required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const root = String(url).replace(/\/+$/, ''); const bucketName = safeAudioBucket(bucket)
  const headers = extra => ({ apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, ...extra })
  const pathFor = key => `${encodeURIComponent(bucketName)}/${safeAudioKey(key).split('/').map(encodeURIComponent).join('/')}`
  async function putImmutable(key, bytes, contentType = 'audio/mpeg') {
    const response = await fetchImpl(`${root}/storage/v1/object/${pathFor(key)}`, {
      method: 'POST', headers: headers({ 'content-type': contentType, 'x-upsert': 'false' }), body: bytes,
    })
    if (response.status === 409) {
      const existing = await readImmutable(key)
      if (createHash('sha256').update(existing).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) {
        throw new CreativeAudioBlobStoreError('CREATIVE_AUDIO_IMMUTABILITY_CONFLICT', 'Existing audio bytes do not match')
      }
      return { alreadyExisted: true }
    }
    if (!response.ok) throw new CreativeAudioBlobStoreError('CREATIVE_AUDIO_STORAGE_WRITE_FAILED', 'Creative Audio storage write failed', response.status)
    return { alreadyExisted: false }
  }
  async function readImmutable(key) {
    const response = await fetchImpl(`${root}/storage/v1/object/${pathFor(key)}`, { headers: headers({}) })
    if (!response.ok) throw new CreativeAudioBlobStoreError('CREATIVE_AUDIO_STORAGE_READ_FAILED', 'Creative Audio storage read failed', response.status)
    return Buffer.from(await response.arrayBuffer())
  }
  return { provider: 'supabase-storage', bucket: bucketName, putImmutable, readImmutable }
}

module.exports = { CreativeAudioBlobStoreError, createSupabaseCreativeAudioBlobStore, safeAudioBucket, safeAudioKey }
