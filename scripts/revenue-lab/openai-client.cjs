'use strict'

const { ANALYSIS_JSON_SCHEMA, DEFAULT_MODEL, SYSTEM_PROMPT, validateAnalysisOutput } = require('./analysis-schema.cjs')

class OpenAIAnalysisError extends Error {
  constructor(code, message, status = null) { super(message); this.name = 'OpenAIAnalysisError'; this.code = code; this.status = status }
}

function outputText(response) {
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content.type === 'refusal') throw new OpenAIAnalysisError('OPENAI_REFUSED', 'The analysis request was refused')
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text
    }
  }
  throw new OpenAIAnalysisError(response?.status === 'incomplete' ? 'OPENAI_INCOMPLETE' : 'OPENAI_INVALID_RESPONSE', 'The analysis response had no structured output')
}

function createOpenAIAnalysisClient({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.REVENUE_LAB_OPENAI_MODEL || DEFAULT_MODEL,
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.openai.com/v1/responses',
} = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')

  async function analyze(input) {
    let response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model, store: false, reasoning: { effort: 'low' }, max_output_tokens: 1800,
          input: [
            { role: 'developer', content: SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(input) },
          ],
          text: { format: { type: 'json_schema', name: 'revenue_lab_opportunity_analysis', strict: true, schema: ANALYSIS_JSON_SCHEMA } },
        }),
      })
    } catch {
      throw new OpenAIAnalysisError('OPENAI_TRANSPORT_ERROR', 'OpenAI request failed')
    }
    const text = await response.text()
    let payload
    try { payload = text ? JSON.parse(text) : null }
    catch { throw new OpenAIAnalysisError('OPENAI_INVALID_RESPONSE', 'OpenAI returned invalid JSON', response.status) }
    if (!response.ok) throw new OpenAIAnalysisError('OPENAI_HTTP_ERROR', 'OpenAI rejected the analysis request', response.status)
    if (payload?.status === 'failed') throw new OpenAIAnalysisError('OPENAI_FAILED', 'OpenAI could not complete the analysis')
    let analysis
    try { analysis = JSON.parse(outputText(payload)) }
    catch (error) {
      if (error instanceof OpenAIAnalysisError) throw error
      throw new OpenAIAnalysisError('OPENAI_INVALID_STRUCTURED_OUTPUT', 'OpenAI structured output was invalid')
    }
    validateAnalysisOutput(analysis)
    return {
      analysis,
      responseId: payload.id || null,
      resolvedModel: payload.model || model,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? null,
        cachedInputTokens: payload.usage?.input_tokens_details?.cached_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        reasoningTokens: payload.usage?.output_tokens_details?.reasoning_tokens ?? null,
      },
    }
  }

  return { analyze, model }
}

module.exports = { OpenAIAnalysisError, createOpenAIAnalysisClient, outputText }
