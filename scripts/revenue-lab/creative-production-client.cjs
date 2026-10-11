'use strict'

const { outputText, OpenAIAnalysisError } = require('./openai-client.cjs')
const { CREATIVE_PRODUCTION_JSON_SCHEMA, DEFAULT_MODEL, SYSTEM_PROMPT, validateCreativeProductionOutput } = require('./creative-production-schema.cjs')

function createCreativeProductionClient({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.REVENUE_LAB_CREATIVE_PRODUCTION_MODEL || DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.openai.com/v1/responses',
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')

  async function plan(input) {
    let response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 4200,
          input: [{ role: 'developer', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(input) }],
          text: { format: { type: 'json_schema', name: 'revenue_lab_creative_production_plan', strict: true, schema: CREATIVE_PRODUCTION_JSON_SCHEMA } },
        }),
      })
    } catch { throw new OpenAIAnalysisError('OPENAI_TRANSPORT_ERROR', 'OpenAI creative production request failed') }
    const text = await response.text()
    let payload
    try { payload = text ? JSON.parse(text) : null }
    catch { throw new OpenAIAnalysisError('OPENAI_INVALID_RESPONSE', 'OpenAI returned invalid JSON', response.status) }
    if (!response.ok) throw new OpenAIAnalysisError('OPENAI_HTTP_ERROR', 'OpenAI rejected the creative production request', response.status)
    let productionPlan
    try { productionPlan = JSON.parse(outputText(payload)) }
    catch (error) {
      if (error instanceof OpenAIAnalysisError) throw error
      throw new OpenAIAnalysisError('OPENAI_INVALID_STRUCTURED_OUTPUT', 'OpenAI creative production output was invalid')
    }
    validateCreativeProductionOutput(productionPlan, input)
    return {
      productionPlan, responseId: payload.id || null, resolvedModel: payload.model || model,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? null,
        cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? null,
      },
    }
  }
  return { model, plan }
}

module.exports = { createCreativeProductionClient }
