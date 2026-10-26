import { describe, expect, it, vi } from 'vitest'
import { createMultiProductShortsV2Client } from '../scripts/revenue-lab/multi-product-shorts-v2-client.cjs'
import { plannerInput } from '../scripts/revenue-lab/multi-product-shorts-v2-schema-v5.cjs'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

function progressiveFixture() {
  const products = [
    { name: '車用ゴミ箱', identity: '車載ダストボックス', text: '暗闇でも安心のLEDライト付き。夜でも問題なく使用できます',
      fact: { type: 'feature', key: 'led', canonical_value: true, display_text: 'LED搭載' } },
    { name: 'スマホホルダー', identity: '車載スマホホルダー', text: '強力マグネットでスマホをしっかり固定',
      fact: { type: 'feature', key: 'magnetic_fixation', canonical_value: true, display_text: 'マグネット固定' } },
    { name: '車用アロマ', identity: '車載アロマ', text: 'フレグランスボトル1本につき2週間(1日2h利用)',
      fact: { type: 'duration', key: 'usage_duration', display_text: '1日2hで2週間', canonical_value: {
        amount: 1, amount_unit: '本', duration: 2, duration_unit: '週間', approximate: false,
        conditions: [{ type: 'usage_per_day', value: 2, unit: 'hour' }], bound: null, estimate: false,
      } } },
  ].map((source, index) => {
    const candidateId = `summary-${index + 1}`
    const factId = `${candidateId}:${source.fact.type}:${source.fact.key}`
    return { product_set_item_id: uuid(index + 1), presentation_order: index + 1, source_product_name: source.name,
      identity_candidates: [{ identity_id: `${uuid(index + 1)}:identity:item-${index + 1}`, display_name: source.identity }],
      fact_candidates: [{ id: candidateId, verified_fact_ref: 'summary', text: source.text, source_anchor: source.text,
        facts: [{ fact_id: factId, ...source.fact }] }],
      selectable_facts: [{ fact_id: factId, source_candidate_id: candidateId, ...source.fact }] }
  })
  const output = { archetype: 'three_picks_v2', theme: '車内快適用品',
    hook: { display_text: '車内快適アイテム', tts: '車内快適アイテム' },
    product_presentations: [
      { short_appeal: 'LED付きで夜も使いやすい', tts: 'LEDライト付きで、暗い車内でも使いやすい商品です。' },
      { short_appeal: 'マグネットでしっかり固定', tts: '強力なマグネットでスマホをしっかり固定できます。' },
      { short_appeal: '1日2時間使用で1本2週間', tts: '1日2時間の使用で、ボトル1本を2週間使えます。' },
    ].map((copy, index) => ({ product_set_item_id: products[index].product_set_item_id,
      presentation_order: index + 1, identity_id: products[index].identity_candidates[0].identity_id,
      fact_id: products[index].selectable_facts[0].fact_id, ...copy,
      short_appeal_evidence_ids: [`summary-${index + 1}`], tts_evidence_ids: [`summary-${index + 1}`] })),
    cta: { display_text: '気になる商品は概要欄へ', tts: '気になる商品は概要欄から確認できます。' } }
  return { input: { contract: { schema_version: 'multi-product-shorts-plan-v5' }, products }, output }
}

const providerResponse = (output, id = 'resp-v4') => ({ ok: true, status: 200,
  text: async () => JSON.stringify({ id, model: 'gpt-5-mini',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: {} }) })

describe('Three Picks planner-v4 client dispatch', () => {
  it('keeps Level 1 output unchanged and records ai_generated without repair', async () => {
    const { input, output } = progressiveFixture()
    const fetchImpl = vi.fn(async () => providerResponse(output))
    const result = await createMultiProductShortsV2Client({ apiKey: 'test-key', fetchImpl }).plan(input)
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(result.productionPlan.product_presentations[1].short_appeal).toBe(output.product_presentations[1].short_appeal)
    expect(result.productionPlan.soft_copy_fields).toHaveLength(8)
    expect(result.productionPlan.soft_copy_fields.every(field => field.generation_mode === 'ai_generated'
      && field.repair_count === 0)).toBe(true)
  })

  it('repairs only failed Level 1 fields once and preserves successful fields', async () => {
    const { input, output } = progressiveFixture()
    output.product_presentations[2].short_appeal = 'ボトル1本で約2週間使える'
    const repaired = { repairs: [{ field: 'products[2].short_appeal',
      value: '1日2時間使用で1本2週間', evidence_candidate_ids: ['summary-3'] }] }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(providerResponse(output, 'initial'))
      .mockResolvedValueOnce(providerResponse(repaired, 'repair'))
    const result = await createMultiProductShortsV2Client({ apiKey: 'test-key', fetchImpl }).plan(input)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.productionPlan.product_presentations[2].short_appeal).toBe('1日2時間使用で1本2週間')
    expect(result.productionPlan.product_presentations[0].tts).toBe(output.product_presentations[0].tts)
    expect(result.productionPlan.soft_copy_fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'products[2].short_appeal', generation_mode: 'ai_repaired', repair_count: 1 }),
      expect.objectContaining({ field: 'products[0].tts', generation_mode: 'ai_generated', repair_count: 0 }),
    ]))
    const repairRequest = JSON.parse(fetchImpl.mock.calls[1][1].body)
    const repairInput = JSON.parse(repairRequest.input[1].content)
    expect(repairRequest.text.format.name).toBe('revenue_lab_three_picks_v2_v5_repair')
    expect(JSON.stringify(repairRequest.text.format.schema)).not.toContain('products[0].tts')
    expect(JSON.stringify(repairRequest.text.format.schema)).not.toContain('uniqueItems')
    expect(repairInput.failures).toHaveLength(1)
    expect(repairInput.failures[0]).toMatchObject({ field: 'products[2].short_appeal',
      rejected_value: 'ボトル1本で約2週間使える', selected_evidence_candidate_ids: ['summary-3'],
      canonical_identity: '車載アロマ' })
    expect(repairInput.failures[0].selected_typed_fact.canonical_value.conditions)
      .toEqual([{ type: 'usage_per_day', value: 2, unit: 'hour' }])
  })

  it('falls back deterministically after one invalid repair and never accepts unsupported hard facts', async () => {
    const { input, output } = progressiveFixture()
    output.hook = { display_text: 'N56で快適', tts: 'N56で快適' }
    output.product_presentations[2].short_appeal = 'USB充電で約2週間使える'
    output.product_presentations[2].tts = 'ボトル1本を約2週間使えます。'
    output.cta = { display_text: '今すぐ購入', tts: '今すぐ購入してください' }
    const repaired = { repairs: [
      { field: 'hook', display_text: 'LEDで快適3選', tts: 'LEDで快適三選' },
      { field: 'products[2].short_appeal', value: 'USB充電で2週間使える', evidence_candidate_ids: ['summary-3'] },
      { field: 'products[2].tts', value: 'ボトル1本を2週間使えます。', evidence_candidate_ids: ['summary-3'] },
      { field: 'cta', display_text: '購入はこちら', tts: '購入はこちらです' },
    ] }
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(providerResponse(output, 'initial'))
      .mockResolvedValueOnce(providerResponse(repaired, 'repair'))
    const result = await createMultiProductShortsV2Client({ apiKey: 'test-key', fetchImpl }).plan(input)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.productionPlan.hook).toEqual({ display_text: '車内が快適になる3アイテム', tts: '車内が快適になる3アイテム' })
    expect(result.productionPlan.product_presentations[2].short_appeal).toBe('1日2時間使用で1本2週間')
    expect(result.productionPlan.product_presentations[2].tts).toBe('車載アロマは、1日2時間の使用で1本を2週間使えます。')
    expect(result.productionPlan.cta).toEqual({ display_text: '気になる商品は概要欄へ', tts: '気になる商品は概要欄へ' })
    expect(result.productionPlan.soft_copy_fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'hook', generation_mode: 'canonical_fallback', repair_count: 1 }),
      expect.objectContaining({ field: 'products[2].short_appeal', generation_mode: 'canonical_fallback', repair_count: 1 }),
      expect.objectContaining({ field: 'products[2].tts', generation_mode: 'canonical_fallback', repair_count: 1 }),
      expect.objectContaining({ field: 'cta', generation_mode: 'canonical_fallback', repair_count: 1 }),
    ]))
  })

  it('does not repair an invalid hard-fact selection', async () => {
    const { input, output } = progressiveFixture()
    output.product_presentations[0].fact_id = 'summary-1'
    const fetchImpl = vi.fn(async () => providerResponse(output))
    await expect(createMultiProductShortsV2Client({ apiKey: 'test-key', fetchImpl }).plan(input))
      .rejects.toMatchObject({ code: 'THREE_PICKS_V2_FACT_UNKNOWN' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('uses canonical fallback when the single repair request fails', async () => {
    const { input, output } = progressiveFixture()
    output.product_presentations[1].tts = '自動でスマホを固定します。'
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(providerResponse(output, 'initial'))
      .mockRejectedValueOnce(new Error('repair unavailable'))
    const result = await createMultiProductShortsV2Client({ apiKey: 'test-key', fetchImpl }).plan(input)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result.productionPlan.soft_copy_fields).toContainEqual(expect.objectContaining({
      field: 'products[1].tts', generation_mode: 'canonical_fallback', repair_count: 1,
    }))
    expect(result.productionPlan.product_presentations[1].tts).not.toContain('自動')
  })

  it('preserves typed duration conditions in planner selectable facts', () => {
    const product = {
      product_set_item_id: uuid(1), presentation_order: 1,
      identity_candidates: [{ identity_id: `${uuid(1)}:identity:aroma`, display_name: '車載アロマ' }],
      fact_candidates: [{ id: 'summary-1', verified_fact_ref: 'summary', text: '1本につき2週間(1日2h利用)',
        source_anchor: '1本につき2週間(1日2h利用)' }],
      selectable_facts: [{ fact_id: 'summary-1:duration:usage_duration', source_candidate_id: 'summary-1',
        type: 'duration', key: 'usage_duration', display_text: '1日2hで2週間', canonical_value: {
          amount: 1, amount_unit: '本', duration: 2, duration_unit: '週間', approximate: false,
          conditions: [{ type: 'usage_per_day', value: 2, unit: 'hour' }], bound: null, estimate: false,
        } }],
    }
    expect(plannerInput({ products: [product] }).products[0].selectable_facts[0].canonical_value.conditions)
      .toEqual([{ type: 'usage_per_day', value: 2, unit: 'hour' }])
  })

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
    expect(request.input[0].content).toContain('Material conditions and qualifiers')
  })
})
