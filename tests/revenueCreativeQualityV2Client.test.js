import { describe, expect, it, vi } from 'vitest'
import { createMultiProductShortsV2Client } from '../scripts/revenue-lab/multi-product-shorts-v2-client.cjs'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

describe('Three Picks planner-v4 client dispatch', () => {
  it('uses schema-v5 for new input and returns the deterministic formatted plan', async () => {
    const products = [1, 2, 3].map(index => ({
      product_set_item_id: uuid(index), presentation_order: index, allowed_verified_fact_refs: ['summary'],
      identity_candidates: [{ identity_id: `${uuid(index)}:identity:item-${index}`, display_name: `車載用品${index}` }],
      fact_candidates: [{ id: `summary-${index}`, verified_fact_ref: 'summary', text: `LEDライト付きで夜でも使用できます${index}`,
        source_anchor: `LEDライト付きで夜でも使用できます${index}`,
        facts: [{ fact_id: `summary-${index}:feature:led`, type: 'feature', key: 'led',
          canonical_value: true, display_text: 'LED搭載' }] }],
      selectable_facts: [{ fact_id: `summary-${index}:feature:led`, source_candidate_id: `summary-${index}`,
        type: 'feature', key: 'led', canonical_value: true, display_text: 'LED搭載' }],
    }))
    const output = { archetype: 'three_picks_v2', theme: '車内用品',
      hook: { display_text: '車内用品3選', tts: '車内用品三選' },
      product_presentations: products.map((product, index) => ({
        product_set_item_id: product.product_set_item_id, presentation_order: index + 1,
        identity_id: product.identity_candidates[0].identity_id,
        fact_id: product.fact_candidates[0].facts[0].fact_id,
        short_appeal: 'LED付きで夜も使いやすい', short_appeal_evidence_ids: [`summary-${index + 1}`],
        tts: 'LEDライト付きで夜でも使いやすい商品です。', tts_evidence_ids: [`summary-${index + 1}`],
      })),
      cta: { display_text: '気になる商品は概要欄へ', tts: '気になる商品は概要欄から確認できます。' } }
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200,
      text: async () => JSON.stringify({ id: 'resp-v4', model: 'gpt-5-mini',
        output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: {} }) }))
    const client = createMultiProductShortsV2Client({ apiKey: 'test-key', fetchImpl })
    const result = await client.plan({ contract: { schema_version: 'multi-product-shorts-plan-v5' }, products })
    expect(result.productionPlan.product_presentations[0]).toMatchObject({
      display_name: '車載用品1', fact_badge: 'LED搭載', identity_id: products[0].identity_candidates[0].identity_id,
    })
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(request.text.format.name).toBe('revenue_lab_three_picks_v2_v5')
    const productSchemas = request.text.format.schema.properties.product_presentations.items.anyOf
    const fields = productSchemas[0].properties
    expect(fields).not.toHaveProperty('display_name')
    expect(fields).not.toHaveProperty('fact_badge')
    const plannerProducts = JSON.parse(request.input[1].content).products
    expect(plannerProducts[0].selectable_facts).toEqual(products[0].selectable_facts)
    expect(plannerProducts[0].fact_candidates[0]).not.toHaveProperty('facts')
    expect(plannerProducts[0].fact_candidates[0].id).toBe('summary-1')
    expect(productSchemas[0].properties.fact_id.enum).toEqual(['summary-1:feature:led'])
    expect(productSchemas[0].properties.fact_id.enum).not.toContain('summary-1')
    expect(productSchemas[0].properties.identity_id.enum).toEqual([products[0].identity_candidates[0].identity_id])
    expect(JSON.stringify(request.text.format.schema)).not.toContain('uniqueItems')
  })
})
