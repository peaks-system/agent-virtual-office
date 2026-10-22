import { describe, expect, it, vi } from 'vitest'
import { createMultiProductShortsV2Client } from '../scripts/revenue-lab/multi-product-shorts-v2-client.cjs'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

describe('Creative Archetype v2 planner client', () => {
  it('uses the v2 strict schema without offering template selection', async () => {
    const identities = ['車用ゴミ箱', 'スマホホルダー', 'アロマディフューザー']
    const products = [1, 2, 3].map(index => ({ product_set_item_id: uuid(index), presentation_order: index,
      source_product_name: `${identities[index - 1]} 車載用品`, allowed_verified_fact_refs: ['summary'],
      fact_candidates: [{ id: `summary-${index}`, verified_fact_ref: 'summary', text: `確認済み${index}` }] }))
    const output = { archetype: 'three_picks_v2', theme: '3つの選択肢',
      hook: { display_text: '3つをチェック', tts: '三つをチェックします。' },
      product_presentations: products.map(product => ({ product_set_item_id: product.product_set_item_id,
        presentation_order: product.presentation_order, display_name: identities[product.presentation_order - 1],
        short_appeal: `確認済み${product.presentation_order}で使いやすい`, fact_badge: `確認済み${product.presentation_order}`,
        tts: `確認済み${product.presentation_order}の仕様で便利に使えます。`, verified_fact_ref: 'summary',
        identity_anchor: identities[product.presentation_order - 1], evidence_anchors: [`確認済み${product.presentation_order}`] })),
      cta: { display_text: '気になる商品は概要欄へ', tts: '気になる商品は概要欄から確認できます。' } }
    const fetchImpl = vi.fn(async (_url, request) => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ id: 'resp_1', model: 'gpt-5-mini', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: {} }), request }))
    const client = createMultiProductShortsV2Client({ apiKey: 'test-key', fetchImpl })
    await expect(client.plan({ products })).resolves.toMatchObject({ productionPlan: output })
    const requestBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(requestBody.text.format.name).toBe('revenue_lab_three_picks_v2')
    expect(JSON.stringify(requestBody.text.format.schema)).not.toContain('template')
  })
})
