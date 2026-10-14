import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildProductCards, buildRenderManifest, deterministicBackground } from '../scripts/revenue-lab/multi-product-shorts-composition.cjs'
import { PROMPT_VERSION, SCHEMA_VERSION, validateThreePicksOutput } from '../scripts/revenue-lab/multi-product-shorts-schema.cjs'
import { createLocalFfmpegCompositionProvider, inspectPayload } from '../scripts/revenue-lab/providers/local-ffmpeg-composition-provider.cjs'
import { createSupabaseStore } from '../scripts/revenue-lab/supabase-store.cjs'

const uuid = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const input = {
  products: [1, 2, 3].map(index => ({ product_set_item_id: uuid(index),
    display_name: `商品${index}`, fact_badge: `確認済み事実${index}`,
    allowed_verified_fact_refs: [`fact-${index}`] })),
}
const validPlan = {
  archetype: 'three_picks_v1', hook: '暮らしに役立つ3つを短く紹介',
  product_presentations: [1, 2, 3].map(index => ({ product_set_item_id: uuid(index),
    presentation_order: index, display_name: `商品${index}`,
    short_appeal: `使い方が分かりやすい商品${index}`, fact_badge: `確認済み事実${index}`,
    tts: `商品${index}は確認済み事実${index}がポイントです`, verified_fact_ref: `fact-${index}` })),
  summary: '用途に合うものを確認してください', cta: '商品情報は説明欄へ',
}

const legacyPlan = {
  archetype: 'three_picks_v1', hook: '従来の3商品を紹介',
  product_presentations: [1, 2, 3].map(index => ({ product_set_item_id: uuid(index),
    presentation_order: index, short_appeal: `従来訴求${index}`,
    on_screen_text: `従来表示${index}`, verified_fact_ref: `fact-${index}` })),
  summary: '従来まとめ', cta: '従来CTA',
}

function cardItems() {
  return [1, 2, 3].map(index => ({ id: uuid(index), productName: `商品${index}`,
    verifiedFactRef: `fact-${index}`, verifiedFact: { key: `fact-${index}`, value: `確認済み事実${index}` },
    price: index === 1 ? { amount: 1000, currency: 'JPY' } : null,
    destination: { id: uuid(10 + index), snapshot: { destination: `https://example.com/${index}` } },
    assetRevision: { id: uuid(20 + index), contentSha256: String(index).repeat(64) } }))
}

describe('Multi-product Shorts v1 deterministic contracts', () => {
  it('uses the v2 compact Creative representation', () => {
    expect(PROMPT_VERSION).toBe('three-picks-planner-v2')
    expect(SCHEMA_VERSION).toBe('multi-product-shorts-plan-v2')
    expect(validateThreePicksOutput(structuredClone(validPlan), input)).toEqual(validPlan)
  })

  it('accepts exactly three distinct products without ranking language', () => {
    expect(validateThreePicksOutput(structuredClone(validPlan), input)).toEqual(validPlan)
    expect(() => validateThreePicksOutput({ ...validPlan, product_presentations: validPlan.product_presentations.slice(0, 2) }, input)).toThrowError(expect.objectContaining({ code: 'THREE_PICKS_INVALID_OUTPUT' }))
    const duplicate = structuredClone(validPlan); duplicate.product_presentations[2].product_set_item_id = uuid(1)
    expect(() => validateThreePicksOutput(duplicate, input)).toThrowError(expect.objectContaining({ code: 'THREE_PICKS_PRODUCT_MISMATCH' }))
  })

  it('rejects ranking language and unverified fact references', () => {
    const ranked = structuredClone(validPlan); ranked.product_presentations[0].short_appeal = '第1位の商品'
    expect(() => validateThreePicksOutput(ranked, input)).toThrowError(expect.objectContaining({ code: 'THREE_PICKS_RANKING_LANGUAGE' }))
    const invented = structuredClone(validPlan); invented.product_presentations[0].verified_fact_ref = 'invented'
    expect(() => validateThreePicksOutput(invented, input)).toThrowError(expect.objectContaining({ code: 'THREE_PICKS_UNVERIFIED_FACT' }))
  })

  it('builds minimal Product Cards from immutable Asset Revisions', () => {
    const cards = buildProductCards(validPlan, cardItems())
    expect(cards).toHaveLength(3)
    expect(cards[0]).toMatchObject({ pick_number: 1, rank_position: null,
      product_asset_revision_id: uuid(21), card_template_version: 'product-card-v2',
      product_name: '商品1', display_name: '商品1', fact_badge: '確認済み事実1',
      tts: '商品1は確認済み事実1がポイントです' })
    expect(cards[0]).not.toHaveProperty('reviews')
    expect(cards[0]).not.toHaveProperty('rating')
  })

  it('normalizes existing v1 plan revisions without rewriting their evidence', () => {
    const cards = buildProductCards(legacyPlan, cardItems())
    expect(cards[0]).toMatchObject({ product_name: '商品1', display_name: '商品1',
      short_appeal: '従来訴求1', fact_badge: '従来表示1', tts: '従来訴求1',
      verified_fact_ref: 'fact-1' })
  })

  it('keeps background and composition fingerprints deterministic', () => {
    const seed = { campaignId: uuid(90), iterationId: uuid(91) }
    expect(deterministicBackground(seed)).toEqual(deterministicBackground(seed))
    const cards = buildProductCards(validPlan, cardItems())
    const options = { requestId: uuid(92), planRevision: 1, campaignId: uuid(90),
      iterationId: uuid(91), productSetId: uuid(93), plan: validPlan, cards }
    const first = buildRenderManifest(options); const second = buildRenderManifest(options)
    expect(first).toEqual(second)
    expect(first.manifest.output).toMatchObject({ width: 1080, height: 1920, fps: 30,
      video_codec: 'h264', pixel_format: 'yuv420p', faststart: true, audio: false, duration_seconds: 20 })
  })
})

describe('Final Composer provider boundary', () => {
  it('inspects the required H.264 MP4 output and rejects invalid media', () => {
    expect(inspectPayload({ streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1080, height: 1920, avg_frame_rate: '30/1' }], format: { duration: '20.000' } })).toEqual({ durationSeconds: 20, pixelWidth: 1080, pixelHeight: 1920, fps: 30 })
    expect(() => inspectPayload({ streams: [{ codec_type: 'video', codec_name: 'vp9', width: 1080, height: 1920 }], format: { duration: '20' } })).toThrowError(expect.objectContaining({ code: 'COMPOSITION_OUTPUT_INVALID' }))
  })

  it('sanitizes FFmpeg failures without returning command or path details', async () => {
    const execute = vi.fn(async () => { throw new Error('C:\\secret\\path --token sensitive') })
    const provider = createLocalFfmpegCompositionProvider({ execute })
    const cards = buildProductCards(validPlan, cardItems())
    const { manifest } = buildRenderManifest({ requestId: uuid(92), planRevision: 1,
      campaignId: uuid(90), iterationId: uuid(91), productSetId: uuid(93), plan: validPlan, cards })
    const assets = new Map(cards.map(card => [card.product_asset_revision_id, Buffer.from('image')]))
    await expect(provider.render({ manifest, assets })).rejects.toMatchObject({ code: 'COMPOSITION_CARD_RENDER_FAILED', message: 'Local final composition could not be completed' })
  })
})

describe('Multi-product migration and existing lineage compatibility', () => {
  const migration = readFileSync('supabase/migrations/20261013100000_revenue_lab_multi_product_shorts_v1.sql', 'utf8')
  const rollback = readFileSync('supabase/rollback/20261013100000_revenue_lab_multi_product_shorts_v1_down.sql', 'utf8')
  const analytics = readFileSync('supabase/migrations/20261010130000_revenue_lab_youtube_analytics_v1.sql', 'utf8')
  const assetRevisions = readFileSync('supabase/migrations/20261012100000_revenue_lab_image_to_video_foundation_v1.sql', 'utf8')

  it('makes the old product nullable but enforces a single-product or Product Set XOR', () => {
    expect(migration).toContain('alter column curated_product_id drop not null')
    expect(migration).toMatch(/\(curated_product_id is not null\) <> \(product_set_id is not null\)/)
    expect(migration).not.toMatch(/update revenue_lab\.campaign_iterations\s+set/i)
    expect(rollback).toContain('alter column curated_product_id set not null')
  })

  it('keeps Publication and Analytics lineage anchored to Campaign Iteration', () => {
    expect(migration).toContain('source_row.curated_product_id, source_row.product_set_id')
    expect(analytics).toContain('campaign_iteration_id uuid not null references revenue_lab.campaign_iterations(id)')
    expect(analytics).toContain('campaign_publication_id uuid not null references revenue_lab.campaign_publications(id)')
  })

  it('retains the legacy single-product path and references immutable Product Asset revisions', () => {
    expect(migration).toContain('source_row.curated_product_id, source_row.product_set_id')
    expect(migration).toContain('(curated_product_id is not null) <> (product_set_id is not null)')
    expect(assetRevisions).toContain('grant select, insert on revenue_lab.product_asset_revisions to service_role')
    expect(assetRevisions).not.toContain('grant update on revenue_lab.product_asset_revisions to service_role')
  })

  it('enforces three human-selected products, no rank, immutable revision, and service-role-only RPCs', () => {
    expect(migration).toContain("jsonb_array_length(p_payload->'items') <> 3")
    expect(migration).toContain('distinct_product_count <> 3')
    expect(migration).toContain('rank_position is null')
    expect(migration).toContain('product_asset_revision_id uuid not null references revenue_lab.product_asset_revisions(id)')
    for (const signature of [
      'revenue_lab.create_three_picks_campaign(uuid, jsonb, text, text, uuid)',
      'revenue_lab.enqueue_three_picks_plan(uuid, jsonb, text, text, text, text, uuid)',
      'revenue_lab.enqueue_final_composition(uuid, text, text, text, jsonb, uuid)',
      'revenue_lab.guard_campaign_product_set_items()',
      'revenue_lab.validate_locked_three_picks_set()',
    ]) {
      expect(migration).toContain(`revoke execute on function ${signature} from public, anon, authenticated`)
      expect(migration).toContain(`grant execute on function ${signature} to service_role`)
    }
  })
})

describe('Store product selection validation', () => {
  it('rejects duplicate products before an RPC request', async () => {
    const store = createSupabaseStore({ url: 'https://example.supabase.co', serviceRoleKey: 'test-service-role',
      fetchImpl: vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify([{ id: uuid(99) }]) })) })
    await expect(store.createThreePicksCampaign({ idempotencyKey: uuid(70), campaignName: 'Test', items: [
      { curatedProductId: uuid(1), productAssetRevisionId: uuid(21), verifiedFactRef: 'a' },
      { curatedProductId: uuid(1), productAssetRevisionId: uuid(22), verifiedFactRef: 'b' },
      { curatedProductId: uuid(3), productAssetRevisionId: uuid(23), verifiedFactRef: 'c' },
    ] })).rejects.toMatchObject({ code: 'THREE_PICKS_VALIDATION_ERROR' })
  })
})
