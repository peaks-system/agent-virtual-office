'use strict'

const { outputText, OpenAIAnalysisError } = require('./openai-client.cjs')
const v1 = require('./creative-production-schema.cjs')
const v2 = require('./creative-production-schema-v2.cjs')

function contractFor(input) {
  return input?.contract?.schema_version === v2.SCHEMA_VERSION ? v2 : v1
}

function createCreativeProductionClient({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.REVENUE_LAB_CREATIVE_PRODUCTION_MODEL || v2.DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.openai.com/v1/responses',
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')

  async function plan(input) {
    const contract = contractFor(input)
    let response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 4200,
          input: [{ role: 'developer', content: contract.SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(input) }],
          text: { format: { type: 'json_schema', name: `revenue_lab_creative_production_plan_${contract.SCHEMA_VERSION === v2.SCHEMA_VERSION ? 'v2' : 'v1'}`, strict: true, schema: contract.CREATIVE_PRODUCTION_JSON_SCHEMA } },
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
    contract.validateCreativeProductionOutput(productionPlan, input)
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
