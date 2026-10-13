'use strict'

const { outputText, OpenAIAnalysisError } = require('./openai-client.cjs')
const { DEFAULT_MODEL, PROMPT_VERSION, SCHEMA_VERSION, SYSTEM_PROMPT,
  THREE_PICKS_JSON_SCHEMA, validateThreePicksOutput } = require('./multi-product-shorts-schema.cjs')

function createMultiProductShortsClient({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.REVENUE_LAB_MULTI_PRODUCT_MODEL || DEFAULT_MODEL,
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
        body: JSON.stringify({
          model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 1800,
          input: [{ role: 'developer', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(input) }],
          text: { format: { type: 'json_schema', name: 'revenue_lab_three_picks_v1', strict: true, schema: THREE_PICKS_JSON_SCHEMA } },
        }),
      })
    } catch { throw new OpenAIAnalysisError('OPENAI_TRANSPORT_ERROR', 'Three Picks planning request failed') }
    let payload
    try { payload = JSON.parse(await response.text()) }
    catch { throw new OpenAIAnalysisError('OPENAI_INVALID_RESPONSE', 'Three Picks planning response was invalid', response.status) }
    if (!response.ok) throw new OpenAIAnalysisError('OPENAI_HTTP_ERROR', 'OpenAI rejected the Three Picks planning request', response.status)
    let productionPlan
    try { productionPlan = JSON.parse(outputText(payload)) }
    catch (error) {
      if (error instanceof OpenAIAnalysisError) throw error
      throw new OpenAIAnalysisError('OPENAI_INVALID_STRUCTURED_OUTPUT', 'Three Picks structured output was invalid')
    }
    validateThreePicksOutput(productionPlan, input)
    return {
      productionPlan, responseId: payload.id || null, resolvedModel: payload.model || model,
      usage: { inputTokens: payload.usage?.input_tokens ?? null,
        cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? null },
    }
  }
  return { model, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION, plan }
}

module.exports = { createMultiProductShortsClient }
