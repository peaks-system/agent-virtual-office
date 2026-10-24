import { describe, expect, it } from 'vitest'
import { normalizeEvidenceText, prepareThreePicksV2ProductEvidence } from '../scripts/revenue-lab/multi-product-shorts-v2-evidence.cjs'
import {
  ARCHETYPE, LAYOUT_ID, LEGACY_LAYOUT_ID, LEGACY_MANIFEST_VERSION, MANIFEST_VERSION,
  PROMPT_VERSION, SCHEMA_VERSION, planNarrationSegments, validateThreePicksV2Output,
} from '../scripts/revenue-lab/multi-product-shorts-v2-schema.cjs'
import { compileThreePicksV2Manifest } from '../scripts/revenue-lab/multi-product-shorts-v2-composition.cjs'
import {
  QUALITY_LAYOUT, assertV2Manifest, fitMeasuredText, selectQualityAssets,
} from '../scripts/revenue-lab/providers/local-ffmpeg-composition-v2-provider.cjs'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

function qualityFixture() {
  const products = [
    ['車用ゴミ箱 LEDライト付き 折りたたみ式', ['暗闇でも安心のLEDライト付き', 'ゴミ箱を開くとライトが点灯し、夜でも問題なくご使用頂けます', '折りたたみ式']],
    ['マグネット式スマホホルダー N56磁石', ['N56磁石採用', 'ダッシュボード固定']],
    ['車載アロマディフューザー USB給電', ['6種類の香り', '1本で約2週間']],
  ].map(([name, facts], index) => ({
    product_set_item_id: uuid(index + 1), presentation_order: index + 1,
    source_product_name: name,
    allowed_verified_fact_refs: ['summary'],
    fact_candidates: facts.map((text, factIndex) => ({ id: `summary-${factIndex + 1}`, verified_fact_ref: 'summary', text })),
  }))
  const copy = [
    ['車用ゴミ箱', 'LED付きで夜間も使いやすい', '折りたたみ式', '暗い車内でもライトがついて使いやすいです。', ['暗闇でも安心のLEDライト付き', '折りたたみ式'], ['summary-1', 'summary-2', 'summary-3']],
    ['スマホホルダー', 'N56磁石でしっかり固定', 'N56磁石', 'N56磁石でダッシュボードへしっかり固定できます。', ['N56磁石採用'], ['summary-1', 'summary-2']],
    ['車載アロマ', '6種類の香りから選べる', '1本約2週間', '6種類の香りから気分に合わせて選べます。', ['6種類の香り', '1本で約2週間'], ['summary-1', 'summary-2']],
  ]
  const output = {
    archetype: ARCHETYPE, theme: '車内を快適にするアイテム',
    hook: { display_text: '車内快適アイテム3選', tts: '車内快適グッズ三選' },
    product_presentations: products.map((product, index) => ({
      product_set_item_id: product.product_set_item_id, presentation_order: index + 1,
      display_name: copy[index][0], short_appeal: copy[index][1], fact_badge: copy[index][2],
      tts: copy[index][3], verified_fact_ref: 'summary',
      identity_anchor: index === 0 ? '車用ゴミ箱' : index === 1 ? 'スマホホルダー' : '車載アロマ',
      evidence_anchors: copy[index][4], evidence_candidate_ids: copy[index][5],
    })),
    cta: { display_text: '気になる商品は概要欄へ', tts: '気になる商品は概要欄から確認できます。' },
  }
  return { products, output }
}

function revisionSevenIdentityFixture() {
  const fixture = qualityFixture()
  const identities = [
    {
      source: 'LEDライト付き 車 ゴミ箱 車用ゴミ箱 折りたたみ式 車内収納用品',
      anchor: '車用ゴミ箱',
      display: '車載ダストボックス',
    },
    {
      source: '車 マグネット 車載ホルダー スマホホルダー N56磁石対応',
      anchor: 'スマホホルダー',
      display: 'マグネット式スマホホルダー',
    },
    {
      source: '車用 カーアロマディフューザー USB給電 フレグランス用品',
      anchor: 'カーアロマディフューザー',
      display: '車載アロマディフューザー',
    },
  ]
  fixture.products.forEach((product, index) => { product.source_product_name = identities[index].source })
  fixture.output.product_presentations.forEach((item, index) => {
    item.identity_anchor = identities[index].anchor
    item.display_name = identities[index].display
  })
  return fixture
}

describe('Three Picks v2 Production Creative Quality v1', () => {
  it('prepares complete semantic evidence without character slicing formal titles or facts', () => {
    const prepared = prepareThreePicksV2ProductEvidence({
      productName: '車用ゴミ箱 LEDライト付き 折りたたみ式 マグネット固定',
      verifiedFactRef: 'summary',
      verifiedFact: { value: 'LEDライト付き。折りたたみ式。マグネット固定（取り外し可能）。' },
    })
    expect(prepared.source_product_name).toBe('車用ゴミ箱 LEDライト付き 折りたたみ式 マグネット固定')
    expect(prepared.fact_candidates.map(candidate => candidate.text)).toEqual([
      'LEDライト付き', '折りたたみ式', 'マグネット固定(取り外し可能)',
    ])
    expect(JSON.stringify(prepared)).not.toContain('マグネット固定（取り外し')
  })

  it('extracts complete anchored candidates from a 500+ character multiline commerce fact', () => {
    const longFact = [
      '【強力な固定力】',
      '● N56ネオジム磁石を採用しスマートフォンを安定して固定',
      '● 走行中の細かな振動でも向きが変わりにくい保持構造',
      '【取り付け方法】',
      '■ ダッシュボードへ貼り付ける台座を付属',
      '■ 角度を調整できるボールジョイントを搭載',
      '〈対応機器〉',
      '◆ 4.7インチから6.9インチまでのスマートフォンに対応',
      '◆ ケースを装着したままでも利用可能',
      '※ 機器の形状やケースの素材によって保持力は異なります',
      '【車内での使いやすさ】',
      '- 片手で着脱できるため乗車後の操作が簡単',
      '* 縦向きと横向きの両方へ切り替え可能',
      '● USB Type-Cケーブルの接続を妨げにくい設計',
      '【使用上の注意】',
      '■ 取り付け面の油分やほこりを拭き取ってから設置',
      '■ 接着後は24時間置いてから端末を装着',
      '※ 高温になる場所やエアバッグの作動範囲には設置しないでください',
      '【同梱内容】',
      '◆ 本体と台座と位置決め用ガイドを同梱',
      '◆ 取扱説明書に日本語の取り付け手順を掲載',
      '【保管方法】',
      '● 使用しないときは直射日光を避けた車内収納へ保管',
      '● 金属製カードや磁気記録媒体から離して保管',
      '※ 製品表面の汚れは乾いた柔らかい布で拭き取ってください',
    ].join('\r\n')
    expect(Array.from(longFact).length).toBeGreaterThan(500)
    const prepared = prepareThreePicksV2ProductEvidence({
      productName: '車載用マグネット式スマートフォンホルダー N56対応モデル',
      verifiedFactRef: 'summary', verifiedFact: { value: longFact },
    })
    expect(prepared.fact_candidates.length).toBeGreaterThan(0)
    expect(prepared.fact_candidates.every(candidate => Array.from(candidate.text).length <= 120)).toBe(true)
    expect(prepared.fact_candidates.every(candidate => normalizeEvidenceText(longFact).includes(candidate.text))).toBe(true)
    expect(prepared.fact_candidates.some(candidate => candidate.text.includes('N56ネオジム磁石'))).toBe(true)
    expect(prepared.fact_candidates.every(candidate => !/^[●■◆*※-]/u.test(candidate.text))).toBe(true)
    expect(() => prepareThreePicksV2ProductEvidence({ productName: '商品1', verifiedFactRef: 'summary', verifiedFact: { value: 'LEDライト付き。折りたたみ式。' } })).not.toThrow()
    expect(() => prepareThreePicksV2ProductEvidence({ productName: '商品3', verifiedFactRef: 'summary', verifiedFact: { value: '6種類の香り。1本約2週間。' } })).not.toThrow()
  })

  it('uses planner-v3/plan-v4 and validates translated, grounded video copy', () => {
    const { products, output } = qualityFixture()
    expect(validateThreePicksV2Output(output, { products })).toEqual(output)
    expect(PROMPT_VERSION).toBe('three-picks-production-planner-v3')
    expect(SCHEMA_VERSION).toBe('multi-product-shorts-plan-v4')
    expect(LAYOUT_ID).toBe('hero-product-layout-v2')
    expect(MANIFEST_VERSION).toBe('three-picks-composition-manifest-v3')
  })

  it.each([
    ['candidate IDs', item => { item.evidence_candidate_ids = ['summary-1', 'summary-1'] }, 'evidence_candidate_ids'],
    ['evidence anchors', item => { item.evidence_anchors = ['暗闇でも安心のLEDライト付き', '暗闇でも安心のLEDライト付き'] }, 'evidence_anchors'],
  ])('keeps deterministic duplicate rejection for %s', (_label, mutate, field) => {
    const { products, output } = qualityFixture()
    mutate(output.product_presentations[0])
    expect(() => validateThreePicksV2Output(output, { products })).toThrowError(expect.objectContaining({
      code: 'THREE_PICKS_V2_EVIDENCE_ANCHOR_INVALID',
      field_path: `$.product_presentations[0].${field}`,
    }))
  })

  it('accepts the Revision 9 natural LED/night paraphrase when explicit candidates support every claim', () => {
    const { products, output } = qualityFixture()
    expect(output.product_presentations[0]).toMatchObject({
      short_appeal: 'LED付きで夜間も使いやすい',
      evidence_candidate_ids: ['summary-1', 'summary-2', 'summary-3'],
    })
    expect(() => validateThreePicksV2Output(output, { products })).not.toThrow()
  })

  it.each([
    ['unsupported feature', '自動開閉で夜間も使いやすい'],
    ['unsupported number', '3色LEDで夜間も使いやすい'],
    ['unsupported model/spec', 'USB充電式で夜間も使いやすい'],
  ])('rejects %s added to a paraphrase', (_label, shortAppeal) => {
    const { products, output } = qualityFixture()
    output.product_presentations[0].short_appeal = shortAppeal
    let failure
    try { validateThreePicksV2Output(output, { products }) } catch (error) { failure = error }
    expect(failure).toMatchObject({ code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM', product_index: 1,
      field_path: '$.product_presentations[0].short_appeal', reason: 'claim is not supported by selected evidence candidates' })
    expect(failure.safeDiagnostics).toMatchObject({ field_value_preview: shortAppeal,
      evidence_candidate_ids: ['summary-1', 'summary-2', 'summary-3'] })
  })

  it('keeps fact badges on strict selected-candidate facts', () => {
    const { products, output } = qualityFixture()
    expect(() => validateThreePicksV2Output(output, { products })).not.toThrow()
    for (const value of ['業界最強磁石', '約1か月持続']) {
      const invalid = structuredClone(output)
      const productIndex = value.includes('磁石') ? 1 : 2
      invalid.product_presentations[productIndex].fact_badge = value
      expect(() => validateThreePicksV2Output(invalid, { products })).toThrowError(expect.objectContaining({
        code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM', field_path: `$.product_presentations[${productIndex}].fact_badge`,
      }))
    }
  })

  it('allows grounded TTS paraphrase but rejects a new unsupported feature', () => {
    const { products, output } = qualityFixture()
    expect(() => validateThreePicksV2Output(output, { products })).not.toThrow()
    output.product_presentations[0].tts = '自動開閉なので暗い車内でも使いやすいです。'
    expect(() => validateThreePicksV2Output(output, { products })).toThrowError(expect.objectContaining({
      code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM', field_path: '$.product_presentations[0].tts',
    }))
  })

  it('accepts Revision 7-style natural display identities and SEO word-order changes', () => {
    const { products, output } = revisionSevenIdentityFixture()
    expect(() => validateThreePicksV2Output(output, { products })).not.toThrow()
  })

  it.each([
    ['generic token only', 0, '車用', '車載商品'],
    ['different category', 1, 'スマホホルダー', 'ワイヤレス充電器'],
    ['merchant name only', 1, 'ACME', 'ACMEセレクト'],
    ['model number only', 1, 'ZX100', 'ZX100モデル'],
  ])('rejects identity based on %s', (_label, productIndex, identityAnchor, displayName) => {
    const { products, output } = revisionSevenIdentityFixture()
    products[productIndex].source_product_name = `${identityAnchor} ${products[productIndex].source_product_name}`
    output.product_presentations[productIndex].identity_anchor = identityAnchor
    output.product_presentations[productIndex].display_name = displayName
    let failure
    try { validateThreePicksV2Output(output, { products }) } catch (error) { failure = error }
    expect(failure).toMatchObject({
      code: 'THREE_PICKS_V2_IDENTITY_CHANGED',
      productIndex: productIndex + 1,
      fieldPath: `$.product_presentations[${productIndex}].display_name`,
      product_index: productIndex + 1,
      field_path: `$.product_presentations[${productIndex}].display_name`,
    })
    expect(failure.reason).toMatch(/identity token|category token/i)
    expect(failure.safeDiagnostics).toMatchObject({ code: 'THREE_PICKS_V2_IDENTITY_CHANGED',
      product_index: productIndex + 1, field_path: `$.product_presentations[${productIndex}].display_name`,
      reason: failure.reason, field_value_preview: displayName,
      evidence_candidate_ids: output.product_presentations[productIndex].evidence_candidate_ids })
    expect(JSON.stringify(failure.safeDiagnostics)).not.toContain(products[productIndex].source_product_name)
  })

  it('rejects unsupported and non-grounded claims such as 水なしUSB式', () => {
    const { products, output } = qualityFixture()
    const unsupported = structuredClone(output)
    unsupported.product_presentations[2].short_appeal = '水なしUSB式で手軽に香る'
    unsupported.product_presentations[2].evidence_anchors = ['6種類の香り']
    unsupported.product_presentations[2].evidence_candidate_ids = ['summary-1']
    let failure
    try { validateThreePicksV2Output(unsupported, { products }) } catch (error) { failure = error }
    expect(failure).toMatchObject({
      code: 'THREE_PICKS_V2_UNGROUNDED_CLAIM',
      product_index: 3,
      field_path: '$.product_presentations[2].short_appeal',
      reason: 'claim is not supported by selected evidence candidates',
    })
    expect(failure.safeDiagnostics).toMatchObject({ field_value_preview: '水なしUSB式で手軽に香る', evidence_candidate_ids: ['summary-1'] })
    expect(JSON.stringify(failure.safeDiagnostics)).not.toContain(products[2].source_product_name)
  })

  it('rejects merchant copy, incomplete phrases, and unsupported structured tokens', () => {
    const { products, output } = qualityFixture()
    const merchant = structuredClone(output)
    merchant.product_presentations[0].display_name = '業界最大級ゴミ箱'
    expect(() => validateThreePicksV2Output(merchant, { products })).toThrowError()
    const fragment = structuredClone(output)
    fragment.product_presentations[0].short_appeal = 'LED付きで夜間も（便利'
    expect(() => validateThreePicksV2Output(fragment, { products })).toThrowError()
    const token = structuredClone(output)
    token.product_presentations[1].tts = 'N99磁石でスマートフォンをしっかり固定できます。'
    expect(() => validateThreePicksV2Output(token, { products })).toThrowError(/grounded/i)
  })

  it.each([
    ['display name length', output => { output.product_presentations[0].display_name = '箱' },
      'THREE_PICKS_V2_TEXT_LIMIT', 1, '$.product_presentations[0].display_name', 'text is outside the allowed length'],
    ['TTS grounding', output => { output.product_presentations[1].tts = 'N99磁石でスマートフォンをしっかり固定できます。' },
      'THREE_PICKS_V2_UNGROUNDED_CLAIM', 2, '$.product_presentations[1].tts', 'claim is not supported by selected evidence candidates'],
    ['Hook length', output => { output.hook.tts = 'これは十四文字を明確に超える長いフック原稿です' },
      'THREE_PICKS_V2_TEXT_LIMIT', null, '$.hook.tts', 'text is outside the allowed length'],
    ['CTA destination', output => { output.cta = { display_text: '今すぐ確認', tts: '気になる商品を確認できます。' } },
      'THREE_PICKS_V2_CTA_DESTINATION_REQUIRED', null, '$.cta', 'CTA does not identify the description destination'],
  ])('keeps sealed diagnostics for %s', (_label, mutate, code, productIndex, fieldPath, reason) => {
    const { products, output } = qualityFixture()
    mutate(output)
    let failure
    try { validateThreePicksV2Output(output, { products }) } catch (error) { failure = error }
    expect(failure.safeDiagnostics).toMatchObject({ code, product_index: productIndex, field_path: fieldPath, reason })
    expect(failure.safeDiagnostics.field_value_preview).toBeTruthy()
    expect(Array.from(failure.safeDiagnostics.field_value_preview).length).toBeLessThanOrEqual(100)
  })

  it('compiles PICK labels, a bounded image set, and the new layout only for new manifests', () => {
    const { products, output } = qualityFixture()
    const items = products.map((product, index) => ({
      id: product.product_set_item_id,
      assetRevisions: Array.from({ length: index === 0 ? 4 : 1 }, (_, assetIndex) => ({
        id: uuid(100 + index * 10 + assetIndex), assetOrder: assetIndex + 1,
        contentSha256: String(index + assetIndex + 1).repeat(64).slice(0, 64),
      })),
    }))
    const segments = planNarrationSegments(output)
    const audioArtifacts = segments.map((segment, index) => ({ segmentId: segment.segment_id, status: 'ready', durationSeconds: 1,
      id: uuid(500 + index), immutableObjectKey: `audio/${segment.segment_id}`, audioSha256: 'a'.repeat(64) }))
    const input = { requestId: uuid(800), planRevision: 7, campaignId: uuid(801), iterationId: uuid(802),
      productSetId: uuid(803), plan: output, items, audioArtifacts }
    const { manifest } = compileThreePicksV2Manifest(input)
    const first = manifest.scenes.find(scene => scene.id === 'product-1')
    expect(first.layers.find(layer => layer.kind === 'pick_label')?.text).toBe('PICK 1')
    expect(first.layers.filter(layer => layer.kind === 'product_image')).toHaveLength(3)
    expect(first.layers.every(layer => layer.layout_id == null || layer.layout_id === LAYOUT_ID)).toBe(true)
    const legacy = compileThreePicksV2Manifest({ ...input, schemaVersion: 'multi-product-shorts-plan-v3' }).manifest
    expect(legacy).toMatchObject({ manifest_version: LEGACY_MANIFEST_VERSION, layout_id: LEGACY_LAYOUT_ID })
    expect(legacy.scenes.find(scene => scene.id === 'product-1').layers.some(layer => layer.kind === 'pick_label')).toBe(false)
    expect(legacy.scenes.find(scene => scene.id === 'product-1').layers.filter(layer => layer.kind === 'product_image')).toHaveLength(4)
  })

  it('fits display names to at most two measured lines and badges to one line', async () => {
    const measure = async (text, fontSize) => ({ width: Array.from(text).length * fontSize, height: fontSize })
    const name = await fitMeasuredText({ text: 'マグネット式スマホホルダー', maxWidth: 888,
      maxLines: 2, maxFontSize: 64, minFontSize: 56, measure })
    const badge = await fitMeasuredText({ text: 'N56磁石', maxWidth: 888,
      maxLines: 1, maxFontSize: 42, minFontSize: 38, measure })
    expect(name.lines.length).toBeLessThanOrEqual(2)
    expect(name.lines.every(line => line.width <= 888)).toBe(true)
    expect(badge.lines).toHaveLength(1)
    await expect(fitMeasuredText({ text: '長'.repeat(81), maxWidth: 888, maxLines: 2,
      maxFontSize: 64, minFontSize: 56, measure })).rejects.toMatchObject({ code: 'COMPOSITION_V2_TEXT_FIT_INVALID' })
  })

  it('keeps all quality text regions inside the 1080x1920 safe area without overlap', () => {
    expect(QUALITY_LAYOUT.safe.left).toBeGreaterThanOrEqual(96)
    expect(QUALITY_LAYOUT.safe.right).toBeLessThanOrEqual(984)
    const regions = [QUALITY_LAYOUT.pick, QUALITY_LAYOUT.displayName, QUALITY_LAYOUT.card,
      QUALITY_LAYOUT.shortAppeal, QUALITY_LAYOUT.factBadge, QUALITY_LAYOUT.subtitle]
    expect(regions.every(region => region.x >= QUALITY_LAYOUT.safe.left
      && region.x + region.width <= QUALITY_LAYOUT.safe.right)).toBe(true)
    expect(regions.every((region, index) => index === 0 || region.y >= regions[index - 1].y + regions[index - 1].height)).toBe(true)
  })

  it('keeps one-image motion for the full scene and reduces multi-image scenes deterministically', () => {
    expect(selectQualityAssets([1], 10)).toEqual([1])
    expect(selectQualityAssets([1, 2, 3, 4], 10)).toEqual([1, 2, 3])
    expect(selectQualityAssets([1, 2, 3, 4], 7)).toEqual([1, 2])
  })

  it('accepts stored legacy manifests without mutating or upgrading them', () => {
    const stored = { manifest_version: LEGACY_MANIFEST_VERSION, archetype: ARCHETYPE,
      template_id: 'hero-carousel-v2', layout_id: LEGACY_LAYOUT_ID,
      output: { width: 1080, height: 1920, fps: 30, container: 'mp4', video_codec: 'h264',
        pixel_format: 'yuv420p', faststart: true, audio: true, duration_seconds: 39 },
      scenes: [
        ['hook', 'hook', 0, 4], ['product-1', 'product', 4, 10], ['product-2', 'product', 14, 10],
        ['product-3', 'product', 24, 10], ['cta', 'cta', 34, 5],
      ].map(([id, kind, start, duration]) => ({ id, kind, start_seconds: start, duration_seconds: duration, layers: [] })),
      subtitle_cues: [],
    }
    const before = structuredClone(stored)
    expect(() => assertV2Manifest(stored)).not.toThrow()
    expect(stored).toEqual(before)
  })
})
