export const REVENUE_LAB_PATH = '/revenue-lab'

const DISCOVERY_THEME_STORAGE_KEY = 'revenue-lab.discovery-theme.v1'
export const DEFAULT_DISCOVERY_THEME = '買ってよかった食品'
export const DISCOVERY_THEME_PRESETS = Object.freeze([
  { id: 'food-favorites', label: '買ってよかった食品', category: 'food' },
  { id: 'amazon-food', label: 'Amazon食品おすすめ', category: 'food' },
  { id: 'gourmet-delivery', label: 'お取り寄せグルメ', category: 'food' },
  { id: 'quick-food', label: '時短食品', category: 'food' },
  { id: 'snacks', label: 'お菓子', category: 'food' },
  { id: 'coffee', label: 'コーヒー', category: 'food' },
  { id: 'noodles', label: '麺類', category: 'food' },
  { id: 'soba', label: '蕎麦', category: 'food' },
  { id: 'retort', label: 'レトルト', category: 'food' },
  { id: 'otsumami', label: 'おつまみ', category: 'food' },
])

const normalizeTheme = value => Array.from(String(value || '').normalize('NFKC').trim().replace(/[\s\u3000]+/g, ' ')).slice(0, 80).join('')
const normalizeDiscoveryQuery = value => String(value || '').normalize('NFKC').trim().replace(/[\s\u3000]+/g, ' ').toLocaleLowerCase('ja-JP')

export function resolveDiscoveryThemeSelection(presetId, customTheme) {
  if (presetId === 'custom') return normalizeTheme(customTheme)
  return DISCOVERY_THEME_PRESETS.find(preset => preset.id === presetId)?.label || DEFAULT_DISCOVERY_THEME
}

export function buildDiscoveryQueries(value) {
  const theme = normalizeTheme(value)
  if (!theme) return []
  const candidates = [
    theme,
    theme.includes('買ってよかった') ? `${theme} おすすめ` : `買ってよかった ${theme}`,
    theme.endsWith('おすすめ') ? `Amazon ${theme}` : `${theme} おすすめ`,
  ]
  return [...new Set(candidates.map(normalizeTheme).filter(Boolean))].slice(0, 3)
}

export function createDiscoveryRunPlan(value, querySlots = []) {
  const theme = normalizeTheme(value)
  const queryTexts = buildDiscoveryQueries(theme)
  const available = querySlots.filter(query => query?.id)
  const slots = [...available.filter(query => query.enabled), ...available.filter(query => !query.enabled)].slice(0, queryTexts.length)
  return {
    theme, queryTexts,
    updates: slots.map((query, index) => ({
      id: query.id,
      values: {
        label: index === 0 ? theme : `${theme} ${index + 1}`,
        queryText: queryTexts[index], enabled: true,
        buyerIntent: query.buyerIntent ?? 80, commerceFit: query.commerceFit ?? 80,
      },
    })),
  }
}

export function fingerprintDiscoveryQueries(values = []) {
  const input = values.map(normalizeDiscoveryQuery).filter(Boolean).join('\n')
  let hash = 0x811c9dc5
  for (const character of input) {
    hash ^= character.codePointAt(0)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a32-${hash.toString(16).padStart(8, '0')}`
}

const emptyDiscoverySession = theme => ({
  theme: normalizeTheme(theme) || DEFAULT_DISCOVERY_THEME,
  fingerprint: null, activeQueryStrings: [], activeQueryIds: [], jobIds: [], startedAt: null, status: 'idle',
})

export function readDiscoverySession(storageProvider = () => typeof window === 'undefined' ? null : window.localStorage) {
  try {
    const raw = storageProvider()?.getItem(DISCOVERY_THEME_STORAGE_KEY)
    if (!raw) return emptyDiscoverySession(DEFAULT_DISCOVERY_THEME)
    if (!String(raw).trim().startsWith('{')) return emptyDiscoverySession(raw)
    const saved = JSON.parse(raw)
    const theme = normalizeTheme(saved?.theme) || DEFAULT_DISCOVERY_THEME
    const status = ['idle', 'running', 'succeeded', 'empty', 'failed'].includes(saved?.status) ? saved.status : 'idle'
    return {
      theme, status,
      fingerprint: typeof saved?.fingerprint === 'string' ? saved.fingerprint : null,
      activeQueryStrings: Array.isArray(saved?.activeQueryStrings) ? saved.activeQueryStrings.map(normalizeDiscoveryQuery).filter(Boolean).slice(0, 3) : [],
      activeQueryIds: Array.isArray(saved?.activeQueryIds) ? saved.activeQueryIds.filter(value => typeof value === 'string').slice(0, 3) : [],
      jobIds: Array.isArray(saved?.jobIds) ? saved.jobIds.filter(value => typeof value === 'string').slice(0, 3) : [],
      startedAt: typeof saved?.startedAt === 'string' && Number.isFinite(Date.parse(saved.startedAt)) ? saved.startedAt : null,
    }
  } catch { return emptyDiscoverySession(DEFAULT_DISCOVERY_THEME) }
}

export function writeDiscoverySession(session, storageProvider = () => typeof window === 'undefined' ? null : window.localStorage) {
  const value = { ...emptyDiscoverySession(session?.theme), ...session, theme: normalizeTheme(session?.theme) || DEFAULT_DISCOVERY_THEME }
  try { storageProvider()?.setItem(DISCOVERY_THEME_STORAGE_KEY, JSON.stringify(value)); return true } catch { return false }
}

export function readDiscoveryTheme(storageProvider = () => typeof window === 'undefined' ? null : window.localStorage) {
  return readDiscoverySession(storageProvider).theme
}

export function writeDiscoveryTheme(value, storageProvider = () => typeof window === 'undefined' ? null : window.localStorage) {
  const theme = normalizeTheme(value)
  if (!theme) return false
  return writeDiscoverySession({ ...readDiscoverySession(storageProvider), theme }, storageProvider)
}

export async function executeDiscoveryRun({ plan, enqueue, refresh, saveSession = writeDiscoverySession, now = () => new Date().toISOString() }) {
  const startedAt = now()
  let session = {
    theme: plan.theme, fingerprint: fingerprintDiscoveryQueries(plan.queryTexts),
    activeQueryStrings: plan.queryTexts, activeQueryIds: plan.updates.map(update => update.id),
    jobIds: [], startedAt, status: 'running',
  }
  saveSession(session)
  try {
    const jobs = await enqueue(plan)
    session = { ...session, jobIds: jobs.map(job => job.id).filter(Boolean), status: 'running' }
    saveSession(session)
    const result = await refresh(session)
    session = { ...session, status: result.status }
    saveSession(session)
    return { session, result }
  } catch (error) {
    session = { ...session, status: 'failed' }
    saveSession(session)
    throw error
  }
}

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
    return { id: 'generate-plan', label: running ? `Revision ${revision.revisionNumber}の制作案を生成中` : '制作案を生成', disabled: Boolean(running), reason: running ? '制作案生成の完了を待っています' : undefined }
  }
  const artifacts = artifactsFor(revision)
  if (!artifacts.length || artifacts.some(item => item.status === 'planned')) return { id: 'generate-audio', label: 'この原稿で音声を生成', disabled: false }
  if (artifacts.some(item => ['queued', 'running', 'generating', 'submitting', 'polling'].includes(item.status))) return { id: 'generate-audio', label: 'ナレーション生成中', disabled: true, reason: '音声生成の完了を待っています' }
  if (!timing.ready) return { id: 'generate-audio', label: 'ナレーションを生成', disabled: true, reason: 'ready音声の実測durationが必要です' }
  const overflow = timing.scenes.find(item => item.ready && !item.fit)
  if (overflow) return { id: 'compose', label: 'Shorts MP4を生成', disabled: true, reason: `${overflow.label} ${overflow.narration.toFixed(2)}s / max ${overflow.maximum.toFixed(2)}s — ナレーションが長すぎます` }
  const rendering = (revision.compositions || []).some(item => ['queued', 'running', 'rendering', 'submitting', 'polling'].includes(item.status))
  if (rendering) return { id: 'compose', label: 'Shorts MP4生成中', disabled: true, reason: '動画生成の完了を待っています' }
  if (composition) return { id: 'preview', label: 'Previewを確認', disabled: false, outputId: composition.output?.id }
  return { id: 'compose', label: 'Shorts MP4を生成', disabled: false }
}

const FIELD_LABELS = Object.freeze({ display_name: 'display_name', short_appeal: 'short_appeal', fact_badge: 'fact_badge', tts: 'TTS原稿' })

function failedPlanDetail(revision, latestJob) {
  const code = revision?.safeErrorCode
  const sameFailure = latestJob?.jobType === 'creative.archetype.plan' && latestJob?.status === 'failed'
    && latestJob?.errorCode === code
  const diagnostic = sameFailure && typeof latestJob.errorMessage === 'string'
    ? latestJob.errorMessage.match(/^Three Picks planning failed: product ([1-3]); \$\.product_presentations\[[0-2]\]\.([a-z_]+); ([a-z0-9 -]+)(?:; field_value_preview=.{1,100})?(?:; evidence_candidate_ids=[A-Za-z0-9_.:,-]+)?$/u) : null
  if (diagnostic && code === 'THREE_PICKS_V2_UNGROUNDED_CLAIM') {
    return `PICK ${diagnostic[1]}の${FIELD_LABELS[diagnostic[2]] || 'コピー'}が選択した根拠データで確認できませんでした。`
  }
  if (code === 'THREE_PICKS_V2_UNGROUNDED_CLAIM') return '商品コピーが選択した根拠データで確認できませんでした。'
  if (code === 'THREE_PICKS_V2_TEXT_LIMIT') return '動画用コピーが文字数制約を満たしていません。'
  if (code === 'THREE_PICKS_V2_IDENTITY_CHANGED') return '短縮商品名が元の商品カテゴリと一致しませんでした。'
  return '制作案が品質チェックを通過しませんでした。'
}

function providerPlanAudit(revision, latestJob) {
  const sameFailure = revision?.safeErrorCode === 'OPENAI_HTTP_ERROR'
    && latestJob?.jobType === 'creative.archetype.plan' && latestJob?.status === 'failed'
    && latestJob?.errorCode === 'OPENAI_HTTP_ERROR'
  const diagnostic = sameFailure && typeof latestJob.errorMessage === 'string'
    ? latestJob.errorMessage.match(/^Three Picks planning failed: provider; http_status=(4\d\d|5\d\d); provider_error_code=([A-Za-z0-9_.:-]{1,80}); provider_error_type=([A-Za-z0-9_.:-]{1,80}); reason=(response schema contains an unsupported keyword|provider rejected the planning request)$/u)
    : null
  if (!diagnostic) return null
  return { httpStatus: Number(diagnostic[1]), providerErrorCode: diagnostic[2],
    providerErrorType: diagnostic[3], reason: diagnostic[4] }
}

export function planGenerationFeedback(revision, latestJob = null) {
  if (!revision?.revisionNumber) return null
  if (['queued', 'running', 'submitting', 'polling'].includes(revision.status)) {
    return { kind: 'pending', message: `Revision ${revision.revisionNumber}の制作案を生成中` }
  }
  if (revision.status === 'succeeded' && revision.planId && revision.output) {
    const plannerVersion = revision.promptVersion === 'three-picks-production-planner-v4'
      || revision.schemaVersion === 'multi-product-shorts-plan-v5' ? 'Planner v4' : 'Planner v3'
    return { kind: 'success', message: `✓ Revision ${revision.revisionNumber}の制作案を生成しました`, detail: `${plannerVersion} / Layout v2` }
  }
  if (revision.status === 'failed') {
    const providerAudit = providerPlanAudit(revision, latestJob)
    return { kind: 'error', message: '制作案の生成に失敗しました',
      detail: providerAudit?.providerErrorCode === 'invalid_json_schema'
        ? 'AI生成設定の形式に問題があります。' : failedPlanDetail(revision, latestJob),
      ...(providerAudit ? { audit: providerAudit } : {}) }
  }
  return null
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
    currentIndex, primaryAction: action, nextAction: action.label, planFeedback: planGenerationFeedback(revision, state.latestJob),
  }
}

export function isOperatorCampaign(campaign) {
  if (!campaign || campaign.status !== 'active') return false
  return latestIteration(campaign)?.productSet?.archetype === 'three_picks_v2'
}

export function preferredOperatorCampaignId(state = {}, requestedCampaignId = null) {
  const campaigns = (state.campaigns || []).filter(isOperatorCampaign)
  if (campaigns.some(campaign => campaign.id === requestedCampaignId)) return requestedCampaignId
  return stableNewest(campaigns, 'updatedAt', ['createdAt'])[0]?.id || null
}

function copyReviewSummary(revision) {
  if (!revision?.output) return { required: false, detail: '' }
  const fields = revision.output.soft_copy_fields || []
  const pending = fields.filter(field => field.reviewed !== true && !['confirmed', 'reviewed'].includes(field.review_status))
  if (!fields.length) return { required: true, detail: '原稿の確認が必要です' }
  if (!pending.length) return { required: false, detail: '' }
  const count = mode => pending.filter(field => field.generation_mode === mode).length
  const details = [
    ['安全文', count('canonical_fallback')], ['自動修正', count('ai_repaired')],
    ['手動修正', count('manual_edited') + count('human_edited')],
  ].filter(([, value]) => value).map(([label, value]) => `${label} ${value}件`)
  return { required: true, detail: details.join(' / ') || `未確認 ${pending.length}件` }
}

function productLinksReady(iteration) {
  if (iteration?.product) return Boolean(iteration.product.affiliateUrl || iteration.product.productUrl)
  const items = iteration?.productSet?.items || []
  return items.length > 0 && items.every(item => item.affiliateUrl || item.productUrl)
}

export function deriveAttentionItems(state = {}) {
  return (state.campaigns || []).filter(isOperatorCampaign).flatMap(campaign => {
    const workspace = deriveWorkspace(state, campaign.id)
    const { iteration, latestRevision: revision, composition, publication, planFeedback } = workspace
    const review = copyReviewSummary(revision)
    const linksReady = productLinksReady(iteration)
    const items = []
    const add = (kind, status, detail, cta, area) => items.push({
      id: `${campaign.id}:${kind}`, kind, campaignId: campaign.id, campaignName: campaign.name,
      status, detail, cta, area,
    })
    if (planFeedback?.kind === 'error') add('plan-error', '人間確認が必要', planFeedback.detail || planFeedback.message, '確認する', 'production')
    if (review.required) add('script-review', '原稿確認', review.detail, '確認する', 'production')
    if (revision?.planId && (iteration?.product || (iteration?.productSet?.items || []).length) && !linksReady) add('product-link', '商品リンク未登録', '公開に使う商品リンクを登録してください', 'リンクを登録', 'products')
    if (composition?.output && !publication) {
      add('video-preview', '動画Preview確認', `${composition.output.durationSeconds || '—'}秒`, '動画を確認', 'publication')
      if (!review.required && linksReady) {
        if (iteration?.status === 'published') add('publication-registration', 'Publication登録待ち', 'YouTube Video IDを登録してください', '登録する', 'publication')
        else add('youtube-publish', 'YouTube投稿待ち', 'タイトル・概要欄・商品リンクを確認してください', '投稿内容を確認', 'publication')
      }
    }
    return items
  })
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
