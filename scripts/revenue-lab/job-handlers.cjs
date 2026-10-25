'use strict'

const { scoreYouTubePopulation, scoreYouTubeTrackingPopulation } = require('./scoring.cjs')
const { rankProductCandidates } = require('./product-ranking.cjs')
const { createImageToVideoRequest } = require('./image-to-video-request.cjs')
const { isDirectProductRegistrationPlaceholder } = require('./direct-product-contract.cjs')
const { createHash } = require('node:crypto')
const { SAFE_VALIDATION_REASONS } = require('./multi-product-shorts-v2-schema.cjs')
const { SAFE_REASONS: SAFE_V5_VALIDATION_REASONS } = require('./multi-product-shorts-v2-schema-v5.cjs')

class RevenueJobError extends Error {
  constructor(code, message, { safeDiagnostics = null } = {}) {
    super(message); this.name = 'RevenueJobError'; this.code = code; this.safeDiagnostics = safeDiagnostics
  }
}

const THREE_PICKS_IDENTITY_REASONS = new Set([
  'identity anchor is not grounded in source product name',
  'display name must not copy the formal product title',
  'identity anchor has no distinctive category token',
  'no compatible identity token found',
])

function safeThreePicksDiagnostics(error) {
  const diagnostics = error?.safeDiagnostics
  const productIndex = Number(diagnostics?.product_index)
  const fieldPath = diagnostics?.field_path
  const reason = diagnostics?.reason
  const fieldMatch = typeof fieldPath === 'string' && fieldPath.match(/^\$\.product_presentations\[([0-2])\](?:\.(?:product_set_item_id|presentation_order|display_name|short_appeal|fact_badge|tts|verified_fact_ref|identity_anchor|identity_id|fact_id|evidence_candidate_ids|evidence_anchors|short_appeal_evidence_ids|tts_evidence_ids))?$/u)
  const globalField = typeof fieldPath === 'string' && /^(?:\$\.(?:theme|hook(?:\.(?:display_text|tts))?|cta(?:\.(?:display_text|tts))?|product_presentations)|\$input\.products)$/u.test(fieldPath)
  const expectedReason = SAFE_VALIDATION_REASONS[error?.code] || SAFE_V5_VALIDATION_REASONS[error?.code]
  const validIdentity = error?.code === 'THREE_PICKS_V2_IDENTITY_CHANGED' && THREE_PICKS_IDENTITY_REASONS.has(reason)
  if ((!expectedReason || reason !== expectedReason) && !validIdentity) return null
  if (!fieldMatch && !globalField) return null
  const expectedProductIndex = fieldMatch ? Number(fieldMatch[1]) + 1 : null
  if (expectedProductIndex == null ? diagnostics?.product_index != null
    : !Number.isInteger(productIndex) || productIndex !== expectedProductIndex) return null
  const preview = typeof diagnostics?.field_value_preview === 'string'
    ? Array.from(diagnostics.field_value_preview.replace(/[\u0000-\u001f\u007f;]/gu, ' ').trim()).slice(0, 100).join('')
    : ''
  const candidateIds = [...new Set((Array.isArray(diagnostics?.evidence_candidate_ids)
    ? diagnostics.evidence_candidate_ids : []).filter(candidateId => /^[A-Za-z0-9_.:-]{1,160}$/u.test(candidateId)))].slice(0, 3)
  return { code: error.code, product_index: expectedProductIndex, field_path: fieldPath, reason,
    ...(preview ? { field_value_preview: preview } : {}),
    ...(candidateIds.length > 0 ? { evidence_candidate_ids: candidateIds } : {}) }
}

const SAFE_PROVIDER_REASONS = new Set([
  'response schema contains an unsupported keyword',
  'provider rejected the planning request',
])

function safeThreePicksProviderDiagnostics(error) {
  const diagnostics = error?.safeDiagnostics
  if (error?.code !== 'OPENAI_HTTP_ERROR' || diagnostics?.code !== 'OPENAI_HTTP_ERROR'
    || !Number.isInteger(diagnostics?.http_status) || diagnostics.http_status < 400 || diagnostics.http_status > 599
    || !SAFE_PROVIDER_REASONS.has(diagnostics?.reason)) return null
  const providerErrorCode = typeof diagnostics.provider_error_code === 'string'
    && /^[A-Za-z0-9_.:-]{1,80}$/u.test(diagnostics.provider_error_code) ? diagnostics.provider_error_code : null
  const providerErrorType = typeof diagnostics.provider_error_type === 'string'
    && /^[A-Za-z0-9_.:-]{1,80}$/u.test(diagnostics.provider_error_type) ? diagnostics.provider_error_type : null
  return { code: 'OPENAI_HTTP_ERROR', http_status: diagnostics.http_status,
    ...(providerErrorCode ? { provider_error_code: providerErrorCode } : {}),
    ...(providerErrorType ? { provider_error_type: providerErrorType } : {}),
    reason: diagnostics.reason }
}

function createJobHandlers({ store, youtube, analyst, creativeProducer, multiProductShortsPlanner,
  multiProductShortsV2Planner,
  finalCompositionProvider, finalCompositionV2Provider, compositionBlobStore, videoGenerationProvider,
  imageToVideoProvider, productAssetBlobStore, creativeAudioBlobStore, textToSpeechProvider,
  audioDurationProbe, productProvider, clock = () => new Date(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), videoPollAttempts = 30, videoPollIntervalMs = 5000 } = {}) {
  if (!store || !youtube) throw new TypeError('store and youtube are required')

  async function collectYouTube(job) {
    const queryId = job?.payload?.source_query_id
    if (!queryId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'source_query_id is required')
    const query = await store.getQuery(queryId)
    if (!query) throw new RevenueJobError('QUERY_NOT_FOUND', 'Source query was not found')
    if (!query.enabled) throw new RevenueJobError('QUERY_DISABLED', 'Source query is disabled')
    const capturedAt = clock().toISOString()
    const runId = await store.startRun(query.id, job.id, capturedAt)
    try {
      const videos = await youtube.collect({
        queryText: query.queryText,
        maxResults: Math.min(query.maxResults, 25),
        lookbackDays: 7,
        regionCode: 'JP',
        relevanceLanguage: 'ja',
        capturedAt,
      })
      const previous = await store.previousVideoSnapshots(query.sourceId, videos.map(video => video.youtubeVideoId))
      const population = videos.map(video => ({ ...video, previousSnapshot: previous.get(video.youtubeVideoId) || null }))
      const scored = scoreYouTubePopulation(population, { buyerIntent: query.buyerIntent, commerceFit: query.commerceFit })
      await store.persistCollection({
        runId,
        jobId: job.id,
        query,
        videos,
        opportunities: scored.opportunities,
        excludedReason: scored.excludedReason,
      })
      return { runId, received: videos.length, scored: scored.opportunities.length, excludedReason: scored.excludedReason }
    } catch (error) {
      console.error('[revenue-lab] YouTube collection failed', { jobId: job.id, queryId, code: error?.code || 'COLLECTION_FAILED' })
      try { await store.failRun(runId, error) }
      catch { console.error('[revenue-lab] Collection run failure state could not be persisted', { runId }) }
      throw error instanceof RevenueJobError ? error : new RevenueJobError(error?.code || 'COLLECTION_FAILED', 'YouTube collection failed')
    }
  }

  async function trackYouTube(job) {
    const sourceId = job?.payload?.source_id
    const requestedDay = job?.payload?.requested_day
    if (!sourceId || !requestedDay) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'source_id and requested_day are required')
    const capturedAt = clock().toISOString()
    const targets = await store.listTrackingCandidates(sourceId, requestedDay, capturedAt)
    if (!targets.length) return { received: 0, scored: 0, waiting: 0, missing: 0, runs: 0 }
    const startedRunIds = []
    try {
      const ids = [...new Set(targets.map(target => target.youtubeVideoId))]
      const result = await youtube.track(ids, capturedAt)
      const videoById = new Map(result.videos.map(video => [video.youtubeVideoId, video]))
      const missingIds = new Set(result.missingVideoIds)
      const missingTargets = targets.filter(target => missingIds.has(target.youtubeVideoId))
      const seenTargets = targets.filter(target => videoById.has(target.youtubeVideoId))
      await store.markTrackingMissing(missingTargets.map(target => target.targetId))
      await store.markTrackingSeen(seenTargets.map(target => target.targetId), capturedAt)

      const eligibleTargets = seenTargets.filter(target => {
        const video = videoById.get(target.youtubeVideoId)
        if (!target.previousSnapshot?.capturedAt || target.previousSnapshot.viewCount == null) return false
        if (video?.viewCount == null || !Number.isFinite(Date.parse(video.publishedAt))) return false
        return (Date.parse(capturedAt) - Date.parse(target.previousSnapshot.capturedAt)) / 3_600_000 >= 6
      })
      const eligibleIds = new Set(eligibleTargets.map(target => target.youtubeVideoId))
      const snapshots = await store.persistTrackingSnapshots({
        sourceId, jobId: job.id, videos: result.videos.filter(video => eligibleIds.has(video.youtubeVideoId)),
      })
      const groups = new Map()
      for (const target of targets) {
        const group = groups.get(target.sourceQueryId) || []
        group.push(target)
        groups.set(target.sourceQueryId, group)
      }
      let scoredCount = 0
      let waitingCount = 0
      for (const [queryId, queryTargets] of groups) {
        const runId = await store.startTrackingRun(queryId, job.id, requestedDay, capturedAt, queryTargets.length)
        startedRunIds.push(runId)
        const scoreInputs = []
        const records = []
        for (const target of queryTargets) {
          const video = videoById.get(target.youtubeVideoId)
          const previous = target.previousSnapshot
          if (!video) {
            records.push({
              targetId: target.targetId, sourceItemId: target.sourceItemId, previousSnapshotId: previous?.id || null,
              currentSnapshotId: null, status: 'missing', previousViewCount: previous?.viewCount ?? null,
              currentViewCount: null, viewDelta: null, elapsedHours: null, viewsVelocity: null,
              growthRatio: null, growthPercent: null,
            })
            continue
          }
          if (video.viewCount == null || !Number.isFinite(Date.parse(video.publishedAt)) || previous?.viewCount == null) {
            records.push({
              targetId: target.targetId, sourceItemId: target.sourceItemId, previousSnapshotId: previous?.id || null,
              currentSnapshotId: null, status: 'unscored', previousViewCount: previous?.viewCount ?? null,
              currentViewCount: video.viewCount, viewDelta: null, elapsedHours: null, viewsVelocity: null,
              growthRatio: null, growthPercent: null,
            })
            continue
          }
          const elapsedHours = previous?.capturedAt
            ? (Date.parse(capturedAt) - Date.parse(previous.capturedAt)) / 3_600_000 : null
          if (!previous || !Number.isFinite(elapsedHours) || elapsedHours < 6) {
            waitingCount += 1
            records.push({
              targetId: target.targetId, sourceItemId: target.sourceItemId, previousSnapshotId: previous?.id || null,
              currentSnapshotId: null, status: 'waiting_interval', previousViewCount: previous?.viewCount ?? null,
              currentViewCount: video.viewCount, viewDelta: null, elapsedHours: elapsedHours == null ? null : Math.max(elapsedHours, 0),
              viewsVelocity: null, growthRatio: null, growthPercent: null,
            })
            continue
          }
          const viewDelta = Math.max((video.viewCount ?? 0) - previous.viewCount, 0)
          const growthRatio = previous.viewCount > 0 ? video.viewCount / previous.viewCount : null
          const growthPercent = previous.viewCount > 0 ? viewDelta / previous.viewCount * 100 : null
          scoreInputs.push({ ...video, previousSnapshot: previous, sourceItemId: target.sourceItemId })
          records.push({
            targetId: target.targetId, sourceItemId: target.sourceItemId, previousSnapshotId: previous.id,
            currentSnapshotId: snapshots.get(target.sourceItemId), status: 'scored', previousViewCount: previous.viewCount,
            currentViewCount: video.viewCount, viewDelta, elapsedHours, viewsVelocity: viewDelta / elapsedHours,
            growthRatio, growthPercent,
          })
        }
        const first = queryTargets[0]
        const scored = scoreYouTubeTrackingPopulation(scoreInputs, {
          buyerIntent: first.buyerIntent, commerceFit: first.commerceFit,
        })
        const sourceItemByVideo = new Map(scoreInputs.map(video => [video.youtubeVideoId, video.sourceItemId]))
        const opportunities = scored.opportunities.map(item => ({ ...item, sourceItemId: sourceItemByVideo.get(item.youtubeVideoId) }))
        scoredCount += opportunities.length
        await store.persistTrackingRun({ runId, queryId, records, opportunities })
      }
      return {
        received: result.videos.length, scored: scoredCount, waiting: waitingCount,
        missing: missingTargets.length, runs: groups.size,
      }
    } catch (error) {
      console.error('[revenue-lab] YouTube tracking failed', { jobId: job.id, sourceId, code: error?.code || 'TRACKING_FAILED' })
      try { await store.failTrackingRuns(startedRunIds, error) }
      catch { console.error('[revenue-lab] Tracking run failure state could not be persisted', { jobId: job.id }) }
      throw error instanceof RevenueJobError ? error : new RevenueJobError(error?.code || 'TRACKING_FAILED', 'YouTube tracking failed')
    }
  }

  async function analyzeOpportunity(job) {
    const requestId = job?.payload?.analysis_request_id
    if (!requestId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'analysis_request_id is required')
    if (!analyst) throw new RevenueJobError('OPENAI_NOT_CONFIGURED', 'OpenAI analysis is not configured')
    const request = await store.getAnalysisRequest(requestId)
    if (!request) throw new RevenueJobError('ANALYSIS_REQUEST_NOT_FOUND', 'Analysis request was not found')
    await store.markAnalysisRunning(requestId)
    try {
      const result = await analyst.analyze(request.inputSnapshot)
      await store.persistAnalysisSuccess(requestId, result)
      return { analysisRequestId: requestId, recommendation: result.analysis.recommendation }
    } catch (error) {
      try { await store.persistAnalysisFailure(requestId, error) }
      catch { console.error('[revenue-lab] Analysis failure state could not be persisted', { requestId }) }
      throw error instanceof RevenueJobError ? error : new RevenueJobError(error?.code || 'ANALYSIS_FAILED', 'Opportunity analysis failed')
    }
  }

  async function searchProducts(job) {
    const runId = job?.payload?.product_search_run_id
    if (!runId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'product_search_run_id is required')
    if (!productProvider) throw new RevenueJobError('RAKUTEN_NOT_CONFIGURED', 'Product catalog provider is not configured')
    const run = await store.getProductSearchRun(runId)
    if (!run) throw new RevenueJobError('PRODUCT_SEARCH_RUN_NOT_FOUND', 'Product search run was not found')
    if (run.provider !== productProvider.id || run.providerApiVersion !== productProvider.apiVersion) {
      throw new RevenueJobError('PRODUCT_PROVIDER_MISMATCH', 'Product provider does not match the saved run')
    }
    await store.markProductSearchRunning(runId)
    try {
      const providerSearch = async options => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try { return await productProvider.search(options) }
          catch (error) {
            if (!['RATE_LIMITED', 'PROVIDER_UNAVAILABLE'].includes(error?.code) || attempt === 2) throw error
            await sleep(1_000 * (2 ** attempt))
          }
        }
        throw new RevenueJobError('PRODUCT_SEARCH_FAILED', 'Product candidate search failed')
      }
      const searches = []
      for (const [index, keyword] of run.inputSnapshot.keywords.entries()) {
        if (index > 0) await sleep(1_000)
        const result = await providerSearch({ keyword, limit: run.inputSnapshot.hits_per_keyword })
        searches.push({ keyword, requestedHits: run.inputSnapshot.hits_per_keyword, result })
      }
      const recordsByProduct = new Map()
      searches.forEach(search => search.result.items.forEach((product, index) => {
        const record = recordsByProduct.get(product.providerProductId) || { product, matches: [] }
        record.matches.push({ keyword: search.keyword, position: index + 1, resultCount: search.result.items.length })
        recordsByProduct.set(product.providerProductId, record)
      }))
      const ranked = rankProductCandidates([...recordsByProduct.values()], run.inputSnapshot.keywords)
      await store.persistProductSearchSuccess(runId, searches, ranked)
      return { productSearchRunId: runId, received: searches.reduce((sum, search) => sum + search.result.items.length, 0), candidates: ranked.length }
    } catch (error) {
      try { await store.persistProductSearchFailure(runId, error) }
      catch { console.error('[revenue-lab] Product search failure state could not be persisted', { runId }) }
      throw error instanceof RevenueJobError ? error : new RevenueJobError(error?.code || 'PRODUCT_SEARCH_FAILED', 'Product candidate search failed')
    }
  }

  async function createProductionPlan(job) {
    const requestId = job?.payload?.creative_production_request_id
    if (!requestId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'creative_production_request_id is required')
    if (!creativeProducer) throw new RevenueJobError('OPENAI_NOT_CONFIGURED', 'Creative Production is not configured')
    const request = await store.getCreativeProductionRequest(requestId)
    if (!request) throw new RevenueJobError('CREATIVE_PRODUCTION_REQUEST_NOT_FOUND', 'Creative Production request was not found')
    if (isDirectProductRegistrationPlaceholder(request.inputSnapshot?.iteration)) {
      const error = new RevenueJobError('CREATIVE_PRODUCTION_REGISTRATION_ONLY', 'Direct Product registration placeholders cannot be planned')
      try { await store.persistCreativeProductionFailure(requestId, error) }
      catch { console.error('[revenue-lab] Creative Production placeholder rejection could not be persisted', { requestId }) }
      throw error
    }
    await store.markCreativeProductionRunning(requestId)
    let storeAttempted = false
    let storeSaved = false
    try {
      const result = await creativeProducer.plan(request.inputSnapshot)
      storeAttempted = true
      await store.persistCreativeProductionSuccess(request, result)
      storeSaved = true
      return { creativeProductionRequestId: requestId, revisionNumber: request.revisionNumber }
    } catch (error) {
      const diagnostic = error?.safeDiagnostics || null
      console.error('[revenue-lab] Creative Production planner failed', {
        requestId,
        promptVersion: diagnostic?.promptVersion || request.promptVersion || null,
        schemaVersion: diagnostic?.schemaVersion || request.schemaVersion || request.inputSnapshot?.contract?.schema_version || null,
        route: diagnostic?.route || null,
        openaiHttpStatus: diagnostic?.openaiHttpStatus ?? error?.status ?? null,
        responseJsonParsed: diagnostic?.responseJsonParsed ?? null,
        structuredOutputSchemaValidated: diagnostic?.structuredOutputSchemaValidated ?? null,
        deterministicValidatorValidated: diagnostic?.deterministicValidatorValidated ?? null,
        validatorRuleId: diagnostic?.validatorRuleId || error?.ruleId || null,
        validatorFieldPath: diagnostic?.validatorFieldPath || error?.fieldPath || null,
        storeStage: storeSaved ? 'after_store' : storeAttempted ? 'store_save_failed' : 'before_store',
        originalSafeErrorCode: error?.code || 'CREATIVE_PRODUCTION_FAILED',
      })
      try { await store.persistCreativeProductionFailure(requestId, error) }
      catch { console.error('[revenue-lab] Creative Production failure state could not be persisted', { requestId }) }
      throw error instanceof RevenueJobError ? error : new RevenueJobError(error?.code || 'CREATIVE_PRODUCTION_FAILED', 'Creative Production failed')
    }
  }

  async function generateVideoScene(job) {
    const sceneId = job?.payload?.video_generation_scene_id
    if (!sceneId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'video_generation_scene_id is required')
    const scene = await store.getVideoGenerationScene(sceneId)
    if (!scene) throw new RevenueJobError('VIDEO_GENERATION_SCENE_NOT_FOUND', 'Video generation scene was not found')
    const provider = scene.generationMode === 'image_to_video' ? imageToVideoProvider : videoGenerationProvider
    if (!provider) throw new RevenueJobError('POLLO_NOT_CONFIGURED', 'Video generation provider is not configured')
    if (scene.provider !== provider.id || scene.providerVersion !== provider.version
      || scene.requestedModel !== provider.model) {
      throw new RevenueJobError('VIDEO_GENERATION_PROVIDER_MISMATCH', 'Video generation provider configuration does not match the queued scene')
    }
    if (scene.status === 'succeeded') return { videoGenerationSceneId: sceneId, status: 'succeeded', attemptNumber: scene.attemptNumber }
    if (scene.submissionUncertain || scene.status === 'submission_uncertain') {
      throw new RevenueJobError('VIDEO_GENERATION_SUBMISSION_UNCERTAIN', 'The existing attempt requires human review before any new submit')
    }
    let providerTaskId = scene.providerTaskId
    try {
      if (!providerTaskId) {
        await store.markVideoGenerationSubmitting(scene)
        let providerRequest
        if (scene.generationMode === 'image_to_video') {
          if (!productAssetBlobStore || !scene.inputAssetSnapshot?.immutable_object_key) {
            throw Object.assign(new Error('Private Product Asset storage is unavailable'), { code: 'ASSET_STORAGE_NOT_CONFIGURED' })
          }
          const temporaryUrl = await productAssetBlobStore.createTemporaryReadUrl(scene.inputAssetSnapshot.immutable_object_key, 3600)
          providerRequest = createImageToVideoRequest({
            prompt: scene.promptSnapshot, negativePrompt: scene.negativePromptSnapshot,
            promptBuilderVersion: scene.promptBuilderVersion,
            inputImage: {
              temporaryUrl, revisionId: scene.inputAssetRevisionId,
              contentSha256: scene.inputAssetSnapshot.content_sha256,
              contentType: scene.inputAssetSnapshot.content_type,
              pixelWidth: Number(scene.inputAssetSnapshot.pixel_width),
              pixelHeight: Number(scene.inputAssetSnapshot.pixel_height),
            },
            durationSeconds: scene.durationSeconds, aspectRatio: scene.aspectRatio,
            resolution: scene.resolution, audioEnabled: false,
          }, provider.capabilityManifest)
        } else {
          providerRequest = { prompt: scene.promptSnapshot, durationSeconds: scene.durationSeconds,
            aspectRatio: scene.aspectRatio, resolution: scene.resolution }
        }
        const receipt = await provider.submitScene(providerRequest)
        providerTaskId = receipt.providerTaskId
        await store.persistVideoGenerationTask(sceneId, receipt)
      } else {
        await store.markVideoGenerationPollingResume(scene)
      }
      const attempts = Math.max(1, Math.min(Number(videoPollAttempts) || 30, 120))
      for (let index = 0; index < attempts; index += 1) {
        const result = await provider.getTaskStatus(providerTaskId)
        if (result.status === 'succeeded') {
          await store.persistVideoGenerationSuccess(scene, result)
          return { videoGenerationSceneId: sceneId, status: 'succeeded', attemptNumber: scene.attemptNumber }
        }
        if (result.status === 'failed') {
          const error = Object.assign(new Error('Video generation failed'), { code: result.safeErrorCode || 'VIDEO_GENERATION_FAILED' })
          await store.persistVideoGenerationFailure(scene, error)
          throw error
        }
        await store.persistVideoGenerationPolling(sceneId, result)
        if (index + 1 < attempts) await sleep(Math.max(250, Math.min(Number(videoPollIntervalMs) || 5000, 30000)))
      }
      throw Object.assign(new Error('Video generation polling remains pending'), {
        code: 'VIDEO_GENERATION_POLL_TIMEOUT', deferJob: true,
        retryAfterSeconds: Math.max(30, Math.ceil(Math.min(Number(videoPollIntervalMs) || 5000, 30000) / 1000)),
      })
    } catch (rawError) {
      if (providerTaskId && rawError?.code !== 'POLLO_GENERATION_FAILED' && rawError?.code !== 'VIDEO_GENERATION_FAILED') {
        const pendingError = rawError?.code === 'VIDEO_GENERATION_POLL_TIMEOUT'
          ? rawError : provider.normalizeError(rawError)
        await store.persistVideoGenerationPollingInterrupted(scene, pendingError)
        pendingError.deferJob = true
        pendingError.retryAfterSeconds = Math.max(30, Number(rawError?.retryAfterSeconds) || 30)
        throw pendingError
      }
      const normalized = /^VIDEO_GENERATION_/.test(rawError?.code || '') ? rawError : provider.normalizeError(rawError)
      if (scene.generationMode === 'image_to_video' && !providerTaskId
        && ['POLLO_TRANSPORT_ERROR', 'POLLO_INVALID_RESPONSE'].includes(normalized?.code)) {
        await store.persistVideoGenerationSubmissionUncertain(scene, Object.assign(normalized, { code: 'VIDEO_GENERATION_SUBMISSION_UNCERTAIN' }))
        throw new RevenueJobError('VIDEO_GENERATION_SUBMISSION_UNCERTAIN', 'Video generation submit outcome is uncertain')
      }
      const error = normalized
      if (rawError?.code !== 'VIDEO_GENERATION_FAILED' && rawError?.code !== 'POLLO_GENERATION_FAILED') {
        try { await store.persistVideoGenerationFailure(scene, error) }
        catch { console.error('[revenue-lab] Video generation failure state could not be persisted', { sceneId }) }
      }
      throw new RevenueJobError(error.code || 'VIDEO_GENERATION_FAILED', 'Video generation failed')
    }
  }

  async function createThreePicksPlan(job) {
    const requestId = job?.payload?.creative_archetype_request_id
    if (!requestId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'creative_archetype_request_id is required')
    const request = await store.getThreePicksRequest(requestId)
    if (!request) throw new RevenueJobError('THREE_PICKS_REQUEST_NOT_FOUND', 'Three Picks request was not found')
    const isV2 = request.archetype === 'three_picks_v2'
    const planner = isV2 ? multiProductShortsV2Planner : multiProductShortsPlanner
    if (!planner) throw new RevenueJobError('OPENAI_NOT_CONFIGURED', 'Three Picks planning is not configured')
    await store.markThreePicksRunning(requestId)
    try {
      const result = await planner.plan(request.inputSnapshot)
      const saved = isV2
        ? await store.persistThreePicksV2Success(request, result)
        : await store.persistThreePicksSuccess(request, result)
      return { creativeArchetypeRequestId: requestId, planId: saved.planId, revisionNumber: request.revisionNumber }
    } catch (error) {
      try { await store.persistThreePicksFailure(requestId, error) }
      catch { console.error('[revenue-lab] Three Picks failure state could not be persisted', { requestId }) }
      const safeDiagnostics = safeThreePicksDiagnostics(error) || safeThreePicksProviderDiagnostics(error)
      let message = 'Three Picks planning failed'
      if (safeDiagnostics?.code === 'OPENAI_HTTP_ERROR') {
        const codeSuffix = safeDiagnostics.provider_error_code
          ? `; provider_error_code=${safeDiagnostics.provider_error_code}` : ''
        const typeSuffix = safeDiagnostics.provider_error_type
          ? `; provider_error_type=${safeDiagnostics.provider_error_type}` : ''
        message = `Three Picks planning failed: provider; http_status=${safeDiagnostics.http_status}${codeSuffix}${typeSuffix}; reason=${safeDiagnostics.reason}`
      } else if (safeDiagnostics) {
        const base = `Three Picks planning failed: product ${safeDiagnostics.product_index}; ${safeDiagnostics.field_path}; ${safeDiagnostics.reason}`
        const candidateSuffix = safeDiagnostics.evidence_candidate_ids
          ? `; evidence_candidate_ids=${safeDiagnostics.evidence_candidate_ids.join(',')}` : ''
        const previewLabel = '; field_value_preview='
        const previewBudget = Math.max(0, 500 - Array.from(`${base}${candidateSuffix}${previewLabel}`).length)
        const preview = safeDiagnostics.field_value_preview
          ? Array.from(safeDiagnostics.field_value_preview).slice(0, previewBudget).join('') : ''
        message = `${base}${preview ? `${previewLabel}${preview}` : ''}${candidateSuffix}`
      }
      throw new RevenueJobError(error?.code || 'THREE_PICKS_PLAN_FAILED', message, { safeDiagnostics })
    }
  }

  async function composeFinalShort(job) {
    const requestId = job?.payload?.final_composition_request_id
    if (!requestId) throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'final_composition_request_id is required')
    const composition = await store.getFinalCompositionRequest(requestId)
    if (!composition) throw new RevenueJobError('COMPOSITION_REQUEST_NOT_FOUND', 'Final composition request was not found')
    const isV2 = composition.archetype === 'three_picks_v2'
    const provider = isV2 ? finalCompositionV2Provider : finalCompositionProvider
    if (!provider || !compositionBlobStore || !productAssetBlobStore || (isV2 && !creativeAudioBlobStore)) {
      throw new RevenueJobError('COMPOSITION_NOT_CONFIGURED', 'Local composition is not configured')
    }
    if (composition.provider !== provider.id || composition.providerVersion !== provider.version) {
      throw new RevenueJobError('COMPOSITION_PROVIDER_MISMATCH', 'Final composition provider does not match the request')
    }
    await store.markFinalCompositionRendering(requestId)
    try {
      const assets = new Map()
      for (const asset of composition.assets) {
        const bytes = await productAssetBlobStore.readImmutable(asset.immutableObjectKey)
        const digest = createHash('sha256').update(bytes).digest('hex')
        if (digest !== asset.contentSha256) throw new RevenueJobError('COMPOSITION_ASSET_HASH_MISMATCH', 'Product Asset bytes failed integrity verification')
        assets.set(asset.id, bytes)
      }
      const audioAssets = new Map()
      if (isV2) for (const artifact of composition.audioAssets) {
        const bytes = await creativeAudioBlobStore.readImmutable(artifact.immutableObjectKey)
        const digest = createHash('sha256').update(bytes).digest('hex')
        if (digest !== artifact.contentSha256) throw new RevenueJobError('COMPOSITION_AUDIO_HASH_MISMATCH', 'Creative Audio bytes failed integrity verification')
        audioAssets.set(artifact.id, bytes)
      }
      const rendered = await provider.render({ manifest: composition.renderManifest, assets, audioAssets })
      const contentSha256 = createHash('sha256').update(rendered.bytes).digest('hex')
      const immutableObjectKey = `shorts-outputs/${composition.campaignId}/${contentSha256}.mp4`
      await compositionBlobStore.putImmutable(immutableObjectKey, rendered.bytes)
      await store.persistFinalCompositionSuccess(composition, {
        storageProvider: compositionBlobStore.provider, storageBucket: compositionBlobStore.bucket,
        immutableObjectKey, contentSha256, byteSize: rendered.bytes.length,
        durationSeconds: rendered.durationSeconds, pixelWidth: rendered.pixelWidth,
        pixelHeight: rendered.pixelHeight, fps: rendered.fps,
      })
      return { finalCompositionRequestId: requestId, status: 'succeeded' }
    } catch (rawError) {
      const error = provider.normalizeError(rawError)
      try { await store.persistFinalCompositionFailure(requestId, error) }
      catch { console.error('[revenue-lab] Composition failure state could not be persisted', { requestId }) }
      throw new RevenueJobError(error.code || 'COMPOSITION_FAILED', 'Final composition failed')
    }
  }

  async function generateCreativeAudio(job) {
    const artifactId = job?.payload?.creative_audio_artifact_id
    const generationFingerprint = job?.payload?.generation_fingerprint
    if (!artifactId || !/^[0-9a-f]{64}$/.test(String(generationFingerprint || ''))) {
      throw new RevenueJobError('INVALID_JOB_PAYLOAD', 'Creative Audio artifact ID and fingerprint are required')
    }
    if (!textToSpeechProvider || !creativeAudioBlobStore || typeof audioDurationProbe !== 'function') {
      throw new RevenueJobError('TTS_NOT_CONFIGURED', 'ElevenLabs TTS generation is not configured')
    }
    const claim = await store.claimCreativeAudioGeneration(artifactId, generationFingerprint)
    const artifact = claim.artifact
    if (!artifact) throw new RevenueJobError('CREATIVE_AUDIO_ARTIFACT_NOT_FOUND', 'Creative Audio Artifact was not found')
    if (artifact.generationFingerprint !== generationFingerprint
      || artifact.provider !== textToSpeechProvider.id
      || artifact.providerAdapterVersion !== textToSpeechProvider.version
      || artifact.model !== textToSpeechProvider.model || artifact.voice !== textToSpeechProvider.voice
      || artifact.outputFormat !== textToSpeechProvider.outputFormat
      || artifact.storageBucket !== creativeAudioBlobStore.bucket) {
      if (claim.claimed) await store.failCreativeAudioGeneration(artifactId, generationFingerprint, {
        status: 'failed', safeErrorCode: 'TTS_CONFIGURATION_MISMATCH',
      })
      throw new RevenueJobError('TTS_CONFIGURATION_MISMATCH', 'Creative Audio configuration does not match the claimed artifact')
    }
    if (!claim.claimed && artifact.status !== 'generating') {
      return { creativeAudioArtifactId: artifactId, status: artifact.status, providerCalled: false }
    }

    let existing
    try {
      existing = await creativeAudioBlobStore.readIfExists(artifact.immutableObjectKey)
    } catch (rawError) {
      const safeDiagnostics = { httpStatus: Number.isInteger(rawError?.status) ? rawError.status : null }
      try { await store.failCreativeAudioGeneration(artifactId, generationFingerprint, {
        status: 'failed', safeErrorCode: 'CREATIVE_AUDIO_STORAGE_ERROR',
      }) } catch { console.error('[revenue-lab] Creative Audio storage failure state could not be persisted', { artifactId }) }
      throw new RevenueJobError('CREATIVE_AUDIO_STORAGE_ERROR', 'Creative Audio storage operation failed', { safeDiagnostics })
    }
    if (existing) {
      if (!artifact.providerRequestId) {
        await store.failCreativeAudioGeneration(artifactId, generationFingerprint, {
          status: 'submission_uncertain', safeErrorCode: 'TTS_RECOVERY_RECEIPT_MISSING',
        })
        throw new RevenueJobError('TTS_RECOVERY_RECEIPT_MISSING', 'Stored audio lacks a durable provider receipt')
      }
      const audioSha256 = createHash('sha256').update(existing).digest('hex')
      if (artifact.audioSha256 && artifact.audioSha256 !== audioSha256) {
        await store.failCreativeAudioGeneration(artifactId, generationFingerprint, {
          status: 'submission_uncertain', safeErrorCode: 'TTS_RECOVERY_HASH_MISMATCH',
          providerRequestId: artifact.providerRequestId, providerTraceId: artifact.providerTraceId,
          characterCost: artifact.providerCharacterCost,
        })
        throw new RevenueJobError('TTS_RECOVERY_HASH_MISMATCH', 'Stored Creative Audio failed integrity verification')
      }
      const durationSeconds = await audioDurationProbe(existing)
      await store.completeCreativeAudioGeneration(artifactId, generationFingerprint, {
        audioSha256, durationSeconds, byteSize: existing.length,
        providerRequestId: artifact.providerRequestId, providerTraceId: artifact.providerTraceId,
        characterCost: artifact.providerCharacterCost, recovered: true,
      })
      return { creativeAudioArtifactId: artifactId, status: 'ready', recovered: true, providerCalled: false }
    }
    if (!claim.claimed) {
      await store.failCreativeAudioGeneration(artifactId, generationFingerprint, {
        status: 'submission_uncertain', safeErrorCode: 'TTS_PREVIOUS_SUBMISSION_UNCERTAIN',
        providerRequestId: artifact.providerRequestId, providerTraceId: artifact.providerTraceId,
        characterCost: artifact.providerCharacterCost,
      })
      return { creativeAudioArtifactId: artifactId, status: 'submission_uncertain', providerCalled: false }
    }

    let providerMetadata = null
    let generated
    try {
      generated = await textToSpeechProvider.synthesizeSegment({
        inputText: artifact.inputText, stableSeed: artifact.stableSeed,
      })
    } catch (rawError) {
      const error = /^TTS_[A-Z0-9_]+$/.test(rawError?.code || '') ? rawError : textToSpeechProvider.normalizeError(rawError)
      const status = error.submissionUncertain ? 'submission_uncertain' : 'failed'
      try {
        await store.failCreativeAudioGeneration(artifactId, generationFingerprint, {
          status, safeErrorCode: error.code || 'TTS_GENERATION_FAILED',
          providerRequestId: providerMetadata?.providerRequestId || error.providerRequestId,
          providerTraceId: providerMetadata?.providerTraceId || error.providerTraceId,
          characterCost: providerMetadata?.characterCost ?? error.characterCost,
        })
      } catch { console.error('[revenue-lab] Creative Audio failure state could not be persisted', { artifactId }) }
      throw new RevenueJobError(error.code || 'TTS_GENERATION_FAILED', 'Creative Audio generation failed', {
        safeDiagnostics: error.safeDiagnostics,
      })
    }
    providerMetadata = { providerRequestId: generated.providerRequestId,
      providerTraceId: generated.providerTraceId, characterCost: generated.characterCost }
    let durationSeconds
    try { durationSeconds = await audioDurationProbe(generated.bytes) }
    catch {
      try { await store.failCreativeAudioGeneration(artifactId, generationFingerprint, {
        status: 'failed', safeErrorCode: 'TTS_DURATION_MEASUREMENT_FAILED', ...providerMetadata,
      }) } catch { console.error('[revenue-lab] Creative Audio duration failure state could not be persisted', { artifactId }) }
      throw new RevenueJobError('TTS_DURATION_MEASUREMENT_FAILED', 'Creative Audio duration measurement failed')
    }
    const receipt = { audioSha256: generated.audioSha256, durationSeconds,
      byteSize: generated.bytes.length, ...providerMetadata }
    await store.recordCreativeAudioProviderReceipt(artifactId, generationFingerprint, receipt)
    try { await creativeAudioBlobStore.putImmutable(artifact.immutableObjectKey, generated.bytes, 'audio/mpeg') }
    catch (rawError) {
      const safeDiagnostics = { httpStatus: Number.isInteger(rawError?.status) ? rawError.status : null }
      try { await store.failCreativeAudioGeneration(artifactId, generationFingerprint, {
        status: 'failed', safeErrorCode: 'CREATIVE_AUDIO_STORAGE_ERROR', ...providerMetadata,
      }) } catch { console.error('[revenue-lab] Creative Audio storage failure state could not be persisted', { artifactId }) }
      throw new RevenueJobError('CREATIVE_AUDIO_STORAGE_ERROR', 'Creative Audio storage operation failed', { safeDiagnostics })
    }
    await store.completeCreativeAudioGeneration(artifactId, generationFingerprint, receipt)
    return { creativeAudioArtifactId: artifactId, status: 'ready', recovered: false, providerCalled: true }
  }

  return new Map([
    ['youtube.collect', collectYouTube],
    ['youtube.track', trackYouTube],
    ['opportunity.analyze', analyzeOpportunity],
    ['creative.production.plan', createProductionPlan],
    ['creative.archetype.plan', createThreePicksPlan],
    ['creative.compose.final', composeFinalShort],
    ['creative.audio.generate', generateCreativeAudio],
    ['video.generate.scene', generateVideoScene],
    ['product.search', searchProducts],
  ])
}

module.exports = { RevenueJobError, createJobHandlers }
