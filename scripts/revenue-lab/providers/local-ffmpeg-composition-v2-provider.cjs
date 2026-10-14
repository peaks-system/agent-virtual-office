'use strict'

const { FinalCompositionProvider, FinalCompositionProviderError } = require('../final-composition-provider.cjs')
const { ARCHETYPE, LAYOUT_ID, MANIFEST_VERSION, TEMPLATE_ID } = require('../multi-product-shorts-v2-schema.cjs')
const { COMPOSITION_VERSION } = require('../multi-product-shorts-v2-composition.cjs')

const PROVIDER_ID = 'local_ffmpeg'
const PROVIDER_VERSION = COMPOSITION_VERSION

function sealed(code) { return new FinalCompositionProviderError(code, 'Creative Archetype v2 composition could not be completed') }

function assertV2Manifest(manifest) {
  const output = manifest?.output
  if (manifest?.manifest_version !== MANIFEST_VERSION || manifest?.archetype !== ARCHETYPE
    || manifest?.template_id !== TEMPLATE_ID || manifest?.layout_id !== LAYOUT_ID
    || output?.width !== 1080 || output?.height !== 1920 || output?.fps !== 30
    || output?.container !== 'mp4' || output?.video_codec !== 'h264' || output?.pixel_format !== 'yuv420p'
    || output?.faststart !== true || output?.audio !== true || output?.duration_seconds < 35 || output?.duration_seconds > 45
    || !Array.isArray(manifest.scenes) || !Array.isArray(manifest.subtitle_cues) || manifest.product_cards) {
    throw sealed('COMPOSITION_V2_MANIFEST_INVALID')
  }
}

function buildV2CompositionPlan(manifest) {
  assertV2Manifest(manifest)
  return {
    templateId: TEMPLATE_ID, layoutId: LAYOUT_ID, output: { ...manifest.output },
    scenes: manifest.scenes.map(scene => ({ id: scene.id, kind: scene.kind,
      start_seconds: scene.start_seconds, duration_seconds: scene.duration_seconds,
      transition: scene.transition, layers: scene.layers })),
    subtitleCues: manifest.subtitle_cues.map(cue => ({ ...cue })), audioMix: { ...manifest.audio_mix },
  }
}

function createLocalFfmpegCompositionV2Provider({ renderImpl } = {}) {
  class LocalV2Provider extends FinalCompositionProvider {
    constructor() { super({ id: PROVIDER_ID, version: PROVIDER_VERSION }) }
    async render({ manifest, assets, audioAssets }) {
      const plan = buildV2CompositionPlan(manifest)
      if (typeof renderImpl !== 'function') throw sealed('COMPOSITION_V2_RENDERER_NOT_CONFIGURED')
      try {
        return await renderImpl(plan, { assets, audioAssets })
      } catch (error) {
        if (error instanceof FinalCompositionProviderError) throw error
        throw sealed(error?.code || 'COMPOSITION_V2_RENDER_FAILED')
      }
    }
    normalizeError(error) { return error instanceof FinalCompositionProviderError ? error : sealed() }
  }
  return new LocalV2Provider()
}

module.exports = { PROVIDER_ID, PROVIDER_VERSION, assertV2Manifest, buildV2CompositionPlan, createLocalFfmpegCompositionV2Provider }
