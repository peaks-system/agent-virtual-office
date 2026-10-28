'use strict'

const { permitted } = require('./staff-api.cjs')
const { createSupabaseStore } = require('./revenue-lab/supabase-store.cjs')
const { validHumanScore } = require('./revenue-lab/scoring.cjs')
const { DEFAULT_MODEL } = require('./revenue-lab/analysis-schema.cjs')
const { DEFAULT_MODEL: DEFAULT_COMMERCE_MODEL, DESCRIPTION_PROMPT_VERSION } = require('./revenue-lab/commerce-translation-schema.cjs')
const { DEFAULT_MODEL: DEFAULT_CREATIVE_MODEL, PROMPT_VERSION: CREATIVE_PROMPT_VERSION, SCHEMA_VERSION: CREATIVE_SCHEMA_VERSION } = require('./revenue-lab/creative-production-schema-v2.cjs')
const { DEFAULT_MODEL: DEFAULT_POLLO_MODEL, DEFAULT_RESOLUTION: DEFAULT_POLLO_RESOLUTION, PROVIDER_ID: POLLO_PROVIDER_ID, PROVIDER_VERSION: POLLO_PROVIDER_VERSION, validatedModel: validatedPolloModel } = require('./revenue-lab/providers/pollo-video-generation-provider.cjs')
const { ADAPTER_VERSION: WAN_ADAPTER_VERSION, MANIFEST: WAN_MANIFEST, MODEL: WAN_MODEL,
  PROVIDER_ID: WAN_PROVIDER_ID, PROVIDER_VERSION: WAN_PROVIDER_VERSION } = require('./revenue-lab/providers/pollo-wan-video-generation-provider.cjs')
const { createSupabaseProductAssetBlobStore } = require('./revenue-lab/product-asset-blob-store.cjs')
const { createProductAssetRevisionService, ProductAssetRevisionError } = require('./revenue-lab/product-asset-revision-service.cjs')
const { occurrences } = require('./revenue-lab/commerce-term-policy.cjs')
const { WindowsDpapiYouTubeAnalyticsCredentialStore } = require('./revenue-lab/youtube-analytics-credential-store.cjs')
const { REQUIRED_SCOPES, YouTubeAnalyticsError, createYouTubeAnalyticsClient } = require('./revenue-lab/youtube-analytics-client.cjs')
const { createYouTubeAnalyticsService } = require('./revenue-lab/youtube-analytics-service.cjs')
const { DEFAULT_MODEL: DEFAULT_THREE_PICKS_MODEL, PROMPT_VERSION: THREE_PICKS_PROMPT_VERSION,
  SCHEMA_VERSION: THREE_PICKS_SCHEMA_VERSION } = require('./revenue-lab/multi-product-shorts-schema.cjs')
const { COMPOSITION_VERSION } = require('./revenue-lab/multi-product-shorts-composition.cjs')
const { DEFAULT_MODEL: DEFAULT_THREE_PICKS_V2_MODEL, PROMPT_VERSION: THREE_PICKS_V2_PROMPT_VERSION,
  SCHEMA_VERSION: THREE_PICKS_V2_SCHEMA_VERSION, TEMPLATE_ID: THREE_PICKS_V2_TEMPLATE_ID } = require('./revenue-lab/multi-product-shorts-v2-schema-v5.cjs')
const { COMPOSITION_VERSION: COMPOSITION_V2_VERSION } = require('./revenue-lab/multi-product-shorts-v2-composition.cjs')
const { rendererConfiguration: v2RendererConfiguration } = require('./revenue-lab/providers/local-ffmpeg-composition-v2-provider.cjs')
const { createSupabaseCompositionBlobStore } = require('./revenue-lab/composition-blob-store.cjs')
const { DIRECT_PRODUCT_PLACEHOLDERS, directProductCampaignName } = require('./revenue-lab/direct-product-contract.cjs')
const { ADAPTER_VERSION: ELEVENLABS_ADAPTER_VERSION, OUTPUT_FORMAT: ELEVENLABS_OUTPUT_FORMAT,
  PROVIDER_ID: ELEVENLABS_PROVIDER_ID,
  fingerprintSettingsForModel: elevenLabsFingerprintSettingsForModel } = require('./revenue-lab/providers/elevenlabs-tts-provider.cjs')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function configurationStatus(env = process.env) {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'YOUTUBE_API_KEY'].filter(key => !env[key])
  const audioBucketSeparated = env.REVENUE_LAB_CREATIVE_AUDIO_BUCKET === 'revenue-lab-creative-audio'
    && env.REVENUE_LAB_CREATIVE_AUDIO_BUCKET !== env.REVENUE_LAB_PRODUCT_ASSET_BUCKET
    && env.REVENUE_LAB_CREATIVE_AUDIO_BUCKET !== env.REVENUE_LAB_COMPOSITION_BUCKET
  const ttsMissing = ['ELEVENLABS_API_KEY', 'REVENUE_LAB_ELEVENLABS_MODEL_ID',
    'REVENUE_LAB_ELEVENLABS_VOICE_ID', 'REVENUE_LAB_FFPROBE_PATH'].filter(key => !env[key])
  if (!audioBucketSeparated) ttsMissing.push('REVENUE_LAB_CREATIVE_AUDIO_BUCKET')
  const v2Renderer = v2RendererConfiguration({ ffmpegPath: env.REVENUE_LAB_FFMPEG_PATH,
    ffprobePath: env.REVENUE_LAB_FFPROBE_PATH, fontPath: env.REVENUE_LAB_COMPOSITION_FONT_PATH })
  const v2CompositionMissing = ['REVENUE_LAB_PRODUCT_ASSET_BUCKET', 'REVENUE_LAB_COMPOSITION_BUCKET']
    .filter(key => !env[key])
  if (!audioBucketSeparated) v2CompositionMissing.push('REVENUE_LAB_CREATIVE_AUDIO_BUCKET')
  v2CompositionMissing.push(...v2Renderer.missing)
  return { configured: missing.length === 0, missing, analysis: {
    configured: Boolean(env.OPENAI_API_KEY), missing: env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY'],
    requestedModel: env.REVENUE_LAB_OPENAI_MODEL || DEFAULT_MODEL,
  }, commerceTranslation: {
    configured: Boolean(env.OPENAI_API_KEY), missing: env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY'],
    requestedModel: env.REVENUE_LAB_COMMERCE_TRANSLATION_MODEL || DEFAULT_COMMERCE_MODEL,
    promptVersion: 'commerce-translator-v1', descriptionPromptVersion: DESCRIPTION_PROMPT_VERSION,
    schemaVersion: 'commerce-translation-v1', enrichmentModes: ['metadata_only', 'description'],
  }, creativeProduction: {
    configured: Boolean(env.OPENAI_API_KEY), missing: env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY'],
    requestedModel: env.REVENUE_LAB_CREATIVE_PRODUCTION_MODEL || DEFAULT_CREATIVE_MODEL,
    promptVersion: CREATIVE_PROMPT_VERSION, schemaVersion: CREATIVE_SCHEMA_VERSION,
    targetFormat: 'youtube_shorts', aspectRatio: '9:16', provider: 'provider-neutral',
  }, videoGeneration: {
    configured: Boolean(env.POLLO_API_KEY), missing: env.POLLO_API_KEY ? [] : ['POLLO_API_KEY'],
    provider: POLLO_PROVIDER_ID, providerVersion: POLLO_PROVIDER_VERSION,
    requestedModel: validatedPolloModel(env.REVENUE_LAB_POLLO_MODEL || DEFAULT_POLLO_MODEL),
    resolution: DEFAULT_POLLO_RESOLUTION, aspectRatio: '9:16', audioEnabled: false,
  }, imageToVideo: {
    configured: Boolean(env.POLLO_API_KEY && env.REVENUE_LAB_PRODUCT_ASSET_BUCKET),
    missing: ['POLLO_API_KEY', 'REVENUE_LAB_PRODUCT_ASSET_BUCKET'].filter(key => !env[key]),
    provider: WAN_PROVIDER_ID, providerVersion: WAN_PROVIDER_VERSION, providerAdapterVersion: WAN_ADAPTER_VERSION,
    requestedModel: WAN_MODEL, resolution: '720p', durationSeconds: 5, aspectRatio: '9:16',
    audioEnabled: false, promptBuilderVersion: 'product-i2v-identity-v1', capabilityManifest: WAN_MANIFEST,
  }, productAssetRevisions: {
    configured: Boolean(env.REVENUE_LAB_PRODUCT_ASSET_BUCKET),
    missing: env.REVENUE_LAB_PRODUCT_ASSET_BUCKET ? [] : ['REVENUE_LAB_PRODUCT_ASSET_BUCKET'],
  }, multiProductShorts: {
    configured: Boolean(env.OPENAI_API_KEY), missing: env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY'],
    requestedModel: env.REVENUE_LAB_MULTI_PRODUCT_MODEL || DEFAULT_THREE_PICKS_MODEL,
    archetype: 'three_picks_v1', promptVersion: THREE_PICKS_PROMPT_VERSION,
    schemaVersion: THREE_PICKS_SCHEMA_VERSION,
  }, multiProductShortsV2: {
    configured: Boolean(env.OPENAI_API_KEY), missing: env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY'],
    requestedModel: env.REVENUE_LAB_MULTI_PRODUCT_V2_MODEL || DEFAULT_THREE_PICKS_V2_MODEL,
    archetype: 'three_picks_v2', promptVersion: THREE_PICKS_V2_PROMPT_VERSION,
    schemaVersion: THREE_PICKS_V2_SCHEMA_VERSION, templateId: THREE_PICKS_V2_TEMPLATE_ID,
    templateSelection: 'server_fixed',
  }, textToSpeech: {
    configured: ttsMissing.length === 0, missing: [...new Set(ttsMissing)],
    provider: ELEVENLABS_PROVIDER_ID, providerAdapterVersion: ELEVENLABS_ADAPTER_VERSION,
    requestedModel: env.REVENUE_LAB_ELEVENLABS_MODEL_ID || null,
    voiceConfigured: Boolean(env.REVENUE_LAB_ELEVENLABS_VOICE_ID),
    outputFormat: ELEVENLABS_OUTPUT_FORMAT, storageBucket: 'revenue-lab-creative-audio',
  }, finalComposition: {
    configured: Boolean(env.REVENUE_LAB_PRODUCT_ASSET_BUCKET && env.REVENUE_LAB_COMPOSITION_BUCKET
      && env.REVENUE_LAB_FFMPEG_PATH && env.REVENUE_LAB_FFPROBE_PATH),
    missing: ['REVENUE_LAB_PRODUCT_ASSET_BUCKET', 'REVENUE_LAB_COMPOSITION_BUCKET',
      'REVENUE_LAB_FFMPEG_PATH', 'REVENUE_LAB_FFPROBE_PATH'].filter(key => !env[key]),
    provider: 'local_ffmpeg', providerVersion: COMPOSITION_VERSION,
    output: { width: 1080, height: 1920, fps: 30, audio: false },
  }, finalCompositionV2: {
    configured: v2CompositionMissing.length === 0,
    missing: [...new Set(v2CompositionMissing)],
    provider: 'local_ffmpeg', providerVersion: COMPOSITION_V2_VERSION,
    templateId: THREE_PICKS_V2_TEMPLATE_ID, templateAudioProfile: 'hero-carousel-v2-synthetic-audio-v1',
    output: { width: 1080, height: 1920, fps: 30, videoCodec: 'h264', audioCodec: 'aac',
      audio: true, durationRangeSeconds: [35, 45] },
  }, products: {
    configured: Boolean(env.RAKUTEN_APPLICATION_ID && env.RAKUTEN_ACCESS_KEY),
    missing: ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'].filter(key => !env[key]),
    provider: 'rakuten-ichiba', providerApiVersion: '20260701', affiliateConfigured: Boolean(env.RAKUTEN_AFFILIATE_ID),
  }, youtubeAnalytics: {
    configured: Boolean(env.YOUTUBE_ANALYTICS_CLIENT_ID && env.YOUTUBE_ANALYTICS_CLIENT_SECRET),
    missing: ['YOUTUBE_ANALYTICS_CLIENT_ID', 'YOUTUBE_ANALYTICS_CLIENT_SECRET'].filter(key => !env[key]),
    scopes: REQUIRED_SCOPES,
    credentialStore: 'windows-dpapi',
  } }
}

function errorBody(code, message, details = null) {
  return { error: { code, message, ...(details == null ? {} : { details }) } }
}

function boundedText(value, name, max, { optional = false } = {}) {
  if (optional && (value == null || value === '')) return null
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new TypeError(`Invalid ${name}`)
  return value.trim()
}

function httpsUrl(value, name, { optional = false } = {}) {
  const text = boundedText(value, name, 2048, { optional })
  if (text == null) return null
  let url
  try { url = new URL(text) } catch { throw new TypeError(`Invalid ${name}`) }
  if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError(`Invalid ${name}`)
  return url.toString()
}

function publicationInput(input) {
  const youtubeVideoId = boundedText(input.youtubeVideoId, 'youtubeVideoId', 32, { optional: true })
  if (youtubeVideoId != null && !/^[A-Za-z0-9_-]{6,32}$/.test(youtubeVideoId)) throw new TypeError('Invalid youtubeVideoId')
  const title = boundedText(input.publicationTitle ?? input.title, 'publicationTitle', 200, { optional: true })
  const publishedAt = input.publishedAt == null || input.publishedAt === '' ? null : input.publishedAt
  if (publishedAt != null && (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt)))) throw new TypeError('Invalid publishedAt')
  if (youtubeVideoId == null && (title != null || publishedAt != null)) throw new TypeError('Publication metadata requires youtubeVideoId')
  return { youtubeVideoId, publicationTitle: title, publishedAt: publishedAt == null ? null : new Date(publishedAt).toISOString() }
}

function manualCampaignInput(input) {
  const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
  if (!UUID.test(idempotencyKey)) throw new TypeError('Invalid idempotencyKey')
  const discoveryChannel = boundedText(input.discoveryChannel, 'discoveryChannel', 40)
  if (!['amazon_search', 'rakuten_search', 'yahoo_search', 'google_search', 'direct'].includes(discoveryChannel)) throw new TypeError('Invalid discoveryChannel')
  const currency = boundedText(input.currency || 'JPY', 'currency', 3).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError('Invalid currency')
  const priceAmount = input.priceAmount == null || input.priceAmount === '' ? null : Number(input.priceAmount)
  if (priceAmount != null && (!Number.isFinite(priceAmount) || priceAmount < 0)) throw new TypeError('Invalid priceAmount')
  const publication = publicationInput(input)
  let translationOrigin = null
  if (input.translationOrigin != null) {
    const origin = input.translationOrigin
    if (!origin || typeof origin !== 'object' || !UUID.test(origin.translationId || '') || !UUID.test(origin.keywordId || '') || (origin.feedbackId != null && !UUID.test(origin.feedbackId))) throw new TypeError('Invalid translationOrigin')
    translationOrigin = { translationId: origin.translationId, keywordId: origin.keywordId, feedbackId: origin.feedbackId || null }
  }
  return {
    idempotencyKey,
    campaignName: boundedText(input.campaignName, 'campaignName', 120),
    objective: boundedText(input.objective, 'objective', 1000, { optional: true }),
    discoveryChannel,
    searchKeyword: boundedText(input.searchKeyword, 'searchKeyword', 128),
    merchant: boundedText(input.merchant, 'merchant', 80),
    productName: boundedText(input.productName, 'productName', 240),
    productUrl: httpsUrl(input.productUrl, 'productUrl'),
    affiliateUrl: httpsUrl(input.affiliateUrl, 'affiliateUrl', { optional: true }),
    priceAmount,
    currency,
    productNotes: boundedText(input.productNotes, 'productNotes', 1000, { optional: true }),
    appealHypothesis: boundedText(input.appealHypothesis, 'appealHypothesis', 1000),
    hookText: boundedText(input.hookText, 'hookText', 500),
    contentOutline: boundedText(input.contentOutline, 'contentOutline', 5000),
    scriptText: boundedText(input.scriptText, 'scriptText', 20000, { optional: true }),
    translationOrigin,
    ...publication,
  }
}

function directProductInput(input) {
  const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
  if (!UUID.test(idempotencyKey)) throw new TypeError('Invalid idempotencyKey')
  const currency = boundedText(input.currency || 'JPY', 'currency', 3).toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError('Invalid currency')
  const priceAmount = input.priceAmount == null || input.priceAmount === '' ? null : Number(input.priceAmount)
  if (priceAmount != null && (!Number.isFinite(priceAmount) || priceAmount < 0)) throw new TypeError('Invalid priceAmount')
  if (typeof input.isOwnProduct !== 'boolean') throw new TypeError('Invalid isOwnProduct')
  const assets = input.assets == null ? [] : input.assets
  if (!Array.isArray(assets) || assets.length > 10) throw new TypeError('Invalid assets')
  const assetKinds = new Set(['hero', 'detail', 'package', 'lifestyle', 'logo', 'other'])
  const assetSources = new Set(['self_owned', 'brand_supplied', 'licensed_library', 'retailer_reference', 'other'])
  const permissions = new Set(['owned', 'licensed', 'authorized_reference', 'unknown'])
  const normalizedAssets = assets.map(asset => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw new TypeError('Invalid asset')
    const assetKind = boundedText(asset.assetKind, 'assetKind', 40)
    const assetSource = boundedText(asset.assetSource, 'assetSource', 40)
    const usagePermission = boundedText(asset.usagePermission, 'usagePermission', 40)
    if (!assetKinds.has(assetKind) || !assetSources.has(assetSource) || !permissions.has(usagePermission)) throw new TypeError('Invalid asset policy')
    return {
      assetKind, assetSource, usagePermission,
      assetUrl: httpsUrl(asset.assetUrl, 'assetUrl'),
      label: boundedText(asset.label, 'assetLabel', 160, { optional: true }),
    }
  })
  if (new Set(normalizedAssets.map(asset => asset.assetUrl)).size !== normalizedAssets.length) throw new TypeError('Duplicate assetUrl')
  return {
    idempotencyKey,
    campaignName: directProductCampaignName(input.productName),
    objective: null,
    merchant: boundedText(input.merchant, 'merchant', 80),
    productName: boundedText(input.productName, 'productName', 240),
    productUrl: httpsUrl(input.productUrl, 'productUrl'),
    affiliateUrl: httpsUrl(input.affiliateUrl, 'affiliateUrl', { optional: true }),
    priceAmount, currency,
    productCategory: boundedText(input.productCategory, 'productCategory', 120, { optional: true }),
    verifiedFacts: boundedText(input.verifiedFacts, 'verifiedFacts', 4000),
    cautions: boundedText(input.cautions, 'cautions', 2000, { optional: true }),
    productNotes: boundedText(input.productNotes, 'productNotes', 1000, { optional: true }),
    isOwnProduct: input.isOwnProduct,
    assets: normalizedAssets,
    appealHypothesis: DIRECT_PRODUCT_PLACEHOLDERS.appealHypothesis,
    hookText: DIRECT_PRODUCT_PLACEHOLDERS.hookText,
    contentOutline: DIRECT_PRODUCT_PLACEHOLDERS.contentOutline,
    scriptText: null,
  }
}

function commerceFeedbackInput(input) {
  const action = boundedText(input.action, 'action', 20)
  if (!['approve', 'override', 'reject'].includes(action) || !UUID.test(input.keywordId || '')) throw new TypeError('Invalid Commerce Translation feedback')
  const overrideKeyword = boundedText(input.overrideKeyword, 'overrideKeyword', 128, { optional: true })
  if ((action === 'override') !== Boolean(overrideKeyword)) throw new TypeError('Invalid overrideKeyword')
  if (overrideKeyword && (occurrences(overrideKeyword).length || /https?:\/\/|(?:^|\s)[¥$€£]\s*\d|\b(?:sku|asin|jan)\b/i.test(overrideKeyword))) throw new TypeError('Invalid overrideKeyword')
  return { keywordId: input.keywordId, action, overrideKeyword, notes: boundedText(input.notes, 'notes', 1000, { optional: true }) }
}

function campaignCreativeInput(input) {
  return {
    appealHypothesis: boundedText(input.appealHypothesis, 'appealHypothesis', 1000),
    hookText: boundedText(input.hookText, 'hookText', 500),
    contentOutline: boundedText(input.contentOutline, 'contentOutline', 5000),
    scriptText: boundedText(input.scriptText, 'scriptText', 20000, { optional: true }),
  }
}

function campaignVoidInput(input) {
  const reason = boundedText(input.reason, 'reason', 20)
  if (!['duplicate', 'mistake', 'test', 'other'].includes(reason)) throw new TypeError('Invalid reason')
  const note = boundedText(input.note, 'note', 1000, { optional: true })
  if (reason === 'other' && !note) throw new TypeError('Other reason requires note')
  return { reason, note }
}

function analyticsDateRangeInput(input) {
  const startDate = boundedText(input.startDate, 'startDate', 10)
  const endDate = boundedText(input.endDate, 'endDate', 10)
  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  if (!datePattern.test(startDate) || !datePattern.test(endDate)) throw new TypeError('Invalid Analytics date range')
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || (end - start) / 86_400_000 > 366) {
    throw new TypeError('Invalid Analytics date range')
  }
  return { startDate, endDate }
}

function threePicksCampaignInput(input) {
  const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
  if (!UUID.test(idempotencyKey) || !Array.isArray(input.items) || input.items.length !== 3) throw new TypeError('Invalid Three Picks input')
  const normalized = input.items.map(item => {
    if (!item || !UUID.test(item.curatedProductId || '') || !UUID.test(item.productAssetRevisionId || '')) throw new TypeError('Invalid Three Picks product')
    return { curatedProductId: item.curatedProductId, productAssetRevisionId: item.productAssetRevisionId,
      verifiedFactRef: boundedText(item.verifiedFactRef, 'verifiedFactRef', 160) }
  })
  if (new Set(normalized.map(item => item.curatedProductId)).size !== 3
    || new Set(normalized.map(item => item.productAssetRevisionId)).size !== 3) throw new TypeError('Duplicate Three Picks product')
  return { idempotencyKey, campaignName: boundedText(input.campaignName, 'campaignName', 120),
    objective: boundedText(input.objective, 'objective', 1000, { optional: true }),
    appealHypothesis: boundedText(input.appealHypothesis, 'appealHypothesis', 1000, { optional: true }),
    items: normalized }
}

function threePicksV2CampaignInput(input) {
  const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
  if (!UUID.test(idempotencyKey) || !Array.isArray(input.items) || input.items.length !== 3) throw new TypeError('Invalid Creative Archetype v2 input')
  const normalized = input.items.map(item => {
    if (!item || !UUID.test(item.curatedProductId || '') || !Array.isArray(item.productAssetRevisionIds)
      || item.productAssetRevisionIds.length < 1 || item.productAssetRevisionIds.length > 4
      || item.productAssetRevisionIds.some(id => !UUID.test(id))
      || new Set(item.productAssetRevisionIds).size !== item.productAssetRevisionIds.length) throw new TypeError('Invalid Creative Archetype v2 product')
    return { curatedProductId: item.curatedProductId, productAssetRevisionIds: item.productAssetRevisionIds,
      verifiedFactRef: boundedText(item.verifiedFactRef, 'verifiedFactRef', 160) }
  })
  if (new Set(normalized.map(item => item.curatedProductId)).size !== 3) throw new TypeError('Duplicate Creative Archetype v2 product')
  return { idempotencyKey, campaignName: boundedText(input.campaignName, 'campaignName', 120),
    objective: boundedText(input.objective, 'objective', 1000, { optional: true }), items: normalized }
}

function createRevenueApi({
  authorize = () => true,
  permit = permitted,
  store,
  analyticsService,
  assetRevisionService,
  env = process.env,
  today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }),
} = {}) {
  let storage = store || null
  let analytics = analyticsService || null
  let assetRevisions = assetRevisionService || null
  let compositionBlobs = null
  const config = configurationStatus(env)
  const getStore = () => {
    if (!storage) storage = createSupabaseStore({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY })
    return storage
  }
  const getAnalytics = () => {
    if (!analytics) {
      const credentialStore = new WindowsDpapiYouTubeAnalyticsCredentialStore({
        filePath: env.YOUTUBE_ANALYTICS_CREDENTIAL_STORE_PATH || undefined,
        env,
        repositoryRoot: process.cwd(),
      })
      const client = createYouTubeAnalyticsClient({
        clientId: env.YOUTUBE_ANALYTICS_CLIENT_ID,
        clientSecret: env.YOUTUBE_ANALYTICS_CLIENT_SECRET,
      })
      analytics = createYouTubeAnalyticsService({ store: getStore(), credentialStore, client })
    }
    return analytics
  }
  const getAssetRevisionService = () => {
    if (!assetRevisions) {
      if (!env.REVENUE_LAB_PRODUCT_ASSET_BUCKET) throw new ProductAssetRevisionError('ASSET_STORAGE_NOT_CONFIGURED', 'Private Product Asset storage is not configured', 503)
      const blobStore = createSupabaseProductAssetBlobStore({
        url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
        bucket: env.REVENUE_LAB_PRODUCT_ASSET_BUCKET,
      })
      assetRevisions = createProductAssetRevisionService({ store: getStore(), blobStore })
    }
    return assetRevisions
  }
  const getCompositionBlobStore = () => {
    if (!compositionBlobs) {
      if (!env.REVENUE_LAB_COMPOSITION_BUCKET) throw new Error('Composition storage is not configured')
      compositionBlobs = createSupabaseCompositionBlobStore({ url: env.SUPABASE_URL,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.REVENUE_LAB_COMPOSITION_BUCKET })
    }
    return compositionBlobs
  }
  const reply = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(value))
  }
  const fail = (res, status, code, message, details) => reply(res, status, errorBody(code, message, details))

  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {
      const error = new Error('JSON content type required'); error.code = 'UNSUPPORTED_MEDIA_TYPE'; throw error
    }
    let size = 0
    const chunks = []
    req.setTimeout?.(10_000, () => req.destroy())
    for await (const chunk of req) {
      size += chunk.length
      if (size > 16_384) { const error = new Error('Request too large'); error.code = 'PAYLOAD_TOO_LARGE'; throw error }
      chunks.push(Buffer.from(chunk))
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('JSON object required')
    return value
  }

  function queryPatch(input) {
    const output = {}
    if ('label' in input) {
      if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80) throw new TypeError('Invalid label')
      output.label = input.label.trim()
    }
    if ('queryText' in input) {
      if (typeof input.queryText !== 'string' || !input.queryText.trim() || input.queryText.length > 200) throw new TypeError('Invalid queryText')
      output.query_text = input.queryText.trim()
    }
    for (const [inputKey, outputKey] of [['buyerIntent', 'buyer_intent'], ['commerceFit', 'commerce_fit']]) {
      if (inputKey in input) {
        if (input[inputKey] !== null && !validHumanScore(input[inputKey])) throw new TypeError(`Invalid ${inputKey}`)
        output[outputKey] = input[inputKey]
      }
    }
    if ('enabled' in input) {
      if (typeof input.enabled !== 'boolean') throw new TypeError('Invalid enabled')
      output.enabled = input.enabled
    }
    if (Object.keys(output).length === 0) throw new TypeError('No supported fields')
    return output
  }

  async function handler(req, res) {
    if (!permit(req)) return fail(res, 403, 'FORBIDDEN', 'このPCのAI Officeからアクセスしてください。')
    const pathname = new URL(req.url, 'http://local').pathname.replace(/^\/api\/revenue(?=\/|$)/, '') || '/'
    try {
      if (req.method === 'GET' && pathname === '/dashboard') {
        if (!config.configured) return reply(res, 200, { data: { config, queries: [], opportunities: [], trackingOpportunities: [], analyses: [], commerceTranslations: [], productSearches: [], campaigns: [], youtubeAnalyticsConnection: null, youtubeAnalyticsFlow: { status: 'idle', errorCode: null }, latestJob: null, latestRun: null, latestTrackingRun: null } })
        const limitValue = Number(new URL(req.url, 'http://local').searchParams.get('limit') || 3)
        const limit = Number.isInteger(limitValue) ? Math.max(1, Math.min(limitValue, 3)) : 3
        const dashboard = await getStore().dashboard(limit)
        const analyticsStatus = config.youtubeAnalytics.configured
          ? await getAnalytics().connectionStatus()
          : { flow: { status: 'idle', errorCode: null } }
        return reply(res, 200, { data: { config, ...dashboard, youtubeAnalyticsFlow: analyticsStatus.flow } })
      }
      if (req.method === 'GET' && pathname === '/youtube-analytics/status') {
        if (!config.youtubeAnalytics.configured) return reply(res, 200, { data: { config: config.youtubeAnalytics, flow: { status: 'idle', errorCode: null }, connection: null } })
        return reply(res, 200, { data: { config: config.youtubeAnalytics, ...(await getAnalytics().connectionStatus()) } })
      }
      if (req.method === 'GET' && pathname === '/queries') {
        if (!config.configured) return reply(res, 200, { data: { config, records: [] } })
        return reply(res, 200, { data: { config, records: await getStore().listQueries() } })
      }
      const queryMatch = pathname.match(/^\/queries\/([0-9a-f-]{36})$/i)
      if (req.method === 'PUT' && queryMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!config.configured) return fail(res, 503, 'REVENUE_NOT_CONFIGURED', 'Revenue Labの環境変数を設定してください。', { missing: config.missing })
        if (!UUID.test(queryMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'query idが正しくありません。')
        const updated = await getStore().updateQuery(queryMatch[1], queryPatch(await body(req)))
        if (!updated) return fail(res, 404, 'NOT_FOUND', '検索テーマが見つかりません。')
        return reply(res, 200, { data: updated })
      }
      if (req.method === 'POST' && pathname === '/jobs') {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!config.configured) return fail(res, 503, 'REVENUE_NOT_CONFIGURED', 'Revenue Labの環境変数を設定してください。', { missing: config.missing })
        const input = await body(req)
        if (!UUID.test(input.sourceQueryId || '')) return fail(res, 400, 'VALIDATION_ERROR', 'sourceQueryIdが正しくありません。')
        const result = await getStore().enqueueQuery(input.sourceQueryId, today())
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && pathname === '/tracking/jobs') {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!config.configured) return fail(res, 503, 'REVENUE_NOT_CONFIGURED', 'Revenue Labの環境変数を設定してください。', { missing: config.missing })
        const result = await getStore().enqueueTracking(today())
        return reply(res, result.createdCount > 0 ? 201 : 200, { data: result })
      }
      if (req.method === 'POST' && pathname === '/analysis/jobs') {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!config.configured) return fail(res, 503, 'REVENUE_NOT_CONFIGURED', 'Revenue Labの環境変数を設定してください。', { missing: config.missing })
        if (!config.analysis.configured) return fail(res, 503, 'OPENAI_NOT_CONFIGURED', 'OpenAI分析の環境変数を設定してください。', { missing: config.analysis.missing })
        const input = await body(req)
        const limit = input.limit == null ? 1 : Number(input.limit)
        if (!Number.isInteger(limit) || limit < 1 || limit > 6) return fail(res, 400, 'VALIDATION_ERROR', '分析件数は1〜6で指定してください。')
        const result = await getStore().enqueueAnalysisCandidates(limit, { model: config.analysis.requestedModel })
        return reply(res, result.records.some(record => record.created) ? 201 : 200, { data: result })
      }
      const translationJobMatch = pathname.match(/^\/analyses\/([0-9a-f-]{36})\/commerce-translations\/jobs$/i)
      if (req.method === 'POST' && translationJobMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(translationJobMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'analysis idが正しくありません。')
        if (!config.commerceTranslation.configured) return fail(res, 503, 'OPENAI_NOT_CONFIGURED', 'Commerce Translationの環境変数を設定してください。', { missing: config.commerceTranslation.missing })
        await body(req)
        const result = await getStore().enqueueCommerceTranslation(translationJobMatch[1], { model: config.commerceTranslation.requestedModel })
        return reply(res, result.created ? 201 : 200, { data: result })
      }
      const translationFeedbackMatch = pathname.match(/^\/commerce-translations\/([0-9a-f-]{36})\/feedback$/i)
      if (req.method === 'POST' && translationFeedbackMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(translationFeedbackMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'translation idが正しくありません。')
        return reply(res, 201, { data: await getStore().createCommerceTranslationFeedback(translationFeedbackMatch[1], commerceFeedbackInput(await body(req))) })
      }
      const enrichmentJobMatch = pathname.match(/^\/analyses\/([0-9a-f-]{36})\/source-enrichment\/jobs$/i)
      if (req.method === 'POST' && enrichmentJobMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(enrichmentJobMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'analysis idが正しくありません。')
        if (!config.configured || !config.commerceTranslation.configured) return fail(res, 503, 'SOURCE_ENRICHMENT_NOT_CONFIGURED', 'YouTube description enrichmentの環境変数を設定してください。')
        await body(req)
        const result = await getStore().enqueueYouTubeDescriptionEnrichment(enrichmentJobMatch[1], today(), { model: config.commerceTranslation.requestedModel })
        return reply(res, result.created ? 201 : 200, { data: result })
      }
      const productSearchMatch = pathname.match(/^\/analyses\/([0-9a-f-]{36})\/product-search\/jobs$/i)
      if (req.method === 'POST' && productSearchMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(productSearchMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'analysis idが正しくありません。')
        if (!config.products.configured) return fail(res, 503, 'RAKUTEN_NOT_CONFIGURED', '楽天商品検索の環境変数を設定してください。', { missing: config.products.missing })
        await body(req)
        const result = await getStore().enqueueProductSearch(productSearchMatch[1], today())
        return reply(res, result.created ? 201 : 200, { data: result })
      }
      const manualCampaignMatch = pathname.match(/^\/analyses\/([0-9a-f-]{36})\/campaigns$/i)
      if (req.method === 'POST' && manualCampaignMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!config.configured) return fail(res, 503, 'REVENUE_NOT_CONFIGURED', 'Revenue Labの環境変数を設定してください。', { missing: config.missing })
        if (!UUID.test(manualCampaignMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'analysis idが正しくありません。')
        const result = await getStore().createManualCampaign(manualCampaignMatch[1], manualCampaignInput(await body(req)))
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && pathname === '/direct-products/campaigns') {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(key => !env[key])
        if (missing.length) return fail(res, 503, 'REVENUE_NOT_CONFIGURED', 'Revenue LabのDB環境変数を設定してください。', { missing })
        const result = await getStore().createDirectProductCampaign(directProductInput(await body(req)))
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && pathname === '/three-picks/campaigns') {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        const result = await getStore().createThreePicksCampaign(threePicksCampaignInput(await body(req)))
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && pathname === '/three-picks-v2/campaigns') {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        const result = await getStore().createThreePicksV2Campaign(threePicksV2CampaignInput(await body(req)))
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      const publicationMatch = pathname.match(/^\/campaign-iterations\/([0-9a-f-]{36})\/publications$/i)
      const creativeProductionMatch = pathname.match(/^\/campaign-iterations\/([0-9a-f-]{36})\/production-plans$/i)
      const videoGenerationMatch = pathname.match(/^\/creative-production-plans\/([0-9a-f-]{36})\/scenes\/(\d+)\/video-generations$/i)
      const imageVideoGenerationMatch = pathname.match(/^\/creative-production-plans\/([0-9a-f-]{36})\/scenes\/(\d+)\/image-video-generations$/i)
      const assetRevisionMatch = pathname.match(/^\/product-assets\/([0-9a-f-]{36})\/revisions$/i)
      const threePicksPlanMatch = pathname.match(/^\/campaign-iterations\/([0-9a-f-]{36})\/three-picks-plans$/i)
      const compositionMatch = pathname.match(/^\/three-picks-plans\/([0-9a-f-]{36})\/compositions$/i)
      const threePicksV2PlanMatch = pathname.match(/^\/campaign-iterations\/([0-9a-f-]{36})\/three-picks-v2-plans$/i)
      const compositionV2Match = pathname.match(/^\/three-picks-v2-plans\/([0-9a-f-]{36})\/compositions$/i)
      const audioGenerationMatch = pathname.match(/^\/three-picks-v2-plans\/([0-9a-f-]{36})\/audio-generations$/i)
      const audioArtifactGenerationMatch = pathname.match(/^\/creative-audio-artifacts\/([0-9a-f-]{36})\/generation$/i)
      const compositionPreviewMatch = pathname.match(/^\/composition-outputs\/([0-9a-f-]{36})\/preview$/i)
      if (req.method === 'GET' && compositionPreviewMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(compositionPreviewMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'output idが正しくありません。')
        const output = await getStore().getFinalCompositionOutput(compositionPreviewMatch[1])
        if (!output) return fail(res, 404, 'NOT_FOUND', '完成動画が見つかりません。')
        return reply(res, 200, { data: { previewUrl: await getCompositionBlobStore().createTemporaryReadUrl(output.immutableObjectKey, 900) } })
      }
      if (req.method === 'POST' && compositionMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(compositionMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'plan idが正しくありません。')
        if (!config.finalComposition.configured) return fail(res, 503, 'COMPOSITION_NOT_CONFIGURED', 'Final Composerの環境変数を設定してください。', { missing: config.finalComposition.missing })
        const input = await body(req); const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
        if (!UUID.test(idempotencyKey)) return fail(res, 400, 'VALIDATION_ERROR', 'idempotency keyが正しくありません。')
        const result = await getStore().enqueueFinalComposition(compositionMatch[1], { idempotencyKey })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && audioGenerationMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(audioGenerationMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'plan idが正しくありません。')
        if (!config.textToSpeech.configured) return fail(res, 503, 'TTS_NOT_CONFIGURED', 'ElevenLabs TTSのprivate launcher設定を確認してください。', { missing: config.textToSpeech.missing })
        const input = await body(req); const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
        if (!UUID.test(idempotencyKey)) return fail(res, 400, 'VALIDATION_ERROR', 'idempotency keyが正しくありません。')
        const result = await getStore().enqueueCreativeAudioGeneration(audioGenerationMatch[1], {
          provider: config.textToSpeech.provider, providerAdapterVersion: config.textToSpeech.providerAdapterVersion,
          model: config.textToSpeech.requestedModel, voice: env.REVENUE_LAB_ELEVENLABS_VOICE_ID,
          outputFormat: config.textToSpeech.outputFormat,
          voiceSettings: elevenLabsFingerprintSettingsForModel(config.textToSpeech.requestedModel),
          fingerprintSchemaVersion: 'creative-audio-generation-v2', storageBucket: config.textToSpeech.storageBucket,
          idempotencyKey,
        })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && audioArtifactGenerationMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(audioArtifactGenerationMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'artifact idが正しくありません。')
        if (!config.textToSpeech.configured) return fail(res, 503, 'TTS_NOT_CONFIGURED', 'ElevenLabs TTSのprivate launcher設定を確認してください。', { missing: config.textToSpeech.missing })
        const input = await body(req); const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
        if (!UUID.test(idempotencyKey)) return fail(res, 400, 'VALIDATION_ERROR', 'idempotency keyが正しくありません。')
        const result = await getStore().enqueueCreativeAudioArtifactGeneration(audioArtifactGenerationMatch[1], {
          provider: config.textToSpeech.provider, providerAdapterVersion: config.textToSpeech.providerAdapterVersion,
          model: config.textToSpeech.requestedModel, voice: env.REVENUE_LAB_ELEVENLABS_VOICE_ID,
          outputFormat: config.textToSpeech.outputFormat,
          voiceSettings: elevenLabsFingerprintSettingsForModel(config.textToSpeech.requestedModel),
          fingerprintSchemaVersion: 'creative-audio-generation-v2', storageBucket: config.textToSpeech.storageBucket,
          idempotencyKey,
        })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && compositionV2Match) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(compositionV2Match[1])) return fail(res, 400, 'VALIDATION_ERROR', 'plan idが正しくありません。')
        if (!config.finalCompositionV2.configured) return fail(res, 503, 'COMPOSITION_V2_NOT_CONFIGURED', 'Three Picks v2 MP4合成のruntime設定を確認してください。', { missing: config.finalCompositionV2.missing })
        const input = await body(req); const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
        if (!UUID.test(idempotencyKey)) return fail(res, 400, 'VALIDATION_ERROR', 'idempotency keyが正しくありません。')
        const result = await getStore().enqueueFinalCompositionV2(compositionV2Match[1], { idempotencyKey })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && threePicksPlanMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(threePicksPlanMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'iteration idが正しくありません。')
        if (!config.multiProductShorts.configured) return fail(res, 503, 'THREE_PICKS_NOT_CONFIGURED', 'OpenAI APIを設定してください。')
        const input = await body(req); const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
        if (!UUID.test(idempotencyKey)) return fail(res, 400, 'VALIDATION_ERROR', 'idempotency keyが正しくありません。')
        const result = await getStore().enqueueThreePicksPlan(threePicksPlanMatch[1], {
          idempotencyKey, model: config.multiProductShorts.requestedModel })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && threePicksV2PlanMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(threePicksV2PlanMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'iteration idが正しくありません。')
        if (!config.multiProductShortsV2.configured) return fail(res, 503, 'THREE_PICKS_V2_NOT_CONFIGURED', 'OpenAI APIを設定してください。')
        const input = await body(req); const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
        if (!UUID.test(idempotencyKey)) return fail(res, 400, 'VALIDATION_ERROR', 'idempotency keyが正しくありません。')
        const result = await getStore().enqueueThreePicksV2Plan(threePicksV2PlanMatch[1], {
          idempotencyKey, model: config.multiProductShortsV2.requestedModel })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && assetRevisionMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(assetRevisionMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'Product Asset IDが正しくありません。')
        if (!config.productAssetRevisions.configured) return fail(res, 503, 'ASSET_STORAGE_NOT_CONFIGURED', 'Product Asset用のprivate storageを設定してください。', { missing: config.productAssetRevisions.missing })
        const input = await body(req)
        if (typeof input.i2vAllowed !== 'boolean' || (input.createNineSixteen != null && typeof input.createNineSixteen !== 'boolean')) {
          return fail(res, 400, 'VALIDATION_ERROR', 'Asset Revision設定が正しくありません。')
        }
        const result = await getAssetRevisionService().createFromSource(assetRevisionMatch[1], {
          i2vAllowed: input.i2vAllowed, createNineSixteen: input.createNineSixteen === true,
        })
        return reply(res, 201, { data: result })
      }
      if (req.method === 'POST' && imageVideoGenerationMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(imageVideoGenerationMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'production plan idが正しくありません。')
        const sceneNumber = Number(imageVideoGenerationMatch[2])
        if (!Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 16) return fail(res, 400, 'VALIDATION_ERROR', 'scene番号が正しくありません。')
        if (!config.imageToVideo.configured) return fail(res, 503, 'IMAGE_TO_VIDEO_NOT_CONFIGURED', 'Wan I2Vとprivate storageを設定してください。', { missing: config.imageToVideo.missing })
        const input = await body(req)
        const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
        if (!UUID.test(idempotencyKey) || !UUID.test(input.assetRevisionId || '')
          || (input.regenerate != null && typeof input.regenerate !== 'boolean')) {
          return fail(res, 400, 'VALIDATION_ERROR', 'I2V生成リクエストが正しくありません。')
        }
        const result = await getStore().enqueueImageVideoGeneration(imageVideoGenerationMatch[1], sceneNumber, input.assetRevisionId, {
          idempotencyKey, regenerate: input.regenerate === true, model: config.imageToVideo.requestedModel,
          provider: config.imageToVideo.provider, providerVersion: config.imageToVideo.providerVersion,
          providerAdapterVersion: config.imageToVideo.providerAdapterVersion,
        })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && videoGenerationMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(videoGenerationMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'production plan idが正しくありません。')
        const sceneNumber = Number(videoGenerationMatch[2])
        if (!Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 16) return fail(res, 400, 'VALIDATION_ERROR', 'scene番号が正しくありません。')
        if (!config.videoGeneration.configured) return fail(res, 503, 'POLLO_NOT_CONFIGURED', 'Pollo APIの環境変数を設定してください。', { missing: config.videoGeneration.missing })
        const input = await body(req)
        const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
        if (!UUID.test(idempotencyKey) || (input.regenerate != null && typeof input.regenerate !== 'boolean')) return fail(res, 400, 'VALIDATION_ERROR', '動画生成リクエストが正しくありません。')
        const result = await getStore().enqueueVideoGeneration(videoGenerationMatch[1], sceneNumber, {
          idempotencyKey, regenerate: input.regenerate === true,
          model: config.videoGeneration.requestedModel, provider: config.videoGeneration.provider,
          providerVersion: config.videoGeneration.providerVersion, resolution: config.videoGeneration.resolution,
        })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && creativeProductionMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(creativeProductionMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'iteration idが正しくありません。')
        if (!config.creativeProduction.configured) return fail(res, 503, 'CREATIVE_PRODUCTION_NOT_CONFIGURED', 'Creative Productionの環境変数を設定してください。', { missing: config.creativeProduction.missing })
        const input = await body(req)
        const idempotencyKey = boundedText(input.idempotencyKey, 'idempotencyKey', 36)
        if (!UUID.test(idempotencyKey)) return fail(res, 400, 'VALIDATION_ERROR', 'idempotency keyが正しくありません。')
        const result = await getStore().enqueueCreativeProduction(creativeProductionMatch[1], {
          idempotencyKey, model: config.creativeProduction.requestedModel,
        })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      if (req.method === 'POST' && publicationMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!config.configured) return fail(res, 503, 'REVENUE_NOT_CONFIGURED', 'Revenue Labの環境変数を設定してください。', { missing: config.missing })
        if (!UUID.test(publicationMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'iteration idが正しくありません。')
        const input = publicationInput(await body(req))
        if (!input.youtubeVideoId) return fail(res, 400, 'VALIDATION_ERROR', 'YouTube Video IDを入力してください。')
        return reply(res, 201, { data: await getStore().registerCampaignPublication(publicationMatch[1], input) })
      }
      const draftIterationMatch = pathname.match(/^\/campaign-iterations\/([0-9a-f-]{36})\/draft$/i)
      if (req.method === 'PUT' && draftIterationMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(draftIterationMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'iteration idが正しくありません。')
        return reply(res, 200, { data: await getStore().updateDraftCampaignIteration(draftIterationMatch[1], campaignCreativeInput(await body(req))) })
      }
      const nextIterationMatch = pathname.match(/^\/campaigns\/([0-9a-f-]{36})\/iterations$/i)
      if (req.method === 'POST' && nextIterationMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(nextIterationMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'campaign idが正しくありません。')
        const input = await body(req)
        if (!UUID.test(input.sourceIterationId || '')) return fail(res, 400, 'VALIDATION_ERROR', 'source iteration idが正しくありません。')
        return reply(res, 201, { data: await getStore().createCampaignIteration(nextIterationMatch[1], input.sourceIterationId, campaignCreativeInput(input)) })
      }
      const campaignVoidMatch = pathname.match(/^\/campaigns\/([0-9a-f-]{36})\/void$/i)
      if (req.method === 'POST' && campaignVoidMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(campaignVoidMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'campaign idが正しくありません。')
        return reply(res, 200, { data: await getStore().voidCampaign(campaignVoidMatch[1], campaignVoidInput(await body(req))) })
      }
      const campaignDeleteMatch = pathname.match(/^\/campaigns\/([0-9a-f-]{36})$/i)
      if (req.method === 'DELETE' && campaignDeleteMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(campaignDeleteMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'campaign idが正しくありません。')
        return reply(res, 200, { data: await getStore().hardDeleteDraftCampaign(campaignDeleteMatch[1]) })
      }
      if (req.method === 'POST' && pathname === '/youtube-analytics/oauth/start') {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!config.configured) return fail(res, 503, 'REVENUE_NOT_CONFIGURED', 'Revenue Labの環境変数を設定してください。', { missing: config.missing })
        if (!config.youtubeAnalytics.configured) return fail(res, 503, 'YOUTUBE_ANALYTICS_NOT_CONFIGURED', 'YouTube Analytics OAuthの環境変数を設定してください。', { missing: config.youtubeAnalytics.missing })
        await body(req)
        return reply(res, 202, { data: await getAnalytics().startAuthorization() })
      }
      const analyticsRunMatch = pathname.match(/^\/campaign-publications\/([0-9a-f-]{36})\/youtube-analytics\/runs$/i)
      if (req.method === 'POST' && analyticsRunMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(analyticsRunMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'publication idが正しくありません。')
        if (!config.youtubeAnalytics.configured) return fail(res, 503, 'YOUTUBE_ANALYTICS_NOT_CONFIGURED', 'YouTube Analytics OAuthの環境変数を設定してください。', { missing: config.youtubeAnalytics.missing })
        const range = analyticsDateRangeInput(await body(req))
        return reply(res, 201, { data: await getAnalytics().collect(analyticsRunMatch[1], range) })
      }
      const reviewMatch = pathname.match(/^\/analyses\/([0-9a-f-]{36})\/reviews$/i)
      if (req.method === 'POST' && reviewMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(reviewMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'analysis idが正しくありません。')
        const input = await body(req)
        if (!['adopt', 'hold', 'exclude'].includes(input.decision) || !['agree', 'disagree', 'unsure'].includes(input.agreement)) {
          return fail(res, 400, 'VALIDATION_ERROR', '人間評価の内容を確認してください。')
        }
        if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 1000)) return fail(res, 400, 'VALIDATION_ERROR', 'メモは1000文字以内です。')
        return reply(res, 201, { data: await getStore().createAnalysisReview(reviewMatch[1], input) })
      }
      const productDecisionMatch = pathname.match(/^\/product-candidates\/([0-9a-f-]{36})\/decisions$/i)
      if (req.method === 'POST' && productDecisionMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!UUID.test(productDecisionMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'candidate idが正しくありません。')
        const input = await body(req)
        if (!UUID.test(input.analysisId || '') || !['selected_for_research', 'shortlisted', 'hold', 'rejected'].includes(input.decision)) {
          return fail(res, 400, 'VALIDATION_ERROR', '商品候補の判断内容を確認してください。')
        }
        if (input.notes != null && (typeof input.notes !== 'string' || input.notes.length > 1000)) return fail(res, 400, 'VALIDATION_ERROR', 'メモは1000文字以内です。')
        return reply(res, 201, { data: await getStore().createProductDecision(productDecisionMatch[1], input.analysisId, input) })
      }
      if (!['GET', 'PUT', 'POST', 'DELETE'].includes(req.method)) {
        res.setHeader('Allow', 'GET, PUT, POST, DELETE')
        return fail(res, 405, 'METHOD_NOT_ALLOWED', 'この操作には対応していません。')
      }
      return fail(res, 404, 'NOT_FOUND', 'Revenue Labの操作が見つかりません。')
    } catch (error) {
      if (error?.code === 'TYPED_FACT_CANDIDATE_MISSING') {
        const productIndex = Number.isInteger(error.productIndex) && error.productIndex >= 1 && error.productIndex <= 3
          ? error.productIndex : null
        const reason = error.reason === 'no safe typed fact candidate could be compiled'
          ? error.reason : 'no safe typed fact candidate could be compiled'
        return fail(res, 422, error.code,
          productIndex ? `商品${productIndex}から安全な事実ラベルを作成できませんでした` : '商品から安全な事実ラベルを作成できませんでした',
          { ...(productIndex ? { product_index: productIndex } : {}), reason })
      }
      if (error?.code === 'REVENUE_EVIDENCE_PREPARATION_FAILED') {
        return fail(res, 422, error.code, '商品情報から動画用の根拠データを作成できませんでした。商品説明の形式を確認してください。')
      }
      const inputCodes = new Set(['UNSUPPORTED_MEDIA_TYPE', 'PAYLOAD_TOO_LARGE'])
      if (error instanceof SyntaxError || error instanceof TypeError || inputCodes.has(error?.code)) {
        const status = error?.code === 'UNSUPPORTED_MEDIA_TYPE' ? 415 : error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400
        return fail(res, status, 'VALIDATION_ERROR', '入力内容を確認してください。')
      }
      if (error instanceof YouTubeAnalyticsError || /^YOUTUBE_|^OAUTH_|^GOOGLE_|^REFRESH_|^REAUTH_|^CHANNEL_|^VIDEO_|^CREDENTIAL_|^SYSTEM_BROWSER_/.test(error?.code || '')) {
        const code = error?.code || 'YOUTUBE_ANALYTICS_ERROR'
        const status = code === 'REAUTH_REQUIRED' || code === 'YOUTUBE_ANALYTICS_NOT_CONNECTED' ? 409
          : code === 'GOOGLE_RATE_LIMIT' ? 429 : code === 'VIDEO_NOT_FOUND_OR_DENIED' ? 404 : 502
        return fail(res, status, code, 'YouTube Analyticsの処理を完了できませんでした。接続状態と対象動画を確認してください。')
      }
      if (/^(?:COMMERCE_|SOURCE_ENRICHMENT_)/.test(error?.code || '')) {
        const status = error.status === 404 ? 404 : error.status === 409 ? 409 : 400
        return fail(res, status, error.code, 'Commerce Translationの状態または検索語を確認してください。')
      }
      if (/^CREATIVE_PRODUCTION_/.test(error?.code || '')) {
        const status = error.status === 404 ? 404 : error.status === 409 ? 409 : 400
        return fail(res, status, error.code, 'Creative Productionの対象lineageまたは入力状態を確認してください。')
      }
      if (/^(?:THREE_PICKS_|COMPOSITION_)/.test(error?.code || '')) {
        const status = error.status === 404 ? 404 : error.status === 409 ? 409 : 400
        return fail(res, status, error.code, 'Three Picks制作案または動画合成の入力・状態を確認してください。')
      }
      if (/^CREATIVE_AUDIO_/.test(error?.code || '')) {
        const status = error.status === 404 ? 404 : error.status === 409 ? 409 : 400
        return fail(res, status, error.code, 'Creative Audio Artifactの状態を確認してください。')
      }
      if (/^(?:VIDEO_GENERATION_|POLLO_)/.test(error?.code || '')) {
        const status = error.status === 404 ? 404 : error.status === 409 ? 409 : error.code === 'POLLO_RATE_LIMITED' ? 429 : 400
        return fail(res, status, error.code, '動画素材の生成処理を完了できませんでした。Provider設定とscene状態を確認してください。')
      }
      if (error instanceof ProductAssetRevisionError || /^(?:ASSET_|PRODUCT_ASSET_)/.test(error?.code || '')) {
        const status = Number(error.status) || (error.code === 'PRODUCT_ASSET_NOT_FOUND' ? 404 : 400)
        return fail(res, status, error.code, 'Product Asset Revisionを作成または利用できませんでした。素材・権限・Storage設定を確認してください。')
      }
      if (/^CAMPAIGN_/.test(error?.code || '')) {
        const status = error.status === 404 ? 404 : error.status === 409 ? 409 : 400
        return fail(res, status, error.code, status === 409 ? '公開・計測済みの履歴は変更または削除できません。新しいIterationまたは無効化を利用してください。' : 'Campaignの状態または入力内容を確認してください。')
      }
      console.error('[revenue-lab] API request failed', { method: req.method, pathname, code: error?.code || 'REVENUE_API_ERROR' })
      return fail(res, 502, 'REVENUE_SERVICE_ERROR', 'Revenue Labの処理を完了できませんでした。接続設定を確認してください。')
    }
  }

  return { handler, close() { analytics?.close?.() } }
}

module.exports = { UUID, analyticsDateRangeInput, commerceFeedbackInput, configurationStatus, createRevenueApi,
  DIRECT_PRODUCT_PLACEHOLDERS, directProductInput, errorBody, manualCampaignInput, publicationInput,
  threePicksCampaignInput, threePicksV2CampaignInput }
