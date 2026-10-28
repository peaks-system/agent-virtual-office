const ROOT = '/api/revenue'

async function request(path, options = {}) {
  const response = await fetch(`${ROOT}${path}`, {
    ...options,
    headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.data) {
    const error = new Error(payload?.error?.message || 'Revenue Labとの通信に失敗しました。')
    error.code = payload?.error?.code || 'REVENUE_API_ERROR'
    error.status = response.status
    error.details = payload?.error?.details || null
    throw error
  }
  return payload.data
}

export function loadRevenueDashboard() {
  return request('/dashboard?limit=3')
}

export function updateRevenueQuery(id, values) {
  return request(`/queries/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(values),
  })
}

export function enqueueRevenueQuery(sourceQueryId) {
  return request('/jobs', {
    method: 'POST',
    body: JSON.stringify({ sourceQueryId }),
  })
}

export async function enqueueEnabledRevenueQueries(queries) {
  const eligible = queries.filter(query => query.enabled && query.buyerIntent != null && query.commerceFit != null)
  const results = []
  for (const query of eligible) results.push(await enqueueRevenueQuery(query.id))
  return results
}

export function enqueueRevenueTracking() {
  return request('/tracking/jobs', { method: 'POST', body: JSON.stringify({}) })
}

export function enqueueRevenueAnalysis(limit = 1) {
  return request('/analysis/jobs', { method: 'POST', body: JSON.stringify({ limit }) })
}

export function createRevenueAnalysisReview(analysisId, decision, agreement, notes = null) {
  return request(`/analyses/${encodeURIComponent(analysisId)}/reviews`, {
    method: 'POST', body: JSON.stringify({ decision, agreement, notes }),
  })
}

export function enqueueProductSearch(analysisId) {
  return request(`/analyses/${encodeURIComponent(analysisId)}/product-search/jobs`, {
    method: 'POST', body: JSON.stringify({}),
  })
}

export function enqueueCommerceTranslation(analysisId) {
  return request(`/analyses/${encodeURIComponent(analysisId)}/commerce-translations/jobs`, {
    method: 'POST', body: JSON.stringify({}),
  })
}

export function createCommerceTranslationFeedback(translationId, keywordId, action, overrideKeyword = null, notes = null) {
  return request(`/commerce-translations/${encodeURIComponent(translationId)}/feedback`, {
    method: 'POST', body: JSON.stringify({ keywordId, action, overrideKeyword, notes }),
  })
}

export function enqueueYouTubeDescriptionEnrichment(analysisId) {
  return request(`/analyses/${encodeURIComponent(analysisId)}/source-enrichment/jobs`, {
    method: 'POST', body: JSON.stringify({}),
  })
}

export function createProductCandidateDecision(candidateId, analysisId, decision, notes = null) {
  return request(`/product-candidates/${encodeURIComponent(candidateId)}/decisions`, {
    method: 'POST', body: JSON.stringify({ analysisId, decision, notes }),
  })
}

export function createManualCampaign(analysisId, input) {
  return request(`/analyses/${encodeURIComponent(analysisId)}/campaigns`, {
    method: 'POST', body: JSON.stringify(input),
  })
}

export function createDirectProductCampaign(input) {
  return request('/direct-products/campaigns', {
    method: 'POST', body: JSON.stringify(input),
  })
}

export function createThreePicksCampaign(input) {
  return request('/three-picks/campaigns', { method: 'POST', body: JSON.stringify(input) })
}

export function createThreePicksV2Campaign(input) {
  return request('/three-picks-v2/campaigns', { method: 'POST', body: JSON.stringify(input) })
}

export function enqueueThreePicksPlan(iterationId, idempotencyKey) {
  return request(`/campaign-iterations/${encodeURIComponent(iterationId)}/three-picks-plans`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey }),
  })
}

export function enqueueThreePicksV2Plan(iterationId, idempotencyKey) {
  return request(`/campaign-iterations/${encodeURIComponent(iterationId)}/three-picks-v2-plans`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey }),
  })
}

export function enqueueFinalComposition(planId, idempotencyKey) {
  return request(`/three-picks-plans/${encodeURIComponent(planId)}/compositions`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey }),
  })
}

export function enqueueFinalCompositionV2(planId, idempotencyKey) {
  return request(`/three-picks-v2-plans/${encodeURIComponent(planId)}/compositions`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey }),
  })
}

export function enqueueCreativeAudioGeneration(planId, idempotencyKey) {
  return request(`/three-picks-v2-plans/${encodeURIComponent(planId)}/audio-generations`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey }),
  })
}

export function enqueueCreativeAudioArtifactGeneration(artifactId, idempotencyKey) {
  return request(`/creative-audio-artifacts/${encodeURIComponent(artifactId)}/generation`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey }),
  })
}

export function loadFinalCompositionPreview(outputId) {
  return request(`/composition-outputs/${encodeURIComponent(outputId)}/preview`)
}

export function enqueueCreativeProductionPlan(iterationId, idempotencyKey) {
  return request(`/campaign-iterations/${encodeURIComponent(iterationId)}/production-plans`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey }),
  })
}

export function enqueueVideoGeneration(planId, sceneNumber, idempotencyKey, regenerate = false) {
  return request(`/creative-production-plans/${encodeURIComponent(planId)}/scenes/${encodeURIComponent(sceneNumber)}/video-generations`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey, regenerate }),
  })
}

export function createProductAssetRevision(assetId, i2vAllowed, createNineSixteen = true) {
  return request(`/product-assets/${encodeURIComponent(assetId)}/revisions`, {
    method: 'POST', body: JSON.stringify({ i2vAllowed, createNineSixteen }),
  })
}

export function enqueueImageVideoGeneration(planId, sceneNumber, assetRevisionId, idempotencyKey, regenerate = false) {
  return request(`/creative-production-plans/${encodeURIComponent(planId)}/scenes/${encodeURIComponent(sceneNumber)}/image-video-generations`, {
    method: 'POST', body: JSON.stringify({ assetRevisionId, idempotencyKey, regenerate }),
  })
}

export function registerCampaignPublication(iterationId, input) {
  return request(`/campaign-iterations/${encodeURIComponent(iterationId)}/publications`, {
    method: 'POST', body: JSON.stringify(input),
  })
}

export function updateDraftCampaignIteration(iterationId, input) {
  return request(`/campaign-iterations/${encodeURIComponent(iterationId)}/draft`, {
    method: 'PUT', body: JSON.stringify(input),
  })
}

export function createCampaignIteration(campaignId, sourceIterationId, input) {
  return request(`/campaigns/${encodeURIComponent(campaignId)}/iterations`, {
    method: 'POST', body: JSON.stringify({ sourceIterationId, ...input }),
  })
}

export function hardDeleteDraftCampaign(campaignId) {
  return request(`/campaigns/${encodeURIComponent(campaignId)}`, { method: 'DELETE' })
}

export function voidCampaign(campaignId, reason, note = null) {
  return request(`/campaigns/${encodeURIComponent(campaignId)}/void`, {
    method: 'POST', body: JSON.stringify({ reason, note }),
  })
}

export function startYouTubeAnalyticsOAuth() {
  return request('/youtube-analytics/oauth/start', { method: 'POST', body: JSON.stringify({}) })
}

export function collectYouTubeAnalytics(publicationId, startDate, endDate) {
  return request(`/campaign-publications/${encodeURIComponent(publicationId)}/youtube-analytics/runs`, {
    method: 'POST', body: JSON.stringify({ startDate, endDate }),
  })
}

export { request as revenueRequest }
