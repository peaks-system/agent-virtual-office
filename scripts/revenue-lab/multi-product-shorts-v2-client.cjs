'use strict'

const { outputText, OpenAIAnalysisError } = require('./openai-client.cjs')
const { DEFAULT_MODEL, PROMPT_VERSION, SCHEMA_VERSION, SYSTEM_PROMPT,
  THREE_PICKS_V2_JSON_SCHEMA, validateThreePicksV2Output } = require('./multi-product-shorts-v2-schema.cjs')

function createMultiProductShortsV2Client({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.REVENUE_LAB_MULTI_PRODUCT_V2_MODEL || DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.openai.com/v1/responses',
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  async function plan(input) {
    let response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 2200,
          input: [{ role: 'developer', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(input) }],
          text: { format: { type: 'json_schema', name: 'revenue_lab_three_picks_v2', strict: true, schema: THREE_PICKS_V2_JSON_SCHEMA } } }),
      })
    } catch { throw new OpenAIAnalysisError('OPENAI_TRANSPORT_ERROR', 'Creative Archetype v2 planning request failed') }
    let payload
    try { payload = JSON.parse(await response.text()) }
    catch { throw new OpenAIAnalysisError('OPENAI_INVALID_RESPONSE', 'Creative Archetype v2 planning response was invalid', response.status) }
    if (!response.ok) throw new OpenAIAnalysisError('OPENAI_HTTP_ERROR', 'OpenAI rejected the Creative Archetype v2 planning request', response.status)
    let productionPlan
    try { productionPlan = JSON.parse(outputText(payload)) }
    catch (error) {
      if (error instanceof OpenAIAnalysisError) throw error
      throw new OpenAIAnalysisError('OPENAI_INVALID_STRUCTURED_OUTPUT', 'Creative Archetype v2 structured output was invalid')
    }
    validateThreePicksV2Output(productionPlan, input)
    return { productionPlan, responseId: payload.id || null, resolvedModel: payload.model || model,
      usage: { inputTokens: payload.usage?.input_tokens ?? null,
        cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? null } }
  }
  return { model, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, plan }
}

module.exports = { createMultiProductShortsV2Client }
