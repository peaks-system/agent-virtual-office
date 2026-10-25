'use strict'

const { outputText, OpenAIAnalysisError } = require('./openai-client.cjs')
const v4 = require('./multi-product-shorts-v2-schema.cjs')
const v5 = require('./multi-product-shorts-v2-schema-v5.cjs')

const SAFE_PROVIDER_TOKEN = /^[A-Za-z0-9_.:-]{1,80}$/u

function safeOpenAiHttpDiagnostics(payload, status) {
  const providerError = payload?.error
  const providerErrorCode = typeof providerError?.code === 'string' && SAFE_PROVIDER_TOKEN.test(providerError.code)
    ? providerError.code : null
  const providerErrorType = typeof providerError?.type === 'string' && SAFE_PROVIDER_TOKEN.test(providerError.type)
    ? providerError.type : null
  const providerMessage = typeof providerError?.message === 'string' ? providerError.message : ''
  const schemaError = providerErrorCode === 'invalid_json_schema'
    || /(?:json\s*schema|response\s*schema|unsupported\s*keyword|uniqueItems)/iu.test(providerMessage)
  return { code: 'OPENAI_HTTP_ERROR',
    ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { http_status: status } : {}),
    ...(providerErrorCode ? { provider_error_code: providerErrorCode } : {}),
    ...(providerErrorType ? { provider_error_type: providerErrorType } : {}),
    reason: schemaError ? 'response schema contains an unsupported keyword' : 'provider rejected the planning request' }
}

function createMultiProductShortsV2Client({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.REVENUE_LAB_MULTI_PRODUCT_V2_MODEL || v5.DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.openai.com/v1/responses',
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  async function plan(input) {
    const contract = input?.contract?.schema_version === v5.SCHEMA_VERSION ? v5 : v4
    const requestInput = contract === v5 ? v5.plannerInput(input) : input
    const responseSchema = contract === v5 ? v5.responseSchemaForInput(requestInput) : contract.THREE_PICKS_V2_JSON_SCHEMA
    let response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 2200,
          input: [{ role: 'developer', content: contract.SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(requestInput) }],
          text: { format: { type: 'json_schema',
            name: contract === v5 ? 'revenue_lab_three_picks_v2_v5' : 'revenue_lab_three_picks_v2',
            strict: true, schema: responseSchema } } }),
      })
    } catch { throw new OpenAIAnalysisError('OPENAI_TRANSPORT_ERROR', 'Creative Archetype v2 planning request failed') }
    let payload
    try { payload = JSON.parse(await response.text()) }
    catch { throw new OpenAIAnalysisError('OPENAI_INVALID_RESPONSE', 'Creative Archetype v2 planning response was invalid', response.status) }
    if (!response.ok) {
      const error = new OpenAIAnalysisError('OPENAI_HTTP_ERROR', 'OpenAI rejected the Creative Archetype v2 planning request', response.status)
      error.safeDiagnostics = safeOpenAiHttpDiagnostics(payload, response.status)
      throw error
    }
    let plannerOutput
    try { plannerOutput = JSON.parse(outputText(payload)) }
    catch (error) {
      if (error instanceof OpenAIAnalysisError) throw error
      throw new OpenAIAnalysisError('OPENAI_INVALID_STRUCTURED_OUTPUT', 'Creative Archetype v2 structured output was invalid')
    }
    const productionPlan = contract === v5
      ? v5.formatThreePicksV5Plan(plannerOutput, input)
      : v4.validateThreePicksV2Output(plannerOutput, input)
    return { productionPlan, responseId: payload.id || null, resolvedModel: payload.model || model,
      usage: { inputTokens: payload.usage?.input_tokens ?? null,
        cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? null } }
  }
  return { model, promptVersion: v5.PROMPT_VERSION, schemaVersion: v5.SCHEMA_VERSION, plan }
}

module.exports = { createMultiProductShortsV2Client }
