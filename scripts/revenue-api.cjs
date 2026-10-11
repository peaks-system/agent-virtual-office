'use strict'

const { permitted } = require('./staff-api.cjs')
const { createSupabaseStore } = require('./revenue-lab/supabase-store.cjs')
const { validHumanScore } = require('./revenue-lab/scoring.cjs')
const { DEFAULT_MODEL } = require('./revenue-lab/analysis-schema.cjs')
const { DEFAULT_MODEL: DEFAULT_CREATIVE_MODEL, PROMPT_VERSION: CREATIVE_PROMPT_VERSION, SCHEMA_VERSION: CREATIVE_SCHEMA_VERSION } = require('./revenue-lab/creative-production-schema.cjs')
const { DEFAULT_MODEL: DEFAULT_POLLO_MODEL, DEFAULT_RESOLUTION: DEFAULT_POLLO_RESOLUTION, PROVIDER_ID: POLLO_PROVIDER_ID, PROVIDER_VERSION: POLLO_PROVIDER_VERSION, validatedModel: validatedPolloModel } = require('./revenue-lab/providers/pollo-video-generation-provider.cjs')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function configurationStatus(env = process.env) {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'YOUTUBE_API_KEY'].filter(key => !env[key])
  return { configured: missing.length === 0, missing, analysis: {
    configured: Boolean(env.OPENAI_API_KEY), missing: env.OPENAI_API_KEY ? [] : ['OPENAI_API_KEY'],
    requestedModel: env.REVENUE_LAB_OPENAI_MODEL || DEFAULT_MODEL,
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
  }, products: {
    configured: Boolean(env.RAKUTEN_APPLICATION_ID && env.RAKUTEN_ACCESS_KEY),
    missing: ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'].filter(key => !env[key]),
    provider: 'rakuten-ichiba', providerApiVersion: '20260701', affiliateConfigured: Boolean(env.RAKUTEN_AFFILIATE_ID),
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
    ...publication,
  }
}

function createRevenueApi({
  authorize = () => true,
  permit = permitted,
  store,
  env = process.env,
  today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' }),
} = {}) {
  let storage = store || null
  const config = configurationStatus(env)
  const getStore = () => {
    if (!storage) storage = createSupabaseStore({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY })
    return storage
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
        if (!config.configured) return reply(res, 200, { data: { config, queries: [], opportunities: [], trackingOpportunities: [], analyses: [], productSearches: [], campaigns: [], latestJob: null, latestRun: null, latestTrackingRun: null } })
        const limitValue = Number(new URL(req.url, 'http://local').searchParams.get('limit') || 3)
        const limit = Number.isInteger(limitValue) ? Math.max(1, Math.min(limitValue, 3)) : 3
        return reply(res, 200, { data: { config, ...(await getStore().dashboard(limit)) } })
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
      const creativeProductionMatch = pathname.match(/^\/campaign-iterations\/([0-9a-f-]{36})\/production-plans$/i)
      const videoGenerationMatch = pathname.match(/^\/creative-production-plans\/([0-9a-f-]{36})\/scenes\/(\d+)\/video-generations$/i)
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
        const result = await getStore().enqueueCreativeProduction(creativeProductionMatch[1], { idempotencyKey, model: config.creativeProduction.requestedModel })
        return reply(res, result?.created === false ? 200 : 201, { data: result })
      }
      const publicationMatch = pathname.match(/^\/campaign-iterations\/([0-9a-f-]{36})\/publications$/i)
      if (req.method === 'POST' && publicationMatch) {
        if (!authorize(req)) return fail(res, 401, 'UNAUTHORIZED', '操作にはAI Officeの認証が必要です。')
        if (!config.configured) return fail(res, 503, 'REVENUE_NOT_CONFIGURED', 'Revenue Labの環境変数を設定してください。', { missing: config.missing })
        if (!UUID.test(publicationMatch[1])) return fail(res, 400, 'VALIDATION_ERROR', 'iteration idが正しくありません。')
        const input = publicationInput(await body(req))
        if (!input.youtubeVideoId) return fail(res, 400, 'VALIDATION_ERROR', 'YouTube Video IDを入力してください。')
        return reply(res, 201, { data: await getStore().registerCampaignPublication(publicationMatch[1], input) })
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
      if (!['GET', 'PUT', 'POST'].includes(req.method)) {
        res.setHeader('Allow', 'GET, PUT, POST')
        return fail(res, 405, 'METHOD_NOT_ALLOWED', 'この操作には対応していません。')
      }
      return fail(res, 404, 'NOT_FOUND', 'Revenue Labの操作が見つかりません。')
    } catch (error) {
      const inputCodes = new Set(['UNSUPPORTED_MEDIA_TYPE', 'PAYLOAD_TOO_LARGE'])
      if (error instanceof SyntaxError || error instanceof TypeError || inputCodes.has(error?.code)) {
        const status = error?.code === 'UNSUPPORTED_MEDIA_TYPE' ? 415 : error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400
        return fail(res, status, 'VALIDATION_ERROR', '入力内容を確認してください。')
      }
      if (/^CREATIVE_PRODUCTION_/.test(error?.code || '')) {
        const status = error.status === 404 ? 404 : error.status === 409 ? 409 : 400
        return fail(res, status, error.code, 'Creative Productionの対象lineageまたは入力状態を確認してください。')
      }
      if (/^(?:VIDEO_GENERATION_|POLLO_)/.test(error?.code || '')) {
        const status = error.status === 404 ? 404 : error.status === 409 ? 409 : error.code === 'POLLO_RATE_LIMITED' ? 429 : 400
        return fail(res, status, error.code, '動画素材の生成処理を完了できませんでした。Provider設定とscene状態を確認してください。')
      }
      console.error('[revenue-lab] API request failed', { method: req.method, pathname, code: error?.code || 'REVENUE_API_ERROR' })
      return fail(res, 502, 'REVENUE_SERVICE_ERROR', 'Revenue Labの処理を完了できませんでした。接続設定を確認してください。')
    }
  }

  return { handler, close() {} }
}

module.exports = { UUID, configurationStatus, createRevenueApi, errorBody, manualCampaignInput, publicationInput }
