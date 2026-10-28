'use strict'

const { COMMERCE_TRANSLATION_JSON_SCHEMA, DEFAULT_MODEL, DESCRIPTION_SYSTEM_PROMPT, SYSTEM_PROMPT, validateTranslationOutput } = require('./commerce-translation-schema.cjs')
const { outputText, OpenAIAnalysisError } = require('./openai-client.cjs')

function createCommerceTranslationClient({ apiKey = process.env.OPENAI_API_KEY, model = process.env.REVENUE_LAB_COMMERCE_TRANSLATION_MODEL || DEFAULT_MODEL, fetchImpl = globalThis.fetch, endpoint = 'https://api.openai.com/v1/responses' } = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  async function translate(input) {
    const systemPrompt = input?.source_enrichment?.included ? DESCRIPTION_SYSTEM_PROMPT : SYSTEM_PROMPT
    let response
    try {
      response = await fetchImpl(endpoint, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({
        model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 1600,
        input: [{ role: 'developer', content: systemPrompt }, { role: 'user', content: JSON.stringify(input) }],
        text: { format: { type: 'json_schema', name: 'revenue_lab_commerce_translation', strict: true, schema: COMMERCE_TRANSLATION_JSON_SCHEMA } },
      }) })
    } catch { throw new OpenAIAnalysisError('OPENAI_TRANSPORT_ERROR', 'OpenAI commerce translation request failed') }
    const text = await response.text()
    let payload
    try { payload = text ? JSON.parse(text) : null } catch { throw new OpenAIAnalysisError('OPENAI_INVALID_RESPONSE', 'OpenAI returned invalid JSON', response.status) }
    if (!response.ok) throw new OpenAIAnalysisError('OPENAI_HTTP_ERROR', 'OpenAI rejected the commerce translation request', response.status)
    let proposal
    try { proposal = JSON.parse(outputText(payload)) } catch (error) {
      if (error instanceof OpenAIAnalysisError) throw error
      throw new OpenAIAnalysisError('OPENAI_INVALID_STRUCTURED_OUTPUT', 'OpenAI commerce translation output was invalid')
    }
    const translation = validateTranslationOutput(proposal, input.term_policy)
    return { translation, responseId: payload.id || null, resolvedModel: payload.model || model, usage: {
      inputTokens: payload.usage?.input_tokens ?? null, cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null,
      outputTokens: payload.usage?.output_tokens ?? null, reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? null,
    } }
  }
  return { model, translate }
}

module.exports = { createCommerceTranslationClient }
