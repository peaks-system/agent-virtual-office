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
      runId: 'run1', jobId: 'job1',
      opportunities: [expect.objectContaining({ velocityMode: 'observed_delta', viewsVelocity: 50, scoreVersion: 'youtube-v1' })],
    }))
    expect(result).toEqual({ runId: 'run1', received: 1, scored: 1, excludedReason: null })
  })

  it('tracks old candidates with a six-hour floor and retires missing IDs through the store', async () => {
    const targets = [
      { targetId: 't1', sourceQueryId: 'q1', sourceItemId: 'i1', youtubeVideoId: 'v1', buyerIntent: 90, commerceFit: 95, previousSnapshot: { id: 's1', viewCount: 100, capturedAt: '2026-10-06T00:00:00Z' } },
      { targetId: 't2', sourceQueryId: 'q1', sourceItemId: 'i2', youtubeVideoId: 'v2', buyerIntent: 90, commerceFit: 95, previousSnapshot: { id: 's2', viewCount: 100, capturedAt: '2026-10-07T10:00:00Z' } },
      { targetId: 't3', sourceQueryId: 'q1', sourceItemId: 'i3', youtubeVideoId: 'missing', buyerIntent: 90, commerceFit: 95, previousSnapshot: { id: 's3', viewCount: 10, capturedAt: '2026-10-06T00:00:00Z' } },
    ]
    const store = {
      listTrackingCandidates: vi.fn(async () => targets), markTrackingMissing: vi.fn(async () => 1),
      markTrackingSeen: vi.fn(async () => 2), startTrackingRun: vi.fn(async () => 'tracking-run'),
      persistTrackingSnapshots: vi.fn(async () => new Map([['i1', 'current-snapshot']])),
      persistTrackingRun: vi.fn(async () => {}),
    }
    const youtube = { track: vi.fn(async () => ({ videos: [
      { youtubeVideoId: 'v1', title: 'one', publishedAt: '2026-10-01T00:00:00Z', capturedAt: capturedAt.toISOString(), viewCount: 220, likeCount: 10, commentCount: 1, subscriberCount: 100 },
      { youtubeVideoId: 'v2', title: 'two', publishedAt: '2026-10-01T00:00:00Z', capturedAt: capturedAt.toISOString(), viewCount: 130, likeCount: 1, commentCount: 0, subscriberCount: 100 },
    ], missingVideoIds: ['missing'] })) }
    const handlers = createJobHandlers({ store, youtube, clock: () => capturedAt })
    const result = await handlers.get('youtube.track')({ id: 'job-track', payload: { source_id: 'source-1', requested_day: '2026-10-09' } })
    expect(store.markTrackingMissing).toHaveBeenCalledWith(['t3'])
    expect(store.persistTrackingSnapshots).toHaveBeenCalledWith(expect.objectContaining({ videos: [expect.objectContaining({ youtubeVideoId: 'v1' })] }))
    const persisted = store.persistTrackingRun.mock.calls[0][0]
    expect(persisted.opportunities[0]).toMatchObject({ scoreVersion: 'youtube-tracking-v1', velocityMode: 'observed_delta' })
    expect(persisted.records.find(record => record.targetId === 't2').status).toBe('waiting_interval')
    expect(persisted.records.find(record => record.targetId === 't3').status).toBe('missing')
    expect(result).toMatchObject({ scored: 1, waiting: 1, missing: 1 })
  })

  it('keeps returned videos without scoreable statistics out of tracking snapshots and scores', async () => {
    const targets = [{
      targetId: 't1', sourceQueryId: 'q1', sourceItemId: 'i1', youtubeVideoId: 'v1',
      buyerIntent: 90, commerceFit: 95,
      previousSnapshot: { id: 's1', viewCount: 100, capturedAt: '2026-10-06T00:00:00Z' },
    }]
    const store = {
      listTrackingCandidates: vi.fn(async () => targets), markTrackingMissing: vi.fn(async () => 0),
      markTrackingSeen: vi.fn(async () => 1), startTrackingRun: vi.fn(async () => 'tracking-run'),
      persistTrackingSnapshots: vi.fn(async () => new Map()), persistTrackingRun: vi.fn(async () => {}),
    }
    const youtube = { track: vi.fn(async () => ({
      videos: [{ youtubeVideoId: 'v1', title: 'one', publishedAt: '2026-10-01T00:00:00Z', capturedAt: capturedAt.toISOString(), viewCount: null }],
      missingVideoIds: [],
    })) }
    const handler = createJobHandlers({ store, youtube, clock: () => capturedAt }).get('youtube.track')
    await handler({ id: 'job-track', payload: { source_id: 'source-1', requested_day: '2026-10-09' } })
    expect(store.persistTrackingSnapshots).toHaveBeenCalledWith(expect.objectContaining({ videos: [] }))
    const persisted = store.persistTrackingRun.mock.calls[0][0]
    expect(persisted.records[0].status).toBe('unscored')
    expect(persisted.opportunities).toEqual([])
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

  it('runs AI analysis as a separate interpretation job without touching scoring', async () => {
    const store = {
      getAnalysisRequest: vi.fn(async () => ({ id: 'request-1', inputSnapshot: { analysis_basis: 'metadata_only' } })),
      markAnalysisRunning: vi.fn(async () => {}), persistAnalysisSuccess: vi.fn(async () => {}), persistAnalysisFailure: vi.fn(async () => {}),
    }
    const analyst = { analyze: vi.fn(async () => ({ analysis: { recommendation: 'hold' }, resolvedModel: 'gpt-test', responseId: 'resp-1', usage: {} })) }
    const handler = createJobHandlers({ store, youtube: {}, analyst }).get('opportunity.analyze')
    await expect(handler({ id: 'job-ai', payload: { analysis_request_id: 'request-1' } })).resolves.toEqual({ analysisRequestId: 'request-1', recommendation: 'hold' })
    expect(analyst.analyze).toHaveBeenCalledWith({ analysis_basis: 'metadata_only' })
    expect(store.persistAnalysisSuccess).toHaveBeenCalledOnce()
  })

  it('submits, persists, polls, and completes one provider-neutral video scene', async () => {
    const scene = { id: 'generation-1', runId: 'run-1', provider: 'pollo', providerVersion: 'platform-v1', requestedModel: 'pollo-v2', providerTaskId: null, promptSnapshot: '[背景のみ] 朝の机', durationSeconds: 5, aspectRatio: '9:16', resolution: '480p', attemptNumber: 1, status: 'queued' }
    const store = {
      getVideoGenerationScene: vi.fn(async () => scene), markVideoGenerationSubmitting: vi.fn(async () => {}),
      markVideoGenerationPollingResume: vi.fn(async () => {}), persistVideoGenerationPollingInterrupted: vi.fn(async () => {}),
      persistVideoGenerationTask: vi.fn(async () => {}), persistVideoGenerationPolling: vi.fn(async () => {}),
      persistVideoGenerationSuccess: vi.fn(async () => {}), persistVideoGenerationFailure: vi.fn(async () => {}),
    }
    const videoGenerationProvider = {
      id: 'pollo', version: 'platform-v1', model: 'pollo-v2',
      submitScene: vi.fn(async () => ({ providerTaskId: 'task-1', status: 'polling', providerTaskStatus: 'pending' })),
      getTaskStatus: vi.fn()
        .mockResolvedValueOnce({ status: 'polling', providerTaskStatus: 'processing', providerCost: null, costProvenance: 'unavailable' })
        .mockResolvedValueOnce({ status: 'succeeded', providerTaskStatus: 'succeeded', providerCost: 0.12, costCurrency: 'USD', costProvenance: 'actual', outputUrl: 'https://cdn.example/video.mp4' }),
      normalizeResult: vi.fn(), normalizeError: vi.fn(error => error),
    }
    const sleep = vi.fn(async () => {})
    const handler = createJobHandlers({ store, youtube: {}, videoGenerationProvider, sleep, videoPollAttempts: 2, videoPollIntervalMs: 250 }).get('video.generate.scene')
    await expect(handler({ id: 'job-video', payload: { video_generation_scene_id: 'generation-1' } })).resolves.toEqual({ videoGenerationSceneId: 'generation-1', status: 'succeeded', attemptNumber: 1 })
    expect(videoGenerationProvider.submitScene).toHaveBeenCalledWith({ prompt: scene.promptSnapshot, durationSeconds: 5, aspectRatio: '9:16', resolution: '480p' })
    expect(store.persistVideoGenerationTask).toHaveBeenCalledBefore(store.persistVideoGenerationPolling)
    expect(store.persistVideoGenerationSuccess).toHaveBeenCalledWith(scene, expect.objectContaining({ costProvenance: 'actual', providerCost: 0.12 }))
    expect(sleep).toHaveBeenCalledWith(250)
  })

  it('resumes polling from a persisted provider task without submitting again', async () => {
    const scene = { id: 'generation-2', runId: 'run-2', provider: 'pollo', providerVersion: 'platform-v1', requestedModel: 'pollo-v2', providerTaskId: 'task-existing', promptSnapshot: 'prompt', durationSeconds: 5, aspectRatio: '9:16', resolution: '480p', attemptNumber: 2, status: 'polling' }
    const store = {
      getVideoGenerationScene: vi.fn(async () => scene), markVideoGenerationSubmitting: vi.fn(async () => {}),
      markVideoGenerationPollingResume: vi.fn(async () => {}), persistVideoGenerationPollingInterrupted: vi.fn(async () => {}),
      persistVideoGenerationTask: vi.fn(async () => {}), persistVideoGenerationPolling: vi.fn(async () => {}),
      persistVideoGenerationSuccess: vi.fn(async () => {}), persistVideoGenerationFailure: vi.fn(async () => {}),
    }
    const videoGenerationProvider = {
      id: 'pollo', version: 'platform-v1', model: 'pollo-v2', submitScene: vi.fn(),
      getTaskStatus: vi.fn(async () => ({ status: 'succeeded', providerTaskStatus: 'succeeded', providerCost: null, costCurrency: null, costProvenance: 'unavailable', outputUrl: 'https://cdn.example/resumed.mp4' })),
      normalizeResult: vi.fn(), normalizeError: vi.fn(error => error),
    }
    const handler = createJobHandlers({ store, youtube: {}, videoGenerationProvider, videoPollAttempts: 1 }).get('video.generate.scene')
    await expect(handler({ payload: { video_generation_scene_id: scene.id } })).resolves.toMatchObject({ status: 'succeeded', attemptNumber: 2 })
    expect(videoGenerationProvider.submitScene).not.toHaveBeenCalled()
    expect(videoGenerationProvider.getTaskStatus).toHaveBeenCalledWith('task-existing')
    expect(store.markVideoGenerationPollingResume).toHaveBeenCalledWith(scene)
    expect(store.markVideoGenerationSubmitting).not.toHaveBeenCalled()
  })

  it('keeps a provider task polling and defers the job instead of terminally failing on timeout', async () => {
    const scene = { id: 'generation-timeout', runId: 'run-timeout', provider: 'pollo', providerVersion: 'platform-v1', requestedModel: 'pollo-v2', providerTaskId: 'task-paid', providerTaskStatus: 'waiting', promptSnapshot: 'prompt', durationSeconds: 5, aspectRatio: '9:16', resolution: '480p', attemptNumber: 1, status: 'polling' }
    const store = {
      getVideoGenerationScene: vi.fn(async () => scene), markVideoGenerationSubmitting: vi.fn(async () => {}),
      markVideoGenerationPollingResume: vi.fn(async () => {}), persistVideoGenerationTask: vi.fn(async () => {}),
      persistVideoGenerationPolling: vi.fn(async () => {}), persistVideoGenerationPollingInterrupted: vi.fn(async () => {}),
      persistVideoGenerationSuccess: vi.fn(async () => {}), persistVideoGenerationFailure: vi.fn(async () => {}),
    }
    const videoGenerationProvider = {
      id: 'pollo', version: 'platform-v1', model: 'pollo-v2', submitScene: vi.fn(),
      getTaskStatus: vi.fn(async () => ({ status: 'polling', providerTaskStatus: 'waiting', providerCost: null, costProvenance: 'unavailable' })),
      normalizeResult: vi.fn(), normalizeError: vi.fn(error => error),
    }
    const handler = createJobHandlers({ store, youtube: {}, videoGenerationProvider, sleep: vi.fn(async () => {}), videoPollAttempts: 2, videoPollIntervalMs: 250 }).get('video.generate.scene')
    await expect(handler({ payload: { video_generation_scene_id: scene.id } })).rejects.toMatchObject({
      code: 'VIDEO_GENERATION_POLL_TIMEOUT', deferJob: true,
    })
    expect(videoGenerationProvider.submitScene).not.toHaveBeenCalled()
    expect(videoGenerationProvider.getTaskStatus).toHaveBeenCalledTimes(2)
    expect(store.persistVideoGenerationPollingInterrupted).toHaveBeenCalledWith(scene, expect.objectContaining({ code: 'VIDEO_GENERATION_POLL_TIMEOUT' }))
    expect(store.persistVideoGenerationFailure).not.toHaveBeenCalled()
  })

  it('marks only an explicit provider generation failure as terminal', async () => {
    const scene = { id: 'generation-failed', runId: 'run-failed', provider: 'pollo', providerVersion: 'platform-v1', requestedModel: 'pollo-v2', providerTaskId: 'task-failed', providerTaskStatus: 'processing', promptSnapshot: 'prompt', durationSeconds: 5, aspectRatio: '9:16', resolution: '480p', attemptNumber: 1, status: 'polling' }
    const store = {
      getVideoGenerationScene: vi.fn(async () => scene), markVideoGenerationSubmitting: vi.fn(async () => {}),
      markVideoGenerationPollingResume: vi.fn(async () => {}), persistVideoGenerationTask: vi.fn(async () => {}),
      persistVideoGenerationPolling: vi.fn(async () => {}), persistVideoGenerationPollingInterrupted: vi.fn(async () => {}),
      persistVideoGenerationSuccess: vi.fn(async () => {}), persistVideoGenerationFailure: vi.fn(async () => {}),
    }
    const videoGenerationProvider = {
      id: 'pollo', version: 'platform-v1', model: 'pollo-v2', submitScene: vi.fn(),
      getTaskStatus: vi.fn(async () => ({ status: 'failed', providerTaskStatus: 'failed', safeErrorCode: 'POLLO_GENERATION_FAILED' })),
      normalizeResult: vi.fn(), normalizeError: vi.fn(error => error),
    }
    const handler = createJobHandlers({ store, youtube: {}, videoGenerationProvider, videoPollAttempts: 1 }).get('video.generate.scene')
    await expect(handler({ payload: { video_generation_scene_id: scene.id } })).rejects.toMatchObject({ code: 'POLLO_GENERATION_FAILED' })
    expect(store.persistVideoGenerationFailure).toHaveBeenCalledWith(scene, expect.objectContaining({ code: 'POLLO_GENERATION_FAILED' }))
    expect(store.persistVideoGenerationPollingInterrupted).not.toHaveBeenCalled()
    expect(videoGenerationProvider.submitScene).not.toHaveBeenCalled()
  })

  it('searches one product analysis sequentially and persists deterministic candidates', async () => {
    const store = {
      getProductSearchRun: vi.fn(async () => ({ id: 'product-run', provider: 'rakuten-ichiba', providerApiVersion: '20260701', inputSnapshot: { keywords: ['便利グッズ', '収納'], hits_per_keyword: 10 } })),
      markProductSearchRunning: vi.fn(async () => {}), persistProductSearchSuccess: vi.fn(async () => {}), persistProductSearchFailure: vi.fn(async () => {}),
    }
    const productProvider = { id: 'rakuten-ichiba', apiVersion: '20260701', search: vi.fn(async ({ keyword }) => ({
      apiVersion: '20260701', fetchedAt: capturedAt.toISOString(), requestMetadata: { availability: 1 },
      items: [{ providerProductId: 'shop:1', title: `便利グッズ ${keyword}`, catchcopy: '', reviewCount: 10, reviewAverage: 4, affiliateRate: 1 }],
    })) }
    const sleep = vi.fn(async () => {})
    const handler = createJobHandlers({ store, youtube: {}, productProvider, sleep }).get('product.search')
    await expect(handler({ id: 'job-product', payload: { product_search_run_id: 'product-run' } })).resolves.toMatchObject({ candidates: 1, received: 2 })
    expect(productProvider.search).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1000)
    expect(store.persistProductSearchSuccess.mock.calls[0][2][0]).toMatchObject({ scoreVersion: 'product-rakuten-v1', matchedKeywordCount: 2 })
  })

  it('backs off only retryable product-provider failures', async () => {
    const store = {
      getProductSearchRun: vi.fn(async () => ({ id: 'run', provider: 'rakuten-ichiba', providerApiVersion: '20260701', inputSnapshot: { keywords: ['便利'], hits_per_keyword: 10 } })),
      markProductSearchRunning: vi.fn(async () => {}), persistProductSearchSuccess: vi.fn(async () => {}), persistProductSearchFailure: vi.fn(async () => {}),
    }
    const search = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('limited'), { code: 'RATE_LIMITED' }))
      .mockResolvedValue({ apiVersion: '20260701', fetchedAt: capturedAt.toISOString(), requestMetadata: {}, items: [] })
    const sleep = vi.fn(async () => {})
    const handler = createJobHandlers({ store, youtube: {}, productProvider: { id: 'rakuten-ichiba', apiVersion: '20260701', search }, sleep }).get('product.search')
    await handler({ id: 'job', payload: { product_search_run_id: 'run' } })
    expect(search).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1000)
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
  it('recovers timed-out provider polling once and defers retryable jobs without finishing them', async () => {
    const deferred = Object.assign(new Error('still waiting'), { code: 'VIDEO_GENERATION_POLL_TIMEOUT', deferJob: true, retryAfterSeconds: 30 })
    const store = {
      recoverTimedOutVideoGenerations: vi.fn(async () => 1),
      claimNext: vi.fn(async () => ({ id: 'job-video', jobType: 'video.generate.scene', payload: {}, attempts: 2 })),
      deferJob: vi.fn(async () => {}), finishJob: vi.fn(async () => {}),
    }
    const worker = createLocalWorker({ store, handlers: new Map([['video.generate.scene', vi.fn(async () => { throw deferred })]]), workerId: 'worker-test' })
    await expect(worker.runOne()).resolves.toMatchObject({ deferred: true, errorCode: 'VIDEO_GENERATION_POLL_TIMEOUT' })
    expect(store.recoverTimedOutVideoGenerations).toHaveBeenCalledTimes(1)
    expect(store.deferJob).toHaveBeenCalledWith('job-video', 'worker-test', expect.objectContaining({ attempts: 2, retryAfterSeconds: 30 }))
    expect(store.finishJob).not.toHaveBeenCalled()
  })
})
