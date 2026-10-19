'use strict'

const { createHash } = require('node:crypto')
const { canonicalize } = require('./canonical-json.cjs')
const { ARCHETYPE, LAYOUT_ID, MANIFEST_VERSION, TEMPLATE_ID, planNarrationSegments } = require('./multi-product-shorts-v2-schema.cjs')

const COMPOSITION_VERSION = 'local-shorts-composer-v2'
const BACKGROUND_VERSION = 'subordinate-graphic-background-v1'
const FRAME_RATE = 30
const TIMING = Object.freeze({ hook: [3, 4, 5], product: [7, 10, 13], cta: [4, 5, 6], minimum: 35, maximum: 45 })
const hash = value => createHash('sha256').update(canonicalize(value)).digest('hex')
const rounded = value => Math.round(value * 1000) / 1000

function requiredSceneDuration(kind, segments) {
  const [minimum, preferred, maximum] = TIMING[kind]
  const audio = rounded(segments.reduce((sum, segment) => sum + segment.duration_seconds, 0))
  const duration = Math.max(preferred * FRAME_RATE, Math.ceil((audio + 0.5) * FRAME_RATE)) / FRAME_RATE
  if (duration < minimum || duration > maximum) throw Object.assign(new Error('Measured narration cannot fit scene timing'), { code: 'THREE_PICKS_V2_AUDIO_TIMING_INVALID' })
  return duration
}

function compileThreePicksV2Manifest({ requestId, planRevision, campaignId, iterationId, productSetId,
  plan, items, audioArtifacts }) {
  if (plan?.archetype !== ARCHETYPE || !Array.isArray(items) || items.length !== 3) throw new TypeError('Invalid v2 composition input')
  const audioBySegment = new Map((audioArtifacts || []).map(artifact => [artifact.segmentId, artifact]))
  const plannedSegments = planNarrationSegments(plan)
  const measured = plannedSegments.map(segment => {
    const artifact = audioBySegment.get(segment.segment_id)
    if (!artifact || artifact.status !== 'ready' || !(Number(artifact.durationSeconds) > 0)
      || !artifact.immutableObjectKey || !/^[0-9a-f]{64}$/.test(artifact.audioSha256 || '')) {
      throw Object.assign(new Error('Narration audio artifacts are not ready'), { code: 'THREE_PICKS_V2_AUDIO_NOT_READY' })
    }
    return { ...segment, duration_seconds: rounded(Number(artifact.durationSeconds)),
      audio_artifact_id: artifact.id || null, audio_object_key: artifact.immutableObjectKey,
      audio_sha256: artifact.audioSha256 }
  })
  const presentations = [...plan.product_presentations].sort((a, b) => a.presentation_order - b.presentation_order)
  const itemById = new Map(items.map(item => [item.id, item])); let cursorFrames = 0
  const sceneSpecs = [
    { id: 'hook', kind: 'hook', display: plan.hook.display_text },
    ...presentations.map(item => ({ id: `product-${item.presentation_order}`, kind: 'product', presentation: item })),
    { id: 'cta', kind: 'cta', display: plan.cta.display_text },
  ]
  const subtitleCues = []; const scenes = sceneSpecs.map(spec => {
    const segments = measured.filter(segment => segment.scene === spec.id)
    const duration = requiredSceneDuration(spec.kind === 'product' ? 'product' : spec.kind, segments)
    const durationFrames = Math.round(duration * FRAME_RATE)
    let audioCursorFrames = cursorFrames + Math.ceil(0.25 * FRAME_RATE)
    for (const segment of segments) {
      const audioDurationFrames = Math.ceil(segment.duration_seconds * FRAME_RATE)
      subtitleCues.push({ segment_id: segment.segment_id, scene_id: spec.id, text: segment.text,
        start_seconds: audioCursorFrames / FRAME_RATE, duration_seconds: audioDurationFrames / FRAME_RATE,
        audio_artifact_id: segment.audio_artifact_id, audio_object_key: segment.audio_object_key,
        audio_sha256: segment.audio_sha256 })
      audioCursorFrames += audioDurationFrames
    }
    const base = { id: spec.id, kind: spec.kind, start_seconds: cursorFrames / FRAME_RATE,
      duration_seconds: durationFrames / FRAME_RATE,
      transition: spec.kind === 'product' ? 'carousel_slide' : 'fade', layers: [] }
    if (spec.kind === 'product') {
      const item = itemById.get(spec.presentation.product_set_item_id)
      if (!item || !Array.isArray(item.assetRevisions) || item.assetRevisions.length < 1 || item.assetRevisions.length > 4
        || item.assetRevisions[0].assetOrder !== 1) throw Object.assign(new Error('Product assets are incomplete'), { code: 'THREE_PICKS_V2_ASSET_INVALID' })
      base.product_set_item_id = item.id
      base.layers = [
        { kind: 'background', recipe_version: BACKGROUND_VERSION, prominence: 'subordinate' },
        ...item.assetRevisions.map((asset, index) => ({ kind: 'product_image', role: index === 0 ? 'hero' : 'supporting',
          asset_order: asset.assetOrder, product_asset_revision_id: asset.id, content_sha256: asset.contentSha256,
          layout_id: LAYOUT_ID, motion: index === 0 ? 'hero_slow_zoom' : 'supporting_carousel' })),
        { kind: 'display_name', text: spec.presentation.display_name },
        { kind: 'short_appeal', text: spec.presentation.short_appeal },
        { kind: 'fact_badge', text: spec.presentation.fact_badge, verified_fact_ref: spec.presentation.verified_fact_ref },
        { kind: 'subtitle', cue_ids: segments.map(segment => segment.segment_id) },
      ]
    } else {
      base.layers = [{ kind: 'background', recipe_version: BACKGROUND_VERSION, prominence: 'subordinate' },
        { kind: spec.kind === 'hook' ? 'hook_text' : 'cta_text', text: spec.display },
        { kind: 'subtitle', cue_ids: segments.map(segment => segment.segment_id) }]
    }
    cursorFrames += durationFrames
    return base
  })
  const cursor = cursorFrames / FRAME_RATE
  if (cursor < TIMING.minimum || cursor > TIMING.maximum) throw Object.assign(new Error('Composition duration is outside 35-45 seconds'), { code: 'THREE_PICKS_V2_DURATION_INVALID' })
  const manifest = {
    manifest_version: MANIFEST_VERSION, archetype: ARCHETYPE, template_id: TEMPLATE_ID, layout_id: LAYOUT_ID,
    lineage: { campaign_id: campaignId, campaign_iteration_id: iterationId, product_set_id: productSetId,
      creative_archetype_request_id: requestId, plan_revision: planRevision },
    output: { width: 1080, height: 1920, fps: 30, container: 'mp4', video_codec: 'h264',
      pixel_format: 'yuv420p', faststart: true, audio: true, duration_seconds: cursor },
    audio_mix: { narration: 'measured_segment_artifacts', sound_effects: 'template_timing',
      background_music: 'template_loop', bgm_ducking: { during_narration_db: -12, attack_ms: 120, release_ms: 280 } },
    scenes, subtitle_cues: subtitleCues,
  }
  return { manifest, compositionFingerprint: hash({ version: COMPOSITION_VERSION, manifest }) }
}

module.exports = { BACKGROUND_VERSION, COMPOSITION_VERSION, FRAME_RATE, TIMING,
  compileThreePicksV2Manifest, hash, requiredSceneDuration }
