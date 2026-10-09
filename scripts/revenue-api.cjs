'use strict'

const { permitted } = require('./staff-api.cjs')
const { createSupabaseStore } = require('./revenue-lab/supabase-store.cjs')
const { validHumanScore } = require('./revenue-lab/scoring.cjs')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function configurationStatus(env = process.env) {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'YOUTUBE_API_KEY'].filter(key => !env[key])
  return { configured: missing.length === 0, missing }
}

function errorBody(code, message, details = null) {
  return { error: { code, message, ...(details == null ? {} : { details }) } }
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
        if (!config.configured) return reply(res, 200, { data: { config, queries: [], opportunities: [], trackingOpportunities: [], latestJob: null, latestRun: null, latestTrackingRun: null } })
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
      console.error('[revenue-lab] API request failed', { method: req.method, pathname, code: error?.code || 'REVENUE_API_ERROR' })
      return fail(res, 502, 'REVENUE_SERVICE_ERROR', 'Revenue Labの処理を完了できませんでした。接続設定を確認してください。')
    }
  }

  return { handler, close() {} }
}

module.exports = { UUID, configurationStatus, createRevenueApi, errorBody }
