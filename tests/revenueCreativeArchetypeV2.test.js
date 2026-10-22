import { describe, expect, it } from 'vitest'
import {
  ARCHETYPE, LEGACY_LAYOUT_ID, LEGACY_MANIFEST_VERSION, LIMITS, MANIFEST_VERSION, PROMPT_VERSION, SCHEMA_VERSION, SYSTEM_PROMPT, TEMPLATE_ID,
  narrationSegments, planNarrationSegments, validateThreePicksV2Output,
} from '../scripts/revenue-lab/multi-product-shorts-v2-schema.cjs'
import { compileThreePicksV2Manifest } from '../scripts/revenue-lab/multi-product-shorts-v2-composition.cjs'
import { buildV2CompositionPlan, createLocalFfmpegCompositionV2Provider, inspectV2Output } from '../scripts/revenue-lab/providers/local-ffmpeg-composition-v2-provider.cjs'
import { createSupabaseCreativeAudioBlobStore, safeAudioKey } from '../scripts/revenue-lab/creative-audio-blob-store.cjs'

const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`

function fixture() {
  const identities = ['車用ゴミ箱', 'スマホホルダー', 'アロマディフューザー']
  const products = [1, 2, 3].map(index => ({
    product_set_item_id: uuid(index), presentation_order: index,
    source_product_name: `${identities[index - 1]} 車載用品`, allowed_verified_fact_refs: ['summary'],
    fact_candidates: [{ id: `summary-${index}`, verified_fact_ref: 'summary', text: `確認済み${index}` }],
  }))
  const output = {
    archetype: ARCHETYPE, theme: '毎日を軽くする3選',
    hook: { display_text: '迷ったらこの3つ', tts: '迷ったらこの三つ。' },
    product_presentations: products.map(product => ({
      product_set_item_id: product.product_set_item_id,
      presentation_order: product.presentation_order,
      display_name: identities[product.presentation_order - 1], short_appeal: `確認済み${product.presentation_order}で使いやすい`,
      fact_badge: `確認済み${product.presentation_order}`, verified_fact_ref: 'summary', identity_anchor: identities[product.presentation_order - 1],
      evidence_anchors: [`確認済み${product.presentation_order}`], tts: `確認済み${product.presentation_order}の仕様で便利に使えます。`,
    })),
    cta: { display_text: '気になる商品は概要欄へ', tts: '気になる商品は概要欄から確認できます。' },
  }
  return { products, output }
}

describe('Creative Archetype v2 schema and compiler', () => {
  it('keeps the template server-fixed and validates compact grounded output', () => {
    const { products, output } = fixture()
    expect(validateThreePicksV2Output(output, { products })).toEqual(output)
    expect(SCHEMA_VERSION).toBe('multi-product-shorts-plan-v4')
    expect(PROMPT_VERSION).toBe('three-picks-production-planner-v3')
    expect(TEMPLATE_ID).toBe('hero-carousel-v2')
    expect(JSON.stringify(output)).not.toContain('template')
  })

  it('keeps a new Hook to one short narration segment without changing Product or CTA limits', () => {
    const { products, output } = fixture()
    validateThreePicksV2Output(output, { products })
    expect(LIMITS).toMatchObject({ hookTts: 14, productTts: 40, ctaTts: 40 })
    expect(planNarrationSegments(output).filter(segment => segment.scene === 'hook')).toEqual([
      { segment_id: 'hook-1', segment_order: 1, text: output.hook.tts, scene: 'hook' },
    ])
    expect(SYSTEM_PROMPT).toContain('3-4.5 seconds')
    expect(SYSTEM_PROMPT).toContain('Do not put product descriptions or lists in the Hook narration')

    const tooLong = structuredClone(output)
    tooLong.hook.tts = 'これは十五文字を超える長いフック原稿です。'
    expect(() => validateThreePicksV2Output(tooLong, { products })).toThrowError(/1-14 characters/)

    const twoSegments = structuredClone(output)
    twoSegments.hook.tts = '迷わない。三つです。'
    expect(() => validateThreePicksV2Output(twoSegments, { products })).toThrowError(/one narration segment/i)
  })

  it('reads a historical multi-segment Hook without rewriting the stored revision', () => {
    const { output } = fixture()
    const historical = structuredClone(output)
    historical.hook.tts = '夜も昼も快適な車内に。厳選した3つのアイテムを一気にご紹介します。'
    const before = structuredClone(historical)
    expect(planNarrationSegments(historical).filter(segment => segment.scene === 'hook')).toHaveLength(2)
    expect(historical).toEqual(before)
  })

  it('splits narration deterministically into bounded stable segments', () => {
    const text = '最初のポイントです。次のポイントも確認できます！最後に詳細をチェックしてください。'
    const first = narrationSegments('product-1', text)
    const second = narrationSegments('product-1', text)
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(1)
    expect(first.every(segment => Array.from(segment.text).length <= 42)).toBe(true)
    expect(first.map(segment => segment.segment_id)).toEqual(first.map((_, index) => `product-1-${index + 1}`))
  })

  it('compiles independent image/text/subtitle layers from measured segment durations', () => {
    const { products, output } = fixture()
    const items = products.map((product, index) => ({
      id: product.product_set_item_id, presentationOrder: index + 1,
      assetRevisions: [1, 2].map(order => ({ id: uuid(100 + index * 10 + order), assetOrder: order,
        contentSha256: String(index + order).repeat(64).slice(0, 64) })),
    }))
    const scopes = [
      ['hook', output.hook.tts],
      ...output.product_presentations.map((item, index) => [`product-${index + 1}`, item.tts]),
      ['cta', output.cta.tts],
    ]
    const audioArtifacts = scopes.flatMap(([scope, text]) => narrationSegments(scope, text).map((segment, index) => ({
      segmentId: segment.segment_id, segmentOrder: index + 1, status: 'ready', durationSeconds: 1.2,
      immutableObjectKey: `creative-audio/${uuid(900)}/${segment.segment_id}/${'a'.repeat(64)}.mp3`,
      audioSha256: 'a'.repeat(64),
    })))
    const result = compileThreePicksV2Manifest({ requestId: uuid(800), planRevision: 1,
      campaignId: uuid(801), iterationId: uuid(802), productSetId: uuid(803),
      plan: output, items, audioArtifacts })
    expect(result.manifest.manifest_version).toBe(MANIFEST_VERSION)
    expect(result.manifest.template_id).toBe(TEMPLATE_ID)
    expect(result.manifest.output.duration_seconds).toBeGreaterThanOrEqual(35)
    expect(result.manifest.output.duration_seconds).toBeLessThanOrEqual(45)
    expect(result.manifest.product_cards).toBeUndefined()
    expect(result.manifest.scenes.filter(scene => scene.kind === 'product')).toHaveLength(3)
    expect(result.manifest.scenes[1].layers.map(layer => layer.kind)).toEqual([
      'background', 'product_image', 'product_image', 'pick_label', 'display_name', 'short_appeal', 'fact_badge', 'subtitle',
    ])
    expect(result.manifest.subtitle_cues.every(cue => cue.duration_seconds === 1.2)).toBe(true)
    expect(result.manifest.scenes.every(scene => Number.isInteger(scene.start_seconds * 30)
      && Number.isInteger(scene.duration_seconds * 30))).toBe(true)
    expect(result.manifest.subtitle_cues.every(cue => Number.isInteger(cue.start_seconds * 30)
      && Number.isInteger(cue.duration_seconds * 30))).toBe(true)
  })

  it('refuses composition until every measured audio segment is ready', () => {
    const { products, output } = fixture()
    const items = products.map((product, index) => ({ id: product.product_set_item_id,
      presentationOrder: index + 1, assetRevisions: [{ id: uuid(100 + index), assetOrder: 1, contentSha256: 'b'.repeat(64) }] }))
    expect(() => compileThreePicksV2Manifest({ requestId: uuid(800), planRevision: 1,
      campaignId: uuid(801), iterationId: uuid(802), productSetId: uuid(803), plan: output, items,
      audioArtifacts: [] })).toThrowError(/audio artifacts are not ready/i)
  })

  it('builds a layer-based composer plan and delegates only through an injected renderer', async () => {
    const renderImpl = async plan => ({ bytes: Buffer.from('mp4'), durationSeconds: plan.output.duration_seconds,
      pixelWidth: 1080, pixelHeight: 1920, fps: 30, contentType: 'video/mp4' })
    const provider = createLocalFfmpegCompositionV2Provider({ renderImpl })
    const manifest = { manifest_version: LEGACY_MANIFEST_VERSION, archetype: ARCHETYPE, template_id: TEMPLATE_ID,
      layout_id: LEGACY_LAYOUT_ID, output: { width: 1080, height: 1920, fps: 30, container: 'mp4',
        video_codec: 'h264', pixel_format: 'yuv420p', faststart: true, audio: true, duration_seconds: 39 },
      scenes: [
        { id: 'hook', kind: 'hook', start_seconds: 0, duration_seconds: 4, layers: [] },
        { id: 'product-1', kind: 'product', start_seconds: 4, duration_seconds: 10, layers: [] },
        { id: 'product-2', kind: 'product', start_seconds: 14, duration_seconds: 10, layers: [] },
        { id: 'product-3', kind: 'product', start_seconds: 24, duration_seconds: 10, layers: [] },
        { id: 'cta', kind: 'cta', start_seconds: 34, duration_seconds: 5, layers: [] },
      ], subtitle_cues: [] }
    expect(buildV2CompositionPlan(manifest)).toMatchObject({ templateId: TEMPLATE_ID,
      output: { duration_seconds: 39 } })
    expect(buildV2CompositionPlan(manifest).scenes[0]).toMatchObject({ id: 'hook' })
    await expect(provider.render({ manifest, assets: new Map(), audioAssets: new Map() })).resolves.toMatchObject({ pixelWidth: 1080 })
    const unavailable = createLocalFfmpegCompositionV2Provider()
    await expect(unavailable.render({ manifest, assets: new Map(), audioAssets: new Map() })).rejects.toMatchObject({ code: 'COMPOSITION_V2_RENDERER_NOT_CONFIGURED' })
  })

  it('rejects an FFprobe result unless video, audio, codecs, geometry, fps and duration all match', () => {
    const valid = { streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p', avg_frame_rate: '30/1' },
      { codec_type: 'audio', codec_name: 'aac' },
    ], format: { duration: '39.000' } }
    expect(inspectV2Output(valid, 39)).toMatchObject({ durationSeconds: 39, pixelWidth: 1080, pixelHeight: 1920, fps: 30 })
    expect(() => inspectV2Output({ ...valid, streams: [valid.streams[0]] }, 39)).toThrowError()
    expect(() => inspectV2Output({ ...valid, format: { duration: '45.2' } }, 45)).toThrowError()
  })

  it('accepts only immutable Creative Audio object keys', () => {
    const key = `creative-audio/${uuid(1)}/hook-1/${'a'.repeat(64)}.mp3`
    expect(safeAudioKey(key)).toBe(key)
    expect(() => safeAudioKey('../audio.mp3')).toThrowError(/invalid immutable creative audio object key/i)
  })

  it('supports deterministic blob recovery without treating a missing object as an error', async () => {
    const key = `creative-audio/${uuid(1)}/hook-1/${'a'.repeat(64)}.mp3`
    const missing = createSupabaseCreativeAudioBlobStore({ url: 'https://example.supabase.co',
      serviceRoleKey: 'test-only', bucket: 'revenue-lab-creative-audio',
      fetchImpl: async () => new Response(null, { status: 404 }) })
    await expect(missing.readIfExists(key)).resolves.toBeNull()
    const supabaseMissing = createSupabaseCreativeAudioBlobStore({ url: 'https://example.supabase.co',
      serviceRoleKey: 'test-only', bucket: 'revenue-lab-creative-audio',
      fetchImpl: async () => new Response(JSON.stringify({ statusCode: '404', error: 'not_found',
        message: 'Object not found' }), { status: 400, headers: { 'content-type': 'application/json' } }) })
    await expect(supabaseMissing.readIfExists(key)).resolves.toBeNull()
    const rejected = createSupabaseCreativeAudioBlobStore({ url: 'https://example.supabase.co',
      serviceRoleKey: 'test-only', bucket: 'revenue-lab-creative-audio',
      fetchImpl: async () => new Response(JSON.stringify({ statusCode: '400', error: 'invalid_request',
        message: 'Invalid request' }), { status: 400, headers: { 'content-type': 'application/json' } }) })
    await expect(rejected.readIfExists(key)).rejects.toMatchObject({
      code: 'CREATIVE_AUDIO_STORAGE_READ_FAILED', status: 400,
    })
    const present = createSupabaseCreativeAudioBlobStore({ url: 'https://example.supabase.co',
      serviceRoleKey: 'test-only', bucket: 'revenue-lab-creative-audio',
      fetchImpl: async () => new Response(Buffer.from('existing audio'), { status: 200 }) })
    await expect(present.readIfExists(key)).resolves.toEqual(Buffer.from('existing audio'))
  })
})
