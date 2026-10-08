'use strict'

const { createJobHandlers } = require('./job-handlers.cjs')
const { createLocalWorker } = require('./worker.cjs')
const { createSupabaseStore } = require('./supabase-store.cjs')
const { createYouTubeClient } = require('./youtube-client.cjs')

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'YOUTUBE_API_KEY']

function createRevenueRuntime({
  env = process.env,
  store,
  youtube,
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
  const handlers = createJobHandlers({ store: runtimeStore, youtube: runtimeYouTube })
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
