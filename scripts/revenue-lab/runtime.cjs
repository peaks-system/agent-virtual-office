'use strict'

const { createJobHandlers } = require('./job-handlers.cjs')
const { createLocalWorker } = require('./worker.cjs')
const { createSupabaseStore } = require('./supabase-store.cjs')
const { createYouTubeClient } = require('./youtube-client.cjs')
const { createOpenAIAnalysisClient } = require('./openai-client.cjs')
const { createCreativeProductionClient } = require('./creative-production-client.cjs')
const { createPolloVideoGenerationProvider } = require('./providers/pollo-video-generation-provider.cjs')
const { createPolloWanVideoGenerationProvider } = require('./providers/pollo-wan-video-generation-provider.cjs')
const { createSupabaseProductAssetBlobStore } = require('./product-asset-blob-store.cjs')
const { createRakutenProductProvider } = require('./providers/rakuten-product-provider.cjs')
const { createMultiProductShortsClient } = require('./multi-product-shorts-client.cjs')
const { createMultiProductShortsV2Client } = require('./multi-product-shorts-v2-client.cjs')
const { createLocalFfmpegCompositionProvider } = require('./providers/local-ffmpeg-composition-provider.cjs')
const { createLocalFfmpegCompositionV2Provider } = require('./providers/local-ffmpeg-composition-v2-provider.cjs')
const { createSupabaseCompositionBlobStore } = require('./composition-blob-store.cjs')
const { createSupabaseCreativeAudioBlobStore } = require('./creative-audio-blob-store.cjs')

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'YOUTUBE_API_KEY']

function createRevenueRuntime({
  env = process.env,
  store,
  youtube,
  productProvider,
  workerFactory = createLocalWorker,
} = {}) {
  const missing = REQUIRED_ENV.filter(key => !env[key])
  if (missing.length) {
    return {
      active: false,
      missing,
      store: null,
      start() {},
      close() {},
    }
  }

  const runtimeStore = store || createSupabaseStore({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  })
  const runtimeYouTube = youtube || createYouTubeClient({ apiKey: env.YOUTUBE_API_KEY })
  const analyst = env.OPENAI_API_KEY ? createOpenAIAnalysisClient({ apiKey: env.OPENAI_API_KEY, model: env.REVENUE_LAB_OPENAI_MODEL || undefined }) : null
  const creativeProducer = env.OPENAI_API_KEY ? createCreativeProductionClient({ apiKey: env.OPENAI_API_KEY, model: env.REVENUE_LAB_CREATIVE_PRODUCTION_MODEL || undefined }) : null
  const multiProductShortsPlanner = env.OPENAI_API_KEY ? createMultiProductShortsClient({ apiKey: env.OPENAI_API_KEY, model: env.REVENUE_LAB_MULTI_PRODUCT_MODEL || undefined }) : null
  const multiProductShortsV2Planner = env.OPENAI_API_KEY ? createMultiProductShortsV2Client({ apiKey: env.OPENAI_API_KEY, model: env.REVENUE_LAB_MULTI_PRODUCT_V2_MODEL || undefined }) : null
  const videoGenerationProvider = env.POLLO_API_KEY ? createPolloVideoGenerationProvider({ apiKey: env.POLLO_API_KEY, model: env.REVENUE_LAB_POLLO_MODEL || undefined }) : null
  const imageToVideoProvider = env.POLLO_API_KEY ? createPolloWanVideoGenerationProvider({ apiKey: env.POLLO_API_KEY }) : null
  const productAssetBlobStore = env.REVENUE_LAB_PRODUCT_ASSET_BUCKET
    ? createSupabaseProductAssetBlobStore({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.REVENUE_LAB_PRODUCT_ASSET_BUCKET }) : null
  const finalCompositionProvider = env.REVENUE_LAB_FFMPEG_PATH && env.REVENUE_LAB_FFPROBE_PATH
    ? createLocalFfmpegCompositionProvider({ ffmpegPath: env.REVENUE_LAB_FFMPEG_PATH, ffprobePath: env.REVENUE_LAB_FFPROBE_PATH }) : null
  const finalCompositionV2Provider = env.REVENUE_LAB_FFMPEG_PATH && env.REVENUE_LAB_FFPROBE_PATH
    ? createLocalFfmpegCompositionV2Provider() : null
  const compositionBlobStore = env.REVENUE_LAB_COMPOSITION_BUCKET
    ? createSupabaseCompositionBlobStore({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.REVENUE_LAB_COMPOSITION_BUCKET }) : null
  const creativeAudioBlobStore = env.REVENUE_LAB_CREATIVE_AUDIO_BUCKET
    ? createSupabaseCreativeAudioBlobStore({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.REVENUE_LAB_CREATIVE_AUDIO_BUCKET }) : null
  const rakuten = productProvider || (env.RAKUTEN_APPLICATION_ID && env.RAKUTEN_ACCESS_KEY
    ? createRakutenProductProvider({ applicationId: env.RAKUTEN_APPLICATION_ID, accessKey: env.RAKUTEN_ACCESS_KEY, affiliateId: env.RAKUTEN_AFFILIATE_ID })
    : null)
  const handlers = createJobHandlers({
    store: runtimeStore, youtube: runtimeYouTube, analyst, creativeProducer,
    multiProductShortsPlanner, multiProductShortsV2Planner, finalCompositionProvider,
    finalCompositionV2Provider, compositionBlobStore, creativeAudioBlobStore,
    videoGenerationProvider, imageToVideoProvider, productAssetBlobStore, productProvider: rakuten,
    videoPollAttempts: Number(env.REVENUE_LAB_POLLO_POLL_ATTEMPTS) || 30,
    videoPollIntervalMs: Number(env.REVENUE_LAB_POLLO_POLL_INTERVAL_MS) || 5000,
  })
  const worker = workerFactory({ store: runtimeStore, handlers })
  let started = false

  function start() {
    if (started) return
    started = true
    console.log('[revenue-lab] Local worker started', {
      workerId: worker.workerId,
      pollIntervalMs: worker.pollIntervalMs,
      leaseSeconds: worker.leaseSeconds,
    })
    Promise.resolve(worker.run()).catch(error => {
      console.error('[revenue-lab] Local worker stopped', { code: error?.code || 'WORKER_FAILED' })
    })
  }

  function close() { worker.stop() }
  return { active: true, missing: [], store: runtimeStore, start, close, worker }
}

module.exports = { REQUIRED_ENV, createRevenueRuntime }
