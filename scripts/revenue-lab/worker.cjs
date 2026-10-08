'use strict'

const os = require('node:os')

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function defaultWorkerId() {
  return `${os.hostname() || 'local'}-${process.pid}`.slice(0, 120)
}

function createLocalWorker({
  store,
  handlers,
  workerId = process.env.REVENUE_LAB_WORKER_ID || defaultWorkerId(),
  pollIntervalMs = boundedInteger(process.env.REVENUE_LAB_POLL_INTERVAL_MS, 30_000, 5_000, 300_000),
  leaseSeconds = boundedInteger(process.env.REVENUE_LAB_JOB_LEASE_SECONDS, 300, 60, 3_600),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!store || !(handlers instanceof Map)) throw new TypeError('store and handler map are required')
  let stopping = false

  async function runOne() {
    const job = await store.claimNext(workerId, leaseSeconds)
    if (!job) return { claimed: false }
    const handler = handlers.get(job.jobType)
    if (!handler) {
      const error = { code: 'UNSUPPORTED_JOB_TYPE', message: 'No handler is registered for this job type' }
      console.error('[revenue-lab] Unsupported job type', { jobId: job.id, jobType: job.jobType })
      await store.finishJob(job.id, workerId, false, error)
      return { claimed: true, succeeded: false, jobId: job.id, errorCode: error.code }
    }
    try {
      const result = await handler(job)
      await store.finishJob(job.id, workerId, true)
      return { claimed: true, succeeded: true, jobId: job.id, result }
    } catch (error) {
      const safe = { code: error?.code || 'JOB_FAILED', message: String(error?.message || 'Revenue Lab job failed').slice(0, 500) }
      console.error('[revenue-lab] Job failed', { jobId: job.id, jobType: job.jobType, code: safe.code })
      await store.finishJob(job.id, workerId, false, safe)
      return { claimed: true, succeeded: false, jobId: job.id, errorCode: safe.code }
    }
  }

  async function run() {
    while (!stopping) {
      let result
      try { result = await runOne() }
      catch {
        console.error('[revenue-lab] Worker polling failed', { workerId })
        result = { claimed: false }
      }
      if (!result.claimed && !stopping) await sleep(pollIntervalMs)
    }
  }

  function stop() { stopping = true }
  return { leaseSeconds, pollIntervalMs, run, runOne, stop, workerId }
}

module.exports = { boundedInteger, createLocalWorker, defaultWorkerId }
