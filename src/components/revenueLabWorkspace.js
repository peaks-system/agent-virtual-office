export const REVENUE_LAB_PATH = '/revenue-lab'

const timestamp = value => {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : 0
}

const stableNewest = (items, numberKey, dateKeys = []) => [...(items || [])].sort((left, right) => {
  const numberDelta = Number(right?.[numberKey] || 0) - Number(left?.[numberKey] || 0)
  if (numberDelta) return numberDelta
  for (const key of dateKeys) {
    const dateDelta = timestamp(right?.[key]) - timestamp(left?.[key])
    if (dateDelta) return dateDelta
  }
  return String(right?.requestId || right?.id || '').localeCompare(String(left?.requestId || left?.id || ''))
})

export function departmentFromLocation(location = {}) {
  const pathname = String(location.pathname || '/').replace(/\/+$/, '') || '/'
  return pathname === REVENUE_LAB_PATH ? 'revenue' : 'office'
}

export function campaignFromLocation(location = {}) {
  return new URLSearchParams(location.search || '').get('campaign') || null
}

export function buildWorkspaceUrl(location = {}, department, campaignId = null) {
  const query = new URLSearchParams(location.search || '')
  if (department === 'revenue' && campaignId) query.set('campaign', campaignId)
  else if (department !== 'revenue') query.delete('campaign')
  const pathname = department === 'revenue' ? REVENUE_LAB_PATH : '/'
  const search = query.toString()
  return `${pathname}${search ? `?${search}` : ''}`
}

export function installWorkspacePopstate(windowRef, onChange) {
  const restore = () => onChange({ department: departmentFromLocation(windowRef.location), campaignId: campaignFromLocation(windowRef.location) })
  windowRef.addEventListener('popstate', restore)
  return () => windowRef.removeEventListener('popstate', restore)
}

export function createLatestRequestSequence() {
  let latest = 0
  return { begin: () => { latest += 1; return latest }, isLatest: requestId => requestId === latest }
}

export function selectActiveCampaign(campaigns = [], requestedId = null) {
  const active = stableNewest(campaigns.filter(item => item?.status === 'active'), 'revisionNumber', ['createdAt'])
  const requested = requestedId ? active.find(item => item.id === requestedId) : null
  const campaign = requested || active[0] || null
  return { campaign, active, normalized: Boolean(campaign) && campaign.id !== requestedId, archive: campaigns.filter(item => item?.status !== 'active') }
}

const TIMING = [
  ['hook', 'Hook', 4, 5], ['product-1', 'Product 1', 10, 13], ['product-2', 'Product 2', 10, 13],
  ['product-3', 'Product 3', 10, 13], ['cta', 'CTA', 5, 6],
]

function audioTiming(artifacts) {
  const scenes = TIMING.map(([id, label, preferred, maximum]) => {
    const entries = artifacts.filter(item => item.sceneId === id)
    const ready = entries.length > 0 && entries.every(item => item.status === 'ready' && Number(item.durationSeconds) > 0)
    const narration = ready ? entries.reduce((total, item) => total + Number(item.durationSeconds), 0) : null
    const required = ready ? Math.max(preferred * 30, Math.ceil((narration + 0.5) * 30)) / 30 : null
    return { id, label, maximum, narration, required, ready, fit: ready && required <= maximum }
  })
  return { scenes, ready: scenes.every(item => item.ready), fit: scenes.every(item => item.fit) }
}

function latestIteration(campaign) {
  return stableNewest(campaign?.iterations, 'iterationNumber')[0] || null
}

function latestV2Revision(iteration) {
  return stableNewest((iteration?.archetypePlans || []).filter(item => item?.creativeArchetype !== 'three_picks_v1'), 'revisionNumber', ['generatedAt'])[0] || null
}

function artifactsFor(revision) {
  if (!revision) return []
  return (revision.audioArtifacts || []).filter(item => !revision.planId || item.creativeArchetypePlanId === revision.planId)
}

function completedComposition(revision) {
  return (revision?.compositions || []).find(item => ['succeeded', 'completed', 'ready'].includes(item.status) && item.output) || null
}

function primaryAction({ iteration, revision, legacy, timing, composition }) {
  if (!iteration) return { id: 'no-product', label: '商品を登録', disabled: true, reason: '制作対象の商品がありません' }
  if (legacy) return { id: 'legacy-read-only', label: 'Legacy・読取専用', disabled: true, reason: 'Three Picks v1は通常制作できません' }
  if (!revision || !revision.planId || revision.status !== 'succeeded') {
    const running = revision && ['queued', 'running', 'submitting', 'polling'].includes(revision.status)
    return { id: 'generate-plan', label: running ? '制作案生成中' : '制作案を生成', disabled: Boolean(running), reason: running ? '制作案生成の完了を待っています' : undefined }
  }
  const artifacts = artifactsFor(revision)
  if (!artifacts.length || artifacts.some(item => item.status === 'planned')) return { id: 'generate-audio', label: 'ナレーションを生成', disabled: false }
  if (artifacts.some(item => ['queued', 'running', 'generating', 'submitting', 'polling'].includes(item.status))) return { id: 'generate-audio', label: 'ナレーション生成中', disabled: true, reason: '音声生成の完了を待っています' }
  if (!timing.ready) return { id: 'generate-audio', label: 'ナレーションを生成', disabled: true, reason: 'ready音声の実測durationが必要です' }
  const overflow = timing.scenes.find(item => item.ready && !item.fit)
  if (overflow) return { id: 'compose', label: 'Shorts MP4を生成', disabled: true, reason: `${overflow.label} ${overflow.narration.toFixed(2)}s / max ${overflow.maximum.toFixed(2)}s — ナレーションが長すぎます` }
  const rendering = (revision.compositions || []).some(item => ['queued', 'running', 'rendering', 'submitting', 'polling'].includes(item.status))
  if (rendering) return { id: 'compose', label: 'Shorts MP4生成中', disabled: true, reason: '動画生成の完了を待っています' }
  if (composition) return { id: 'preview', label: 'Previewを確認', disabled: false, outputId: composition.output?.id }
  return { id: 'compose', label: 'Shorts MP4を生成', disabled: false }
}

export function deriveWorkspace(state = {}, requestedCampaignId = null) {
  const selection = selectActiveCampaign(state.campaigns || [], requestedCampaignId)
  const campaign = selection.campaign
  const iteration = latestIteration(campaign)
  const legacy = iteration?.productSet?.archetype === 'three_picks_v1'
  const revision = legacy ? stableNewest(iteration?.archetypePlans, 'revisionNumber', ['generatedAt'])[0] || null : latestV2Revision(iteration)
  const timing = audioTiming(artifactsFor(revision))
  const composition = completedComposition(revision)
  const publication = iteration?.publication || null
  let action = primaryAction({ iteration, revision, legacy, timing, composition })
  if (publication && composition) action = publication.latestPerformance || publication.performance ? { id: 'complete', label: '公開・分析済み', disabled: true } : { id: 'analytics', label: 'Analyticsを取得', disabled: false }
  const completed = [Boolean(iteration?.product || iteration?.productSet), Boolean(revision?.planId && revision.status === 'succeeded'), timing.ready, Boolean(composition), Boolean(publication?.latestPerformance || publication?.performance)]
  const labels = ['商品', '制作案', '音声', '動画', '公開・分析']
  const currentIndex = Math.min(completed.findIndex(value => !value) < 0 ? 4 : completed.findIndex(value => !value), 4)
  return {
    ...selection, campaign, iteration, latestRevision: revision, legacy, timing, composition, publication,
    steps: labels.map((label, index) => ({ id: ['product', 'plan', 'audio', 'video', 'publication'][index], label, complete: completed[index], current: index === currentIndex })),
    currentIndex, primaryAction: action, nextAction: action.label,
  }
}

const transient = status => ['queued', 'running', 'rendering', 'generating', 'submitting', 'polling', 'authorizing'].includes(status)

export function shouldPollRevenueLab(state = {}) {
  if (transient(state.latestJob?.status) || transient(state.youtubeAnalyticsFlow?.status)) return true
  return (state.campaigns || []).some(campaign => (campaign.iterations || []).some(iteration => (iteration.archetypePlans || []).some(revision =>
    transient(revision.status) || (revision.audioArtifacts || []).some(item => transient(item.status)) || (revision.compositions || []).some(item => transient(item.status)))))
}

export function installRevenueRefreshLifecycle({ windowRef, documentRef, refresh, shouldPoll, intervalMs = 3000, setIntervalFn = setInterval, clearIntervalFn = clearInterval }) {
  let timer = null
  let awaitingReturn = false
  let suppressNextFocus = false
  const stop = () => { if (timer != null) { clearIntervalFn(timer); timer = null } }
  const start = () => { stop(); if (!documentRef.hidden && shouldPoll()) timer = setIntervalFn(refresh, intervalMs) }
  const visible = () => {
    if (documentRef.hidden) { awaitingReturn = true; suppressNextFocus = false; stop(); return }
    if (awaitingReturn) { awaitingReturn = false; suppressNextFocus = true; refresh() }
    start()
  }
  const focus = () => {
    if (documentRef.hidden) return
    if (suppressNextFocus) { suppressNextFocus = false; start(); return }
    awaitingReturn = false; refresh(); start()
  }
  windowRef.addEventListener('focus', focus)
  documentRef.addEventListener('visibilitychange', visible)
  start()
  return () => { stop(); windowRef.removeEventListener('focus', focus); documentRef.removeEventListener('visibilitychange', visible) }
}
