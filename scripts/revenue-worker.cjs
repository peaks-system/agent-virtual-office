#!/usr/bin/env node
'use strict'

const { createJobHandlers } = require('./revenue-lab/job-handlers.cjs')
const { createLocalWorker } = require('./revenue-lab/worker.cjs')
const { createSupabaseStore } = require('./revenue-lab/supabase-store.cjs')
const { createYouTubeClient } = require('./revenue-lab/youtube-client.cjs')
const { createOpenAIAnalysisClient } = require('./revenue-lab/openai-client.cjs')
const { createCreativeProductionClient } = require('./revenue-lab/creative-production-client.cjs')
const { createPolloVideoGenerationProvider } = require('./revenue-lab/providers/pollo-video-generation-provider.cjs')
const { createRakutenProductProvider } = require('./revenue-lab/providers/rakuten-product-provider.cjs')

async function main() {
  const store = createSupabaseStore()
  const youtube = createYouTubeClient()
  const analyst = process.env.OPENAI_API_KEY ? createOpenAIAnalysisClient() : null
  const creativeProducer = process.env.OPENAI_API_KEY ? createCreativeProductionClient({ model: process.env.REVENUE_LAB_CREATIVE_PRODUCTION_MODEL || undefined }) : null
  const videoGenerationProvider = process.env.POLLO_API_KEY ? createPolloVideoGenerationProvider({ model: process.env.REVENUE_LAB_POLLO_MODEL || undefined }) : null
  const productProvider = process.env.RAKUTEN_APPLICATION_ID && process.env.RAKUTEN_ACCESS_KEY ? createRakutenProductProvider() : null
  const handlers = createJobHandlers({
    store, youtube, analyst, creativeProducer, videoGenerationProvider, productProvider,
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
