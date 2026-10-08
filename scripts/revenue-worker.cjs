#!/usr/bin/env node
'use strict'

const { createJobHandlers } = require('./revenue-lab/job-handlers.cjs')
const { createLocalWorker } = require('./revenue-lab/worker.cjs')
const { createSupabaseStore } = require('./revenue-lab/supabase-store.cjs')
const { createYouTubeClient } = require('./revenue-lab/youtube-client.cjs')

async function main() {
  const store = createSupabaseStore()
  const youtube = createYouTubeClient()
  const handlers = createJobHandlers({ store, youtube })
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
