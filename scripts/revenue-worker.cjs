#!/usr/bin/env node
'use strict'

const { createJobHandlers } = require('./revenue-lab/job-handlers.cjs')
const { createLocalWorker } = require('./revenue-lab/worker.cjs')
const { createSupabaseStore } = require('./revenue-lab/supabase-store.cjs')
const { createYouTubeClient } = require('./revenue-lab/youtube-client.cjs')
const { createOpenAIAnalysisClient } = require('./revenue-lab/openai-client.cjs')
const { createCreativeProductionClient } = require('./revenue-lab/creative-production-client.cjs')
const { createPolloVideoGenerationProvider } = require('./revenue-lab/providers/pollo-video-generation-provider.cjs')
const { createPolloWanVideoGenerationProvider } = require('./revenue-lab/providers/pollo-wan-video-generation-provider.cjs')
const { createSupabaseProductAssetBlobStore } = require('./revenue-lab/product-asset-blob-store.cjs')
const { createRakutenProductProvider } = require('./revenue-lab/providers/rakuten-product-provider.cjs')
const { createMultiProductShortsClient } = require('./revenue-lab/multi-product-shorts-client.cjs')
const { createMultiProductShortsV2Client } = require('./revenue-lab/multi-product-shorts-v2-client.cjs')
const { createLocalFfmpegCompositionProvider } = require('./revenue-lab/providers/local-ffmpeg-composition-provider.cjs')
const { createLocalFfmpegCompositionV2Provider } = require('./revenue-lab/providers/local-ffmpeg-composition-v2-provider.cjs')
const { createSupabaseCompositionBlobStore } = require('./revenue-lab/composition-blob-store.cjs')
const { createSupabaseCreativeAudioBlobStore } = require('./revenue-lab/creative-audio-blob-store.cjs')
const { createElevenLabsTtsProvider } = require('./revenue-lab/providers/elevenlabs-tts-provider.cjs')
const { createAudioDurationProbe } = require('./revenue-lab/audio-duration-probe.cjs')
const { assertTextToSpeechProvider } = require('./revenue-lab/text-to-speech-provider.cjs')

async function main() {
  const store = createSupabaseStore()
  const youtube = createYouTubeClient()
  const analyst = process.env.OPENAI_API_KEY ? createOpenAIAnalysisClient() : null
  const creativeProducer = process.env.OPENAI_API_KEY ? createCreativeProductionClient({ model: process.env.REVENUE_LAB_CREATIVE_PRODUCTION_MODEL || undefined }) : null
  const multiProductShortsPlanner = process.env.OPENAI_API_KEY ? createMultiProductShortsClient({ model: process.env.REVENUE_LAB_MULTI_PRODUCT_MODEL || undefined }) : null
  const multiProductShortsV2Planner = process.env.OPENAI_API_KEY ? createMultiProductShortsV2Client({ model: process.env.REVENUE_LAB_MULTI_PRODUCT_V2_MODEL || undefined }) : null
  const videoGenerationProvider = process.env.POLLO_API_KEY ? createPolloVideoGenerationProvider({ model: process.env.REVENUE_LAB_POLLO_MODEL || undefined }) : null
  const imageToVideoProvider = process.env.POLLO_API_KEY ? createPolloWanVideoGenerationProvider() : null
  const productAssetBlobStore = process.env.REVENUE_LAB_PRODUCT_ASSET_BUCKET
    ? createSupabaseProductAssetBlobStore({ url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY, bucket: process.env.REVENUE_LAB_PRODUCT_ASSET_BUCKET }) : null
  const finalCompositionProvider = process.env.REVENUE_LAB_FFMPEG_PATH && process.env.REVENUE_LAB_FFPROBE_PATH
    ? createLocalFfmpegCompositionProvider({ ffmpegPath: process.env.REVENUE_LAB_FFMPEG_PATH, ffprobePath: process.env.REVENUE_LAB_FFPROBE_PATH }) : null
  const finalCompositionV2Provider = process.env.REVENUE_LAB_FFMPEG_PATH && process.env.REVENUE_LAB_FFPROBE_PATH
    ? createLocalFfmpegCompositionV2Provider() : null
  const compositionBlobStore = process.env.REVENUE_LAB_COMPOSITION_BUCKET
    ? createSupabaseCompositionBlobStore({ url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY, bucket: process.env.REVENUE_LAB_COMPOSITION_BUCKET }) : null
  const audioBucketValid = process.env.REVENUE_LAB_CREATIVE_AUDIO_BUCKET === 'revenue-lab-creative-audio'
    && process.env.REVENUE_LAB_CREATIVE_AUDIO_BUCKET !== process.env.REVENUE_LAB_PRODUCT_ASSET_BUCKET
    && process.env.REVENUE_LAB_CREATIVE_AUDIO_BUCKET !== process.env.REVENUE_LAB_COMPOSITION_BUCKET
  const creativeAudioBlobStore = audioBucketValid
    ? createSupabaseCreativeAudioBlobStore({ url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY, bucket: process.env.REVENUE_LAB_CREATIVE_AUDIO_BUCKET }) : null
  const configuredTextToSpeechProvider = process.env.ELEVENLABS_API_KEY && process.env.REVENUE_LAB_ELEVENLABS_MODEL_ID
    && process.env.REVENUE_LAB_ELEVENLABS_VOICE_ID && audioBucketValid
    ? createElevenLabsTtsProvider() : null
  const textToSpeechProvider = configuredTextToSpeechProvider
    ? assertTextToSpeechProvider(configuredTextToSpeechProvider) : null
  const audioDurationProbe = textToSpeechProvider && process.env.REVENUE_LAB_FFPROBE_PATH
    ? createAudioDurationProbe({ ffprobePath: process.env.REVENUE_LAB_FFPROBE_PATH }) : null
  const productProvider = process.env.RAKUTEN_APPLICATION_ID && process.env.RAKUTEN_ACCESS_KEY ? createRakutenProductProvider() : null
  const handlers = createJobHandlers({
    store, youtube, analyst, creativeProducer, multiProductShortsPlanner,
    multiProductShortsV2Planner, finalCompositionProvider, finalCompositionV2Provider,
    compositionBlobStore, creativeAudioBlobStore, videoGenerationProvider, imageToVideoProvider,
    textToSpeechProvider, audioDurationProbe,
    productAssetBlobStore, productProvider,
    videoPollAttempts: Number(process.env.REVENUE_LAB_POLLO_POLL_ATTEMPTS) || 30,
    videoPollIntervalMs: Number(process.env.REVENUE_LAB_POLLO_POLL_INTERVAL_MS) || 5000,
  })
  const worker = createLocalWorker({ store, handlers })
  const shutdown = signal => {
    console.log(`[revenue-lab] ${signal} received; stopping after the current job.`)
    worker.stop()
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
  console.log('[revenue-lab] Local worker started', { workerId: worker.workerId, pollIntervalMs: worker.pollIntervalMs, leaseSeconds: worker.leaseSeconds })
  await worker.run()
}

if (require.main === module) {
  main().catch(error => {
    console.error('[revenue-lab] Worker stopped with an error', { code: error?.code || 'WORKER_START_FAILED', message: String(error?.message || 'Unknown error') })
    process.exitCode = 1
  })
}

module.exports = { main }
