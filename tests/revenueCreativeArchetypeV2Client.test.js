import { describe, expect, it, vi } from 'vitest'
import { createMultiProductShortsV2Client } from '../scripts/revenue-lab/multi-product-shorts-v2-client.cjs'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

describe('Creative Archetype v2 planner client', () => {
  it('uses the v2 strict schema without offering template selection', async () => {
    const products = [1, 2, 3].map(index => ({ product_set_item_id: uuid(index), presentation_order: index,
      display_name: `商品${index}`, fact_badge: `事実${index}`, allowed_verified_fact_refs: ['summary'] }))
    const output = { archetype: 'three_picks_v2', theme: '3つの選択肢',
      hook: { display_text: '3つをチェック', tts: '三つをチェックします。' },
      product_presentations: products.map(product => ({ product_set_item_id: product.product_set_item_id,
        presentation_order: product.presentation_order, display_name: product.display_name,
        short_appeal: '短い訴求', fact_badge: product.fact_badge, tts: '確認済みのポイントです。', verified_fact_ref: 'summary' })),
      cta: { display_text: '詳細を見る', tts: '詳細を確認してください。' } }
    const fetchImpl = vi.fn(async (_url, request) => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ id: 'resp_1', model: 'gpt-5-mini', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: {} }), request }))
    const client = createMultiProductShortsV2Client({ apiKey: 'test-key', fetchImpl })
    await expect(client.plan({ products })).resolves.toMatchObject({ productionPlan: output })
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(requestBody.text.format.name).toBe('revenue_lab_three_picks_v2')
    expect(JSON.stringify(requestBody.text.format.schema)).not.toContain('template')
  })
})
