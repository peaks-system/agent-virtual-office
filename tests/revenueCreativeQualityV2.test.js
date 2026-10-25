import { describe, expect, it } from 'vitest'
import {
  compileIdentityCandidates,
  compileTypedFacts,
  prepareThreePicksV2TypedProductEvidence,
} from '../scripts/revenue-lab/multi-product-shorts-v2-evidence.cjs'
import {
  LAYOUT_ID,
  MANIFEST_VERSION,
  PROMPT_VERSION,
  SCHEMA_VERSION,
  THREE_PICKS_V2_JSON_SCHEMA,
  formatThreePicksV5Plan,
  validateThreePicksV5PlannerOutput,
} from '../scripts/revenue-lab/multi-product-shorts-v2-schema-v5.cjs'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

function typedProduct(index, productName, factText) {
  return {
    product_set_item_id: uuid(index),
    presentation_order: index,
    allowed_verified_fact_refs: ['summary'],
    ...prepareThreePicksV2TypedProductEvidence({
      productSetItemId: uuid(index),
      productName,
      verifiedFactRef: 'summary',
      verifiedFact: { value: factText },
    }),
  }
}

function v5Fixture() {
  const products = [
    typedProduct(1, '車用ゴミ箱 LEDライト付き 折りたたみ式', '暗闇でも安心のLEDライト付き。ゴミ箱を開くとライトが点灯し、夜でも問題なく使用できます。'),
    typedProduct(2, 'スマホホルダー 車 マグネット 車載ホルダー N56', 'N56磁石を採用。スマホをガッチリ離さず悪路もホールド。'),
    typedProduct(3, '車用 カーアロマディフューザー USB式', '6種類の香り。1本で約2週間。USB Type-C接続。'),
  ]
  const identity = products.map(product => product.identity_candidates[0])
  const facts = products.map(product => product.fact_candidates.flatMap(candidate => candidate.facts)[0])
  const plan = {
    archetype: 'three_picks_v2',
    theme: '車内快適アイテム',
    hook: { display_text: '車内快適3選', tts: '車内快適三選' },
    product_presentations: [
      { product_set_item_id: uuid(1), presentation_order: 1, identity_id: identity[0].identity_id,
        fact_id: facts[0].fact_id, short_appeal: '夜の車内でも使いやすい', short_appeal_evidence_ids: ['summary-1', 'summary-2'],
        tts: 'ふたを開けるとLEDが点灯し暗い車内でも便利です。', tts_evidence_ids: ['summary-1', 'summary-2'] },
      { product_set_item_id: uuid(2), presentation_order: 2, identity_id: identity[1].identity_id,
        fact_id: facts[1].fact_id, short_appeal: '悪路でもスマホをガッチリ', short_appeal_evidence_ids: ['summary-2'],
        tts: '悪路でもスマホをしっかり固定できます。', tts_evidence_ids: ['summary-2'] },
      { product_set_item_id: uuid(3), presentation_order: 3, identity_id: identity[2].identity_id,
        fact_id: facts[2].fact_id, short_appeal: '6種類の香りから選べる', short_appeal_evidence_ids: ['summary-1'],
        tts: '好みに合わせて6種類の香りから選べます。', tts_evidence_ids: ['summary-1'] },
    ],
    cta: { display_text: '気になる商品は概要欄へ', tts: '気になる商品は概要欄から確認できます。' },
  }
  return { products, plan }
}

describe('Three Picks v2 hard fact / soft copy architecture', () => {
  it.each([
    ['LED evidence', '暗闇でも安心のLEDライト付き', { type: 'feature', key: 'led', canonical_value: true, display_text: 'LED搭載' }],
    ['N56 magnet grade', 'N56ネオジム磁石を採用', { type: 'magnet_grade', key: 'magnet_grade', canonical_value: 'N56', display_text: 'N56磁石' }],
    ['duration', '1本で約2週間使用できます', { type: 'duration', key: 'usage_duration', display_text: '1本約2週間' }],
    ['month duration', '1本で約1か月使用できます', { type: 'duration', key: 'usage_duration', display_text: '1本約1か月' }],
    ['quantity', '交換用パッド3個入り', { type: 'quantity', key: 'package_quantity', display_text: '3個入り' }],
    ['count', '6種類の香りから選べます', { type: 'count', key: 'option_count', display_text: '6種類' }],
    ['connection', 'USB Type-C接続に対応', { type: 'connection', key: 'usb_type_c', canonical_value: 'USB Type-C', display_text: 'USB Type-C' }],
    ['material', 'アルミニウム製ボディを採用', { type: 'material', key: 'aluminum', display_text: 'アルミ製' }],
    ['model', '型番 ZX100', { type: 'model', key: 'model_number', canonical_value: 'ZX100', display_text: 'ZX100' }],
    ['grade', 'IPX5対応', { type: 'grade', key: 'standard_grade', canonical_value: 'IPX5', display_text: 'IPX5' }],
  ])('compiles %s into a canonical typed fact', (_label, text, expected) => {
    expect(compileTypedFacts({ candidateId: 'summary-1', text })).toEqual(expect.arrayContaining([
      expect.objectContaining(expected),
    ]))
  })

  it('leaves ambiguous evidence untyped', () => {
    expect(compileTypedFacts({ candidateId: 'summary-1', text: '毎日の車移動を快適にします' })).toEqual([])
    expect(() => prepareThreePicksV2TypedProductEvidence({ productSetItemId: uuid(1), productName: '車用ゴミ箱',
      verifiedFactRef: 'summary', verifiedFact: { value: '毎日の車移動を快適にします' } }))
      .toThrowError(expect.objectContaining({ code: 'TYPED_FACT_CANDIDATE_MISSING' }))
  })

  it('builds canonical identities without merchant, SEO duplication, or model-only candidates', () => {
    expect(compileIdentityCandidates({ productSetItemId: uuid(1),
      productName: 'ACME公式 車 ゴミ箱 車用ゴミ箱 LEDライト ZX100' })).toEqual([
      { identity_id: `${uuid(1)}:identity:vehicle-dustbox`, display_name: '車載ダストボックス' },
    ])
    expect(compileIdentityCandidates({ productSetItemId: uuid(2),
      productName: 'ZX100 ACME公式 スマホホルダー 車 マグネット 車載ホルダー' })[0].display_name)
      .toBe('マグネット式スマホホルダー')
  })

  it('fails closed when no canonical identity candidate can be derived', () => {
    expect(() => prepareThreePicksV2TypedProductEvidence({ productSetItemId: uuid(1), productName: 'ACME ZX100 商品',
      verifiedFactRef: 'summary', verifiedFact: { value: 'LEDライト付き' } })).toThrowError(expect.objectContaining({
      code: 'IDENTITY_CANDIDATE_MISSING',
    }))
  })

  it('exposes only ID selection and soft copy in the planner-v4 response schema', () => {
    const fields = THREE_PICKS_V2_JSON_SCHEMA.properties.product_presentations.items.properties
    expect(fields).toHaveProperty('identity_id')
    expect(fields).toHaveProperty('fact_id')
    expect(fields).not.toHaveProperty('display_name')
    expect(fields).not.toHaveProperty('fact_badge')
    expect(PROMPT_VERSION).toBe('three-picks-production-planner-v4')
    expect(SCHEMA_VERSION).toBe('multi-product-shorts-plan-v5')
    expect(MANIFEST_VERSION).toBe('three-picks-composition-manifest-v3')
    expect(LAYOUT_ID).toBe('hero-product-layout-v2')
  })

  it('validates selected lineage and formats identity and badge deterministically', () => {
    const { products, plan } = v5Fixture()
    expect(validateThreePicksV5PlannerOutput(plan, { products })).toEqual(plan)
    const formatted = formatThreePicksV5Plan(plan, { products })
    expect(formatted.product_presentations[0]).toMatchObject({
      display_name: '車載ダストボックス',
      fact_badge: 'LED搭載',
      lineage: { identity_id: plan.product_presentations[0].identity_id, fact_id: plan.product_presentations[0].fact_id },
    })
    expect(formatted.product_presentations[1]).toMatchObject({
      display_name: 'マグネット式スマホホルダー', fact_badge: 'N56磁石',
    })
    expect(formatted.product_presentations[2]).toMatchObject({
      display_name: '車載アロマディフューザー', fact_badge: '6種類',
    })
  })

  it.each([
    ['identity', item => { item.identity_id = 'unknown:identity' }, 'THREE_PICKS_V2_IDENTITY_CANDIDATE_UNKNOWN', 'identity_id'],
    ['fact', item => { item.fact_id = 'unknown:fact' }, 'THREE_PICKS_V2_FACT_UNKNOWN', 'fact_id'],
  ])('rejects an unknown %s ID with safe diagnostics', (_label, mutate, code, field) => {
    const { products, plan } = v5Fixture()
    mutate(plan.product_presentations[0])
    expect(() => validateThreePicksV5PlannerOutput(plan, { products })).toThrowError(expect.objectContaining({
      code, product_index: 1, field_path: `$.product_presentations[0].${field}`,
    }))
  })

  it('keeps soft copy candidate-grounded and rejects added hard facts', () => {
    const { products, plan } = v5Fixture()
    expect(() => validateThreePicksV5PlannerOutput(plan, { products })).not.toThrow()
    plan.product_presentations[0].short_appeal = 'USB充電式で夜も便利'
    expect(() => validateThreePicksV5PlannerOutput(plan, { products })).toThrowError(expect.objectContaining({
      code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM', product_index: 1,
      field_path: '$.product_presentations[0].short_appeal',
    }))
  })

  it.each([
    ['Hook', plan => { plan.hook = { display_text: 'LED商品3選', tts: 'LED商品三選' } }, 'THREE_PICKS_V2_HOOK_HARD_FACT', '$.hook'],
    ['CTA', plan => { plan.cta = { display_text: 'USB商品は概要欄へ', tts: 'USB商品は概要欄から確認できます。' } },
      'THREE_PICKS_V2_CTA_HARD_FACT', '$.cta'],
  ])('rejects product hard facts in the %s', (_label, mutate, code, fieldPath) => {
    const { products, plan } = v5Fixture()
    mutate(plan)
    expect(() => validateThreePicksV5PlannerOutput(plan, { products })).toThrowError(expect.objectContaining({
      code, field_path: fieldPath,
    }))
  })
})
