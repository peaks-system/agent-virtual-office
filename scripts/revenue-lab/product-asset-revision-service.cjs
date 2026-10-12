'use strict'

const { createHash } = require('node:crypto')
const { promises: dns } = require('node:dns')
const { execFile } = require('node:child_process')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const https = require('node:https')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { inputFingerprint } = require('./canonical-json.cjs')

const execFileAsync = promisify(execFile)
const MAX_BYTES = 12 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

class ProductAssetRevisionError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ProductAssetRevisionError'
    this.code = code
    this.status = status
  }
}

function isPrivateAddress(address) {
  const value = String(address || '').toLowerCase()
  if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7))
  if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:')) return true
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || parts[0] >= 224
}

async function resolvePublicAddress(hostname, lookup = dns.lookup) {
  const records = await lookup(hostname, { all: true, verbatim: true })
  const publicRecords = records.filter(record => !isPrivateAddress(record.address))
  if (!records.length || publicRecords.length !== records.length) throw new ProductAssetRevisionError('ASSET_SOURCE_SSRF_BLOCKED', 'Asset source resolved to a prohibited network')
  return publicRecords[0]
}

async function fetchPublicImage(sourceUrl, { lookup = dns.lookup, requestImpl = https.request, maxBytes = MAX_BYTES, redirects = 3 } = {}) {
  let current = new URL(sourceUrl)
  for (let redirect = 0; redirect <= redirects; redirect += 1) {
    if (current.protocol !== 'https:' || current.username || current.password) throw new ProductAssetRevisionError('ASSET_SOURCE_SSRF_BLOCKED', 'Only public HTTPS asset sources are accepted')
    const resolved = await resolvePublicAddress(current.hostname, lookup)
    const result = await new Promise((resolve, reject) => {
      const request = requestImpl({
        protocol: 'https:', hostname: resolved.address, family: resolved.family, port: current.port || 443,
        path: `${current.pathname}${current.search}`, method: 'GET', servername: current.hostname,
        headers: { host: current.host, accept: 'image/png,image/jpeg,image/webp' }, timeout: 15_000,
      }, response => {
        const status = Number(response.statusCode)
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.resume(); return resolve({ redirect: response.headers.location })
        }
        if (status !== 200) { response.resume(); return reject(new ProductAssetRevisionError('ASSET_SOURCE_FETCH_FAILED', 'Asset source did not return an image', 502)) }
        const declared = Number(response.headers['content-length'])
        if (Number.isFinite(declared) && declared > maxBytes) { response.destroy(); return reject(new ProductAssetRevisionError('ASSET_TOO_LARGE', 'Asset exceeds the byte limit', 413)) }
        const chunks = []; let size = 0
        response.on('data', chunk => {
          size += chunk.length
          if (size > maxBytes) response.destroy(new ProductAssetRevisionError('ASSET_TOO_LARGE', 'Asset exceeds the byte limit', 413))
          else chunks.push(chunk)
        })
        response.on('end', () => resolve({ bytes: Buffer.concat(chunks), declaredType: String(response.headers['content-type'] || '').split(';')[0].toLowerCase() }))
        response.on('error', reject)
      })
      request.on('timeout', () => request.destroy(new ProductAssetRevisionError('ASSET_SOURCE_TIMEOUT', 'Asset source timed out', 504)))
      request.on('error', reject)
      request.end()
    })
    if (result.redirect) {
      if (redirect === redirects) throw new ProductAssetRevisionError('ASSET_SOURCE_REDIRECT_LIMIT', 'Asset source redirected too many times')
      current = new URL(result.redirect, current); continue
    }
    return { ...result, sourceUrl: current.toString() }
  }
  throw new ProductAssetRevisionError('ASSET_SOURCE_FETCH_FAILED', 'Asset source could not be fetched')
}

function inspectImage(bytes, declaredType = '') {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > MAX_BYTES) throw new ProductAssetRevisionError('ASSET_IMAGE_INVALID', 'Asset image bytes are invalid')
  let contentType; let width; let height
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    contentType = 'image/png'; width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    contentType = 'image/jpeg'
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]; offset += 2
      if (marker === 0xd8 || marker === 0xd9) continue
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break
      }
      offset += length
    }
  } else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    contentType = 'image/webp'
    const kind = bytes.toString('ascii', 12, 16)
    if (kind === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3)
    } else if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = bytes.readUInt32LE(21); width = (bits & 0x3fff) + 1; height = ((bits >> 14) & 0x3fff) + 1
    }
  }
  if (!ALLOWED_TYPES.has(contentType) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 12000 || height > 12000) {
    throw new ProductAssetRevisionError('ASSET_IMAGE_DECODE_FAILED', 'Asset could not be decoded as a supported image')
  }
  if (declaredType && declaredType !== 'application/octet-stream' && declaredType !== contentType) throw new ProductAssetRevisionError('ASSET_MIME_MISMATCH', 'Asset MIME does not match its bytes')
  return { contentType, byteSize: bytes.length, pixelWidth: width, pixelHeight: height, contentSha256: createHash('sha256').update(bytes).digest('hex') }
}

function extensionFor(contentType) { return contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' ? 'jpg' : 'webp' }

async function padToNineSixteen(bytes, { powershell = 'powershell.exe', exec = execFileAsync } = {}) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'revenue-lab-i2v-'))
  const inputPath = path.join(temporary, 'input.bin'); const outputPath = path.join(temporary, 'output.png')
  try {
    await writeFile(inputPath, bytes, { flag: 'wx' })
    const script = path.join(__dirname, 'product-asset-image-processor.ps1')
    await exec(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-InputPath', inputPath, '-OutputPath', outputPath, '-TargetWidth', '720', '-TargetHeight', '1280', '-Background', '#FFFFFF'],
    { windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 })
    const output = await readFile(outputPath)
    const metadata = inspectImage(output, 'image/png')
    if (metadata.pixelWidth !== 720 || metadata.pixelHeight !== 1280) throw new ProductAssetRevisionError('ASSET_DERIVATION_FAILED', '9:16 derivation returned unexpected dimensions')
    return { bytes: output, metadata }
  } catch (error) {
    if (error instanceof ProductAssetRevisionError) throw error
    throw new ProductAssetRevisionError('ASSET_DERIVATION_FAILED', '9:16 padding could not be created', 500)
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

function canonicalFingerprint(value) {
  return inputFingerprint(value)
}

async function decodeImage(bytes, { powershell = 'powershell.exe', exec = execFileAsync } = {}) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'revenue-lab-i2v-decode-'))
  const inputPath = path.join(temporary, 'input.bin')
  try {
    await writeFile(inputPath, bytes, { flag: 'wx' })
    const script = path.join(__dirname, 'product-asset-image-processor.ps1')
    const result = await exec(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-InputPath', inputPath, '-InspectOnly'], { windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 })
    const decoded = JSON.parse(String(result.stdout || '{}'))
    if (!Number.isInteger(decoded.width) || !Number.isInteger(decoded.height)) throw new Error('Invalid decode result')
    return { pixelWidth: decoded.width, pixelHeight: decoded.height }
  } catch {
    throw new ProductAssetRevisionError('ASSET_IMAGE_DECODE_FAILED', 'Asset could not be decoded as a supported image')
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

function createProductAssetRevisionService({ store, blobStore, fetchImage = fetchPublicImage, deriveImage = padToNineSixteen, decode = decodeImage } = {}) {
  if (!store || !blobStore) throw new TypeError('Asset revision store and blob store are required')

  async function persist(asset, bytes, metadata, { sourceUrl, i2vAllowed, parent = null, derivationType = 'source_capture', derivationSpec = {} }) {
    const derivationFingerprint = canonicalFingerprint({ parent_sha256: parent?.contentSha256 || null, derivation_type: derivationType, derivation_spec: derivationSpec })
    const objectKey = `product-assets/${asset.id}/${metadata.contentSha256}.${extensionFor(metadata.contentType)}`
    await blobStore.putImmutable(objectKey, bytes, metadata.contentType)
    return store.registerProductAssetRevision(asset.id, {
      sourceUrl, storageProvider: blobStore.provider, storageBucket: blobStore.bucket, immutableObjectKey: objectKey,
      ...metadata, i2vAllowed, parentRevisionId: parent?.id || null, derivationType, derivationSpec, derivationFingerprint,
    })
  }

  async function createFromSource(assetId, { i2vAllowed = false, createNineSixteen = false } = {}) {
    const asset = await store.getProductAsset(assetId)
    if (!asset) throw new ProductAssetRevisionError('PRODUCT_ASSET_NOT_FOUND', 'Product Asset was not found', 404)
    if (i2vAllowed && asset.usagePermission !== 'owned') throw new ProductAssetRevisionError('ASSET_I2V_PERMISSION_DENIED', 'Phase v1 requires an owned Product Asset', 409)
    const source = await fetchImage(asset.assetUrl)
    const metadata = inspectImage(source.bytes, source.declaredType)
    const decoded = await decode(source.bytes)
    if (decoded.pixelWidth !== metadata.pixelWidth || decoded.pixelHeight !== metadata.pixelHeight) {
      throw new ProductAssetRevisionError('ASSET_IMAGE_DECODE_FAILED', 'Decoded image dimensions do not match image headers')
    }
    const root = await persist(asset, source.bytes, metadata, { sourceUrl: source.sourceUrl, i2vAllowed, derivationSpec: { exact_source_bytes: true } })
    if (!createNineSixteen || metadata.pixelWidth * 16 === metadata.pixelHeight * 9) return { sourceRevision: root, usableRevision: root }
    const derived = await deriveImage(source.bytes)
    const revision = await persist(asset, derived.bytes, derived.metadata, {
      sourceUrl: source.sourceUrl, i2vAllowed, parent: root, derivationType: 'pad_9_16',
      derivationSpec: { canvas_width: 720, canvas_height: 1280, fit: 'contain', background: '#FFFFFF', crop: false, stretch: false },
    })
    return { sourceRevision: root, usableRevision: revision }
  }

  return { createFromSource }
}

module.exports = {
  ALLOWED_TYPES, MAX_BYTES, ProductAssetRevisionError, canonicalFingerprint,
  createProductAssetRevisionService, decodeImage, fetchPublicImage, inspectImage, isPrivateAddress, padToNineSixteen, resolvePublicAddress,
}
