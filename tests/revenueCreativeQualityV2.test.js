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
  completeThreePicksV5Plan,
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
    typedProduct(3, '車用 カーアロマディフューザー USB式', '6種類の香り。1本につき2週間。USB Type-C接続。'),
  ]
  const identity = products.map(product => product.identity_candidates[0])
  const facts = [
    products[0].selectable_facts.find(fact => fact.display_text === 'LED搭載'),
    products[1].selectable_facts.find(fact => fact.display_text === 'マグネット固定'),
    products[2].selectable_facts.find(fact => fact.display_text === '1本2週間'),
  ]
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

function conditionalDurationFixture({ approximate = false } = {}) {
  const fixture = v5Fixture()
  const text = `フレグランスボトル1本につき${approximate ? '約' : ''}2週間(1日2h利用)`
  const product = typedProduct(3, '車用 カーアロマディフューザー USB式', text)
  fixture.products[2] = product
  const item = fixture.plan.product_presentations[2]
  item.identity_id = product.identity_candidates[0].identity_id
  item.fact_id = product.selectable_facts.find(fact => fact.type === 'duration').fact_id
  item.short_appeal = `1日2時間使用で1本${approximate ? '約' : ''}2週間使える`
  item.short_appeal_evidence_ids = ['summary-1']
  item.tts = `1日2時間の使用で、ボトル1本${approximate ? '約' : ''}2週間使えます。`
  item.tts_evidence_ids = ['summary-1']
  return fixture
}

describe('Three Picks v2 hard fact / soft copy architecture', () => {
  it('builds bounded deterministic fallback for a non-duration typed fact', () => {
    const { products, plan } = v5Fixture()
    const product = products[0]
    const fact = { fact_id: 'summary-1:quantity:count', source_candidate_id: 'summary-1',
      type: 'quantity', key: 'count', canonical_value: { value: 2, unit: null }, display_text: '×2' }
    product.fact_candidates[0].text = '付属品×2'
    product.fact_candidates[0].source_anchor = '付属品×2'
    product.fact_candidates[0].facts = [fact]
    product.selectable_facts = [fact]
    plan.product_presentations[0].fact_id = fact.fact_id
    plan.product_presentations[0].short_appeal = '自動で使える付属品'
    plan.product_presentations[0].tts = '自動機能を搭載した付属品です。'
    const completed = completeThreePicksV5Plan(plan, { products })
    expect(completed.product_presentations[0]).toMatchObject({
      short_appeal: '付属数量は2です', tts: '車載ダストボックスは、付属数量は2です。',
    })
    expect(completed.soft_copy_fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'products[0].short_appeal', generation_mode: 'canonical_fallback' }),
      expect.objectContaining({ field: 'products[0].tts', generation_mode: 'canonical_fallback' }),
    ]))
  })

  it('keeps duration approximation, estimate, and usage conditions in canonical fallback', () => {
    const { products, plan } = conditionalDurationFixture({ approximate: true })
    const item = plan.product_presentations[2]
    const fact = products[2].selectable_facts.find(candidate => candidate.fact_id === item.fact_id)
    fact.canonical_value.estimate = true
    fact.display_text = '1日2hで約2週間目安'
    const sourceFact = products[2].fact_candidates.flatMap(candidate => candidate.facts)
      .find(candidate => candidate.fact_id === item.fact_id)
    sourceFact.canonical_value.estimate = true
    sourceFact.display_text = fact.display_text
    item.short_appeal = '2週間使える'
    item.tts = 'ボトル1本を2週間使えます。'
    const completed = completeThreePicksV5Plan(plan, { products })
    expect(completed.product_presentations[2]).toMatchObject({
      short_appeal: '1日2時間使用で1本約2週間目安',
      tts: '車載アロマディフューザーは、1日2時間の使用で1本あたり約2週間が目安です。',
    })
  })

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

  it.each([
    ['マグネット固定', 'マグネット固定'],
    ['磁石固定', '磁石固定'],
    ['強力マグネット', '強力マグネット'],
    ['マグネット式', 'マグネット式'],
    ['real product copy', '鉄壁磁力 マグネット がさらに進化'],
  ])('normalizes the magnet expression family: %s', (_label, text) => {
    expect(compileTypedFacts({ candidateId: 'summary-1', text })).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'feature', key: 'magnetic_fixation', canonical_value: true,
        display_text: 'マグネット固定' }),
    ]))
  })

  it.each([
    ['N56磁石', 'N56磁石'],
    ['N56マグネット', 'N56マグネット'],
  ])('uses an explicit magnet grade without inventing one: %s', (_label, text) => {
    expect(compileTypedFacts({ candidateId: 'summary-1', text })).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'magnet_grade', canonical_value: 'N56', display_text: 'N56磁石' }),
    ]))
  })

  it('does not infer a magnet grade from an ungraded expression', () => {
    const facts = compileTypedFacts({ candidateId: 'summary-1', text: '強力マグネットで固定' })
    expect(facts.some(fact => fact.type === 'magnet_grade')).toBe(false)
  })

  it.each([
    ['1本につき2週間', false, '1本2週間'],
    ['1本で約2週間', true, '1本約2週間'],
    ['1本約2週間', true, '1本約2週間'],
    ['約2週間／1本', true, '1本約2週間'],
    ['1本あたり約2週間', true, '1本約2週間'],
  ])('normalizes duration notation %s', (text, approximate, displayText) => {
    expect(compileTypedFacts({ candidateId: 'summary-1', text })).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'duration', canonical_value: expect.objectContaining({
        amount: 1, amount_unit: '本', duration: 2, duration_unit: '週間', approximate,
      }), display_text: displayText }),
    ]))
  })

  it('retains a material per-day usage condition in canonical duration data and badge copy', () => {
    const [fact] = compileTypedFacts({ candidateId: 'summary-1',
      text: 'フレグランスボトル1本につき2週間(1日2h利用)' }).filter(item => item.type === 'duration')
    expect(fact).toMatchObject({ canonical_value: {
      amount: 1, amount_unit: '本', duration: 2, duration_unit: '週間', approximate: false,
      conditions: [{ type: 'usage_per_day', value: 2, unit: 'hour' }],
    }, display_text: '1日2hで2週間' })
  })

  it.each([
    ['1本で最大2週間', { bound: 'maximum', estimate: false, conditions: [] }, '1本最大2週間'],
    ['1本で2週間が目安', { bound: null, estimate: true, conditions: [] }, '1本2週間目安'],
    ['1本につき2週間(10回使用時)', { bound: null, estimate: false,
      conditions: [{ type: 'usage_count', value: 10, unit: 'time' }] }, '10回使用で2週間'],
    ['1本につき2週間(特定条件下)', { bound: null, estimate: false,
      conditions: [{ type: 'usage_environment', value: '特定条件下' }] }, '特定条件下で2週間'],
  ])('retains duration material qualifier: %s', (text, expected, displayText) => {
    const [fact] = compileTypedFacts({ candidateId: 'summary-1', text }).filter(item => item.type === 'duration')
    expect(fact).toMatchObject({ canonical_value: expected, display_text: displayText })
  })

  it('requires material duration conditions in short appeal and product TTS', () => {
    const { products, plan } = conditionalDurationFixture()
    const validAppeal = plan.product_presentations[2].short_appeal
    expect(() => validateThreePicksV5PlannerOutput(plan, { products })).not.toThrow()
    plan.product_presentations[2].short_appeal = 'ボトル1本で2週間使える'
    expect(() => validateThreePicksV5PlannerOutput(plan, { products })).toThrowError(expect.objectContaining({
      code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM', product_index: 3,
      field_path: '$.product_presentations[2].short_appeal',
    }))
    plan.product_presentations[2].short_appeal = validAppeal
    plan.product_presentations[2].tts = 'ボトル1本で2週間使えます。'
    expect(() => validateThreePicksV5PlannerOutput(plan, { products })).toThrowError(expect.objectContaining({
      code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM', product_index: 3,
      field_path: '$.product_presentations[2].tts',
    }))
  })

  it('rejects an invented approximation qualifier and accepts one present in source evidence', () => {
    const exact = conditionalDurationFixture()
    exact.plan.product_presentations[2].short_appeal = '1日2時間使用で1本約2週間'
    expect(() => validateThreePicksV5PlannerOutput(exact.plan, { products: exact.products }))
      .toThrowError(expect.objectContaining({ code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM' }))

    const approximate = conditionalDurationFixture({ approximate: true })
    expect(() => validateThreePicksV5PlannerOutput(approximate.plan, { products: approximate.products })).not.toThrow()
  })

  it.each([
    ['1日2時間で2週間使える', true],
    ['1日2時間の使用で1本2週間', true],
    ['1日2時間で約2週間使える', false],
    ['1日2時間でおよそ2週間使える', false],
    ['1日2時間で2週間が目安', false],
    ['1日2時間で最大2週間使える', false],
    ['約2週間使える商品です', false],
    ['1日2時間で3週間使える', false],
  ])('validates duration copy from its typed fact: %s', (shortAppeal, valid) => {
    const { products, plan } = conditionalDurationFixture()
    plan.product_presentations[2].short_appeal = shortAppeal
    const validation = () => validateThreePicksV5PlannerOutput(plan, { products })
    if (valid) expect(validation).not.toThrow()
    else expect(validation).toThrowError(expect.objectContaining({ code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM' }))
  })

  it('rejects the ungrounded short duration form even when another constraint also applies', () => {
    const { products, plan } = conditionalDurationFixture()
    plan.product_presentations[2].short_appeal = '約2週間使える'
    expect(() => validateThreePicksV5PlannerOutput(plan, { products })).toThrow()
  })

  it('routes an invented Level 2 approximation to canonical fallback', () => {
    const { products, plan } = conditionalDurationFixture()
    plan.product_presentations[2].short_appeal = 'ボトル1本で2週間使える'
    const completed = completeThreePicksV5Plan(plan, { products }, { repairs: [{
      field: 'products[2].short_appeal', value: '1日2時間で約2週間使える', evidence_candidate_ids: ['summary-1'],
    }] })
    expect(completed.product_presentations[2].short_appeal).toBe('1日2時間使用で1本2週間')
    expect(completed.soft_copy_fields).toContainEqual(expect.objectContaining({
      field: 'products[2].short_appeal', generation_mode: 'canonical_fallback', repair_count: 1,
    }))
  })

  it.each([
    ['付属品×2', { value: 2, unit: null }, '×2'],
    ['交換品2個', { value: 2, unit: '個' }, '2個'],
    ['ボトル2本', { value: 2, unit: '本' }, '2本'],
    ['シート2枚', { value: 2, unit: '枚' }, '2枚'],
    ['パーツ2ヶ', { value: 2, unit: 'ヶ' }, '2ヶ'],
    ['交換用パッド2個入り', { value: 2, unit: '個' }, '2個入り'],
  ])('normalizes quantity notation %s without inventing a unit', (text, canonicalValue, displayText) => {
    expect(compileTypedFacts({ candidateId: 'summary-1', text })).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'quantity', canonical_value: canonicalValue, display_text: displayText }),
    ]))
  })

  it('retains each explicit multiplied quantity and does not truncate a duration unit', () => {
    const quantities = compileTypedFacts({ candidateId: 'summary-1', text: '本体 ×1、磁器対応リング ×2' })
      .filter(fact => fact.type === 'quantity')
    expect(quantities.map(fact => fact.canonical_value)).toEqual([
      { value: 1, unit: null }, { value: 2, unit: null },
    ])
    expect(compileTypedFacts({ candidateId: 'summary-2', text: '本体保証は発送日より6ヶ月' }))
      .toEqual([])
  })

  it('compiles the three live-validation product families without inventing numbers or grades', () => {
    const product1 = typedProduct(1, '車用ゴミ箱 LEDライト付き', '暗闇でも安心のLEDライト付き')
    const product2 = typedProduct(2, 'スマホホルダー 車 マグネット 車載ホルダー',
      '鉄壁磁力 マグネット がさらに進化。スマホをガッチリ離さず悪路もホールド。')
    const product3 = typedProduct(3, '車用 カーアロマディフューザー',
      'フレグランスボトル1本につき2週間(1日2h利用)※1')
    expect(product1.selectable_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'led', display_text: 'LED搭載' }),
    ]))
    expect(product2.selectable_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'magnetic_fixation' }),
    ]))
    expect(product3.selectable_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'duration', display_text: '1日2hで2週間' }),
    ]))
    expect(product2.fact_candidates.flatMap(candidate => candidate.facts).some(fact => fact.type === 'magnet_grade')).toBe(false)
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
      display_name: 'マグネット式スマホホルダー', fact_badge: 'マグネット固定',
    })
    expect(formatted.product_presentations[2]).toMatchObject({
      display_name: '車載アロマディフューザー', fact_badge: '1本2週間',
    })
  })

  it('keeps hard fact IDs distinct from soft-copy evidence candidate IDs', () => {
    const { products, plan } = v5Fixture()
    const product = products[0]
    expect(product.selectable_facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ fact_id: 'summary-1:feature:led', source_candidate_id: 'summary-1',
        display_text: 'LED搭載' }),
    ]))
    plan.product_presentations[0].fact_id = plan.product_presentations[0].short_appeal_evidence_ids[0]
    expect(() => validateThreePicksV5PlannerOutput(plan, { products })).toThrowError(expect.objectContaining({
      code: 'THREE_PICKS_V2_FACT_UNKNOWN', product_index: 1,
      field_path: '$.product_presentations[0].fact_id',
    }))
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
