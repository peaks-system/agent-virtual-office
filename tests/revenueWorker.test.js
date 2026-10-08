import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createJobHandlers } = require('../scripts/revenue-lab/job-handlers.cjs')
const { boundedInteger, createLocalWorker } = require('../scripts/revenue-lab/worker.cjs')

const capturedAt = new Date('2026-10-07T12:00:00.000Z')

describe('Revenue Lab job handler and local worker', () => {
  it('collects, attaches the previous snapshot, scores, and persists one run', async () => {
    const store = {
      getQuery: vi.fn(async () => ({ id: 'q1', sourceId: 's1', queryText: '机 ガジェット', buyerIntent: 80, commerceFit: 60, enabled: true, maxResults: 25 })),
      startRun: vi.fn(async () => 'run1'),
      previousVideoSnapshots: vi.fn(async () => new Map([['v1', { viewCount: 100, capturedAt: '2026-10-07T10:00:00Z' }]])),
      persistCollection: vi.fn(async () => {}),
      failRun: vi.fn(async () => {}),
    }
    const youtube = { collect: vi.fn(async () => [{
      youtubeVideoId: 'v1', title: '動画', channelId: 'c1', channelTitle: 'ch', publishedAt: '2026-10-06T12:00:00Z',
      capturedAt: capturedAt.toISOString(), viewCount: 200, likeCount: 10, commentCount: 1, subscriberCount: 100,
      hiddenSubscriberCount: false, searchPosition: 1,
    }]) }
    const handlers = createJobHandlers({ store, youtube, clock: () => capturedAt })
    const result = await handlers.get('youtube.collect')({ id: 'job1', payload: { source_query_id: 'q1' } })
    expect(youtube.collect).toHaveBeenCalledWith(expect.objectContaining({ regionCode: 'JP', relevanceLanguage: 'ja', lookbackDays: 7, maxResults: 25 }))
    expect(store.previousVideoSnapshots).toHaveBeenCalledWith('s1', ['v1'])
    expect(store.persistCollection).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run1',
      opportunities: [expect.objectContaining({ velocityMode: 'observed_delta', viewsVelocity: 50, scoreVersion: 'youtube-v1' })],
    }))
    expect(result).toEqual({ runId: 'run1', received: 1, scored: 1, excludedReason: null })
  })

  it('persists configuration-missing as a skipped collection with no scores', async () => {
    const store = {
      getQuery: vi.fn(async () => ({ id: 'q1', sourceId: 's1', queryText: 'x', buyerIntent: null, commerceFit: 40, enabled: true, maxResults: 1 })),
      startRun: vi.fn(async () => 'run1'), previousVideoSnapshots: vi.fn(async () => new Map()),
      persistCollection: vi.fn(async () => {}), failRun: vi.fn(async () => {}),
    }
    const youtube = { collect: vi.fn(async () => [{ youtubeVideoId: 'v1', publishedAt: '2026-10-07T10:00:00Z', capturedAt: capturedAt.toISOString(), viewCount: 1, searchPosition: 1 }]) }
    const handlers = createJobHandlers({ store, youtube, clock: () => capturedAt })
    const result = await handlers.get('youtube.collect')({ id: 'job1', payload: { source_query_id: 'q1' } })
    expect(result.excludedReason).toBe('query_scoring_not_configured')
    expect(store.persistCollection).toHaveBeenCalledWith(expect.objectContaining({ opportunities: [] }))
  })

  it('marks a run failed and exposes only a sealed job error', async () => {
    const store = {
      getQuery: vi.fn(async () => ({ id: 'q1', sourceId: 's1', queryText: 'x', buyerIntent: 50, commerceFit: 50, enabled: true, maxResults: 1 })),
      startRun: vi.fn(async () => 'run1'), failRun: vi.fn(async () => {}),
    }
    const youtube = { collect: vi.fn(async () => { throw Object.assign(new Error('upstream secret'), { code: 'YOUTUBE_HTTP_ERROR' }) }) }
    const handlers = createJobHandlers({ store, youtube, clock: () => capturedAt })
    await expect(handlers.get('youtube.collect')({ id: 'job1', payload: { source_query_id: 'q1' } })).rejects.toMatchObject({ code: 'YOUTUBE_HTTP_ERROR', message: 'YouTube collection failed' })
    expect(store.failRun).toHaveBeenCalledWith('run1', expect.any(Error))
  })

  it('claims and finishes a supported job through the runner-neutral handler map', async () => {
    const store = {
      claimNext: vi.fn(async () => ({ id: 'job1', jobType: 'youtube.collect', payload: {} })),
      finishJob: vi.fn(async () => {}),
    }
    const handler = vi.fn(async () => ({ ok: true }))
    const worker = createLocalWorker({ store, handlers: new Map([['youtube.collect', handler]]), workerId: 'worker-test', leaseSeconds: 60 })
    await expect(worker.runOne()).resolves.toEqual({ claimed: true, succeeded: true, jobId: 'job1', result: { ok: true } })
    expect(store.claimNext).toHaveBeenCalledWith('worker-test', 60)
    expect(store.finishJob).toHaveBeenCalledWith('job1', 'worker-test', true)
  })

  it('fails unsupported and throwing jobs without escaping the worker boundary', async () => {
    const jobs = [
      { id: 'a', jobType: 'unknown', payload: {} },
      { id: 'b', jobType: 'youtube.collect', payload: {} },
    ]
    const store = { claimNext: vi.fn(async () => jobs.shift()), finishJob: vi.fn(async () => {}) }
    const handler = vi.fn(async () => { throw Object.assign(new Error('safe failure'), { code: 'HANDLER_FAILED' }) })
    const worker = createLocalWorker({ store, handlers: new Map([['youtube.collect', handler]]), workerId: 'worker-test' })
    expect(await worker.runOne()).toMatchObject({ succeeded: false, errorCode: 'UNSUPPORTED_JOB_TYPE' })
    expect(await worker.runOne()).toMatchObject({ succeeded: false, errorCode: 'HANDLER_FAILED' })
    expect(store.finishJob).toHaveBeenNthCalledWith(1, 'a', 'worker-test', false, expect.objectContaining({ code: 'UNSUPPORTED_JOB_TYPE' }))
    expect(store.finishJob).toHaveBeenNthCalledWith(2, 'b', 'worker-test', false, expect.objectContaining({ code: 'HANDLER_FAILED' }))
  })

  it('bounds environment-controlled polling and lease settings', () => {
    expect(boundedInteger('4999', 30000, 5000, 300000)).toBe(30000)
    expect(boundedInteger('5000', 30000, 5000, 300000)).toBe(5000)
    expect(boundedInteger('3601', 300, 60, 3600)).toBe(300)
  })
})
