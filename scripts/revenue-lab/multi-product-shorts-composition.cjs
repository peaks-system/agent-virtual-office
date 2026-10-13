'use strict'

const { createHash } = require('node:crypto')
const { canonicalize } = require('./canonical-json.cjs')
const { RANKING_PATTERN } = require('./multi-product-shorts-schema.cjs')

const BACKGROUND_VERSION = 'simple-animated-background-v1'
const CARD_TEMPLATE_VERSION = 'product-card-v1'
const COMPOSITION_VERSION = 'local-shorts-composer-v1'

function hash(value) { return createHash('sha256').update(canonicalize(value)).digest('hex') }

function deterministicBackground(seedInput) {
  const seed = hash({ version: BACKGROUND_VERSION, seed: seedInput })
  const palettes = [
    ['#102A43', '#1F7A8C', '#E0FBFC'], ['#2D1B69', '#5B4B8A', '#E8D7FF'],
    ['#133C55', '#386FA4', '#DCEAF7'], ['#243B2E', '#4F7C5D', '#E5F3E9'],
  ]
  const palette = palettes[Number.parseInt(seed.slice(0, 2), 16) % palettes.length]
  return {
    version: BACKGROUND_VERSION, seed, type: 'simple_animated_background', palette,
    gradient_angle: 120 + (Number.parseInt(seed.slice(2, 4), 16) % 60),
    shapes: { count: 3, opacity: 0.12, drift: 'slow' },
    particles: { count: 10, opacity: 0.10, speed: 'slow' },
    prominence: 'subordinate_to_product',
  }
}

function buildProductCards(plan, items) {
  const byId = new Map(items.map(item => [item.id, item]))
  return [...plan.product_presentations].sort((a, b) => a.presentation_order - b.presentation_order).map((presentation, index) => {
    const item = byId.get(presentation.product_set_item_id)
    if (!item) throw Object.assign(new Error('Product Set item was not found'), { code: 'THREE_PICKS_PRODUCT_MISMATCH' })
    if (presentation.verified_fact_ref !== item.verifiedFactRef || RANKING_PATTERN.test(`${presentation.short_appeal} ${presentation.on_screen_text}`)) {
      throw Object.assign(new Error('Product Card input is not verified'), { code: 'THREE_PICKS_CARD_INVALID' })
    }
    return {
      product_set_item_id: item.id, product_destination_id: item.destination.id,
      product_asset_revision_id: item.assetRevision.id, product_asset_sha256: item.assetRevision.contentSha256,
      pick_number: index + 1, rank_position: null, product_name: item.productName,
      short_appeal: presentation.short_appeal, on_screen_text: presentation.on_screen_text,
      verified_fact_ref: item.verifiedFactRef, verified_fact: item.verifiedFact,
      price: item.price || null, commerce_destination: item.destination.snapshot,
      card_template_version: CARD_TEMPLATE_VERSION,
    }
  })
}

function buildRenderManifest({ requestId, planRevision, campaignId, iterationId, productSetId, plan, cards }) {
  if (!Array.isArray(cards) || cards.length !== 3) throw new TypeError('Exactly three Product Cards are required')
  const background = deterministicBackground({ campaignId, iterationId, productSetId, requestId, planRevision })
  const timeline = [
    { kind: 'hook', duration_seconds: 3, text: plan.hook, transition: 'fade' },
    ...cards.map(card => ({ kind: 'product_card', duration_seconds: 4, pick_number: card.pick_number,
      product_card: card, transition: card.pick_number % 2 ? 'slide' : 'slow_zoom' })),
    { kind: 'summary', duration_seconds: 3, text: plan.summary, transition: 'scale' },
    { kind: 'cta', duration_seconds: 2, text: plan.cta, transition: 'fade' },
  ]
  const manifest = {
    manifest_version: 'three-picks-composition-manifest-v1', archetype: 'three_picks_v1',
    lineage: { campaign_id: campaignId, campaign_iteration_id: iterationId,
      product_set_id: productSetId, creative_archetype_request_id: requestId, plan_revision: planRevision },
    output: { width: 1080, height: 1920, fps: 30, container: 'mp4', video_codec: 'h264',
      pixel_format: 'yuv420p', faststart: true, audio: false, duration_seconds: 20 },
    background, product_cards: cards, timeline,
  }
  return { manifest, compositionFingerprint: hash({ version: COMPOSITION_VERSION, manifest }) }
}

module.exports = { BACKGROUND_VERSION, CARD_TEMPLATE_VERSION, COMPOSITION_VERSION,
  buildProductCards, buildRenderManifest, deterministicBackground, hash }
