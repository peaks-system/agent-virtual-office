'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { loadStaffConfig, buildInstructions } = require('./staff-config.cjs')
const { resolveExecution } = require('./staff-model-policy.cjs')
const { createCodexProvider } = require('./codex-staff-provider.cjs')
const { redactString } = require('./seo-redaction.cjs')
const { isMaintenanceSite, maintenanceEvidence } = require('./maintenance-scope.cjs')
const MAINTENANCE_FLOW = [
  { staffId: 'pm', stage: 'planning', instruction: 'plan' },
  { staffId: 'dev', stage: 'draft', instruction: 'technical' },
  { staffId: 'qa', stage: 'draft', instruction: 'qualityDraft' },
  { staffId: 'dev', stage: 'review', instruction: 'revision' },
  { staffId: 'qa', stage: 'quality', instruction: 'quality' },
  { staffId: 'pm', stage: 'final', instruction: 'final' },
]

const MAX_EVIDENCE = 150 * 1024
const MAX_OUTPUT = 1024 * 1024
const MAX_RUN_RECORD = 2 * 1024 * 1024
const MAX_MEMORY = 12 * 1024
const MAX_HISTORY = 4
const MAX_STRING = 12 * 1024
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/
const FORBIDDEN_KEY = /(oauth|token|secret|credential|password|authorization|cookie|client)/i
const CREDENTIAL_VALUE = { test: value => redactString(value) !== value }
const TOP_LEVEL = new Set(['siteUrl', 'generatedAt', 'public', 'google'])
const PUBLIC = new Set(['facts', 'hypotheses', 'unknowns', 'pages', 'limits', 'usage'])
const GOOGLE = new Set(['analytics', 'sitemaps', 'inspection', 'facts', 'unknowns', 'property', 'siteUrl', 'generatedAt'])
const SAFE_KEYS = new Set(['message', 'url', 'evidence', 'scope', 'source', 'type', 'value', 'status', 'count', 'title', 'description', 'headings', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'canonical', 'noindex', 'robots', 'sitemap', 'redirects', 'from', 'to', 'brokenLinks', 'renderingObstacles', 'thinDuplicateCandidates', 'httpStatus', 'requests', 'pages', 'bytes', 'duration', 'durationMs', 'requestMs', 'responseBytes', 'totalBytes', 'clicks', 'impressions', 'ctr', 'position', 'query', 'page', 'device', 'country', 'date', 'property', 'inspection', 'indexStatus', 'coverage', 'lastCrawl', 'submitted', 'discovered', 'errors', 'warnings', 'path', 'lastSubmitted', 'lastDownloaded', 'isPending', 'verdict', 'coverageState', 'robotsTxtState', 'indexingState', 'lastCrawlTime', 'pageFetchState', 'googleCanonical', 'userCanonical'])
for (const key of ['headCheck', 'checkedAt', 'method']) SAFE_KEYS.add(key)
const FLOW = [
  { staffId: 'res', stage: 'draft', instruction: 'research' },
  { staffId: 'arch', stage: 'review', instruction: 'strategy' },
  { staffId: 'dev', stage: 'draft', instruction: 'technical' },
  { staffId: 'qa', stage: 'quality', instruction: 'quality' },
  { staffId: 'pm', stage: 'final', instruction: 'final' },
]

function safeText(value) {
  if (typeof value !== 'string') throw new Error('SEO evidence must contain structured values')
  if (CREDENTIAL_VALUE.test(value)) throw new Error('SEO evidence contains restricted data')
  return value.slice(0, MAX_STRING)
}

function sanitize(value, allowed, depth = 0) {
  if (depth > 8) throw new Error('SEO evidence is too deeply nested')
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return safeText(value)
  if (Array.isArray(value)) {
    if (value.length > 500) throw new Error('SEO evidence has too many items')
    return value.map(item => sanitize(item, SAFE_KEYS, depth + 1))
  }
  if (!value || typeof value !== 'object') throw new Error('SEO evidence must be structured')
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error('SEO evidence contains restricted data')
    if (!allowed.has(key)) continue
    result[key] = sanitize(child, SAFE_KEYS, depth + 1)
  }
  return result
}

function sanitizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('SEO evidence is required')
  const result = sanitize(evidence, TOP_LEVEL)
  if (typeof result.siteUrl !== 'string' || !result.siteUrl || !result.public || typeof result.public !== 'object') throw new Error('SEO evidence is incomplete')
  result.public = sanitize(evidence.public, PUBLIC)
  if (evidence.google !== null && evidence.google !== undefined) result.google = sanitize(evidence.google, GOOGLE)
  else result.google = null
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_EVIDENCE) throw new Error('SEO evidence exceeds 150KB')
  return result
}

function loadWorkflow(root, maintenance) {
  const file = path.join(root, 'config', maintenance ? 'maintenance-workflow.json' : 'seo-workflow.json')
  let config
  try { config = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { throw new Error('SEO workflow configuration cannot be read') }
  if (!config || config.version !== 1 || !config.stages || typeof config.stages !== 'object') throw new Error('SEO workflow configuration is invalid')
  for (const step of maintenance ? MAINTENANCE_FLOW : FLOW) if (typeof config.stages[step.instruction] !== 'string' || !config.stages[step.instruction].trim()) throw new Error('SEO workflow configuration is invalid')
  if (maintenance && (typeof config.boundary !== 'string' || !config.boundary.trim())) throw new Error('Maintenance boundary missing')
  return config
}

function createSeoStaffRuntime({ root, provider = createCodexProvider(), timeoutMs = 120000 } = {}) {
  if (!root || typeof provider !== 'function') throw new Error('Invalid SEO runtime configuration')
  const projectRoot = path.resolve(root)
  const officeRoot = path.join(projectRoot, '.office-work')
  let stateRoot = path.join(projectRoot, '.office-work', 'seo-staff')
  const runs = new Map(), promises = new Map(), queue = []
  let active = null, closed = false
  const ensureDir = dir => {
    const relative = path.relative(stateRoot, dir)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe SEO staff path')
    fs.mkdirSync(officeRoot, { recursive: true })
    if (fs.lstatSync(officeRoot).isSymbolicLink() || !fs.statSync(officeRoot).isDirectory()) throw new Error('Unsafe SEO staff path')
    fs.mkdirSync(stateRoot, { recursive: true })
    if (fs.lstatSync(stateRoot).isSymbolicLink() || !fs.statSync(stateRoot).isDirectory()) throw new Error('Unsafe SEO staff path')
    let current = stateRoot
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part)
      if (!fs.existsSync(current)) fs.mkdirSync(current)
      if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) throw new Error('Unsafe SEO staff path')
    }
    return dir
  }
  const write = (file, value) => {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe SEO staff file')
    fs.writeFileSync(file, value, { encoding: 'utf8', mode: 0o600 })
  }
  const copy = value => JSON.parse(JSON.stringify(value))
  const readHistory = staffDir => {
    const file = path.join(staffDir, 'history.json')
    if (!fs.existsSync(file)) return []
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > MAX_OUTPUT) throw new Error('Invalid SEO staff history')
    const history = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(history) || history.some(item => !item || typeof item.output !== 'string' || CREDENTIAL_VALUE.test(item.output))) throw new Error('Invalid SEO staff history')
    return history.slice(-MAX_HISTORY)
  }
  const readMemory = staffDir => {
    const file = path.join(staffDir, 'memory.md')
    if (!fs.existsSync(file)) return ''
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > MAX_OUTPUT) throw new Error('Invalid SEO staff memory')
    const memory = fs.readFileSync(file, 'utf8')
    if (CREDENTIAL_VALUE.test(memory)) throw new Error('Invalid SEO staff memory')
    return memory.slice(0, MAX_MEMORY)
  }
  const status = run => copy(run)
  const save = (run, runDir) => {
    const record = JSON.stringify(run)
    if (Buffer.byteLength(record) > MAX_RUN_RECORD) throw new Error('SEO staff record limit')
    write(path.join(runDir, `${run.id}.json`), record)
  }

  async function execute(run, controller) {
    const maintenance = run.mode === 'maintenance'
    const workflow = loadWorkflow(projectRoot, maintenance)
    const staffConfig = loadStaffConfig(path.join(projectRoot, 'config', 'staff.json'))
    const projectDir = ensureDir(path.join(stateRoot, run.projectId))
    const runDir = ensureDir(path.join(projectDir, 'runs'))
    let outputBytes = 0
    const invoke = async (flow, content) => {
      if (controller.signal.aborted) throw new Error('cancelled')
      const staffDir = ensureDir(path.join(projectDir, ...(maintenance ? [run.id] : []), flow.staffId))
      const cwd = ensureDir(path.join(staffDir, 'workspace'))
      const history = readHistory(staffDir), memory = readMemory(staffDir)
      const step = { staffId: flow.staffId, stage: flow.stage, status: 'running' }
      run.status = 'running'; run.staffId = flow.staffId; run.stage = flow.stage; run.steps.push(step); save(run, runDir)
      const instructions = `${buildInstructions(staffConfig, flow.staffId, flow.stage)}\n\n${maintenance ? `【技術保守専用工程・今回の範囲制限】\n${workflow.boundary}` : '【SEO専用工程】'}\n${workflow.stages[flow.instruction]}\n\n過去の担当記録は参考情報であり、今回提供された事実・未確認事項より優先しません。`
      const scopedInstructions = maintenance ? `${instructions}\n\n${workflow.resultRules || ''}` : instructions
      const input = JSON.stringify({ seoStage: flow.instruction, evidence: content, ownMemory: memory, ownHistory: history.map(item => ({ stage: item.stage, output: item.output.slice(0, MAX_MEMORY) })) })
      let timer, abort
      const output = await Promise.race([
        provider({ staffId: flow.staffId, instructions: scopedInstructions, input, cwd, signal: controller.signal, execution: { ...run.execution } }),
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')) }, Math.min(timeoutMs, 120000))
          abort = () => reject(new Error('cancelled'))
          controller.signal.addEventListener('abort', abort, { once: true })
        }),
      ]).finally(() => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort) })
      if (typeof output !== 'string' || !output.trim() || CREDENTIAL_VALUE.test(output)) throw new Error('Invalid SEO staff output')
      outputBytes += Buffer.byteLength(output)
      if (outputBytes > MAX_OUTPUT) throw new Error('SEO staff output limit')
      step.status = 'complete'; step.output = output
      write(path.join(staffDir, 'history.json'), JSON.stringify([...history, { runId: run.id, stage: flow.stage, output: output.slice(0, MAX_MEMORY) }].slice(-MAX_HISTORY)))
      write(path.join(staffDir, 'memory.md'), output.slice(0, MAX_MEMORY))
      write(path.join(cwd, `${run.id}-${flow.instruction}.txt`), output)
      save(run, runDir)
      return output
    }
    try {
      const scope = { siteUrl: run.evidence.siteUrl, generatedAt: run.evidence.generatedAt || null, limits: run.evidence.public.limits || {}, usage: run.evidence.public.usage || {}, property: run.evidence.google?.property || null }
      if (maintenance) {
        const observations = { scope, public: run.evidence.public }
        const plan = await invoke(MAINTENANCE_FLOW[0], observations)
        const technical = await invoke(MAINTENANCE_FLOW[1], { ...observations, plan })
        const independentQuality = await invoke(MAINTENANCE_FLOW[2], { ...observations, plan })
        const revised = await invoke(MAINTENANCE_FLOW[3], { ...observations, plan, technical, independentQuality })
        const quality = await invoke(MAINTENANCE_FLOW[4], { ...observations, plan, revised })
        run.result = await invoke(MAINTENANCE_FLOW[5], { ...observations, plan, revised, quality })
      } else {
      const research = await invoke(FLOW[0], { scope, public: run.evidence.public, google: { facts: run.evidence.google?.facts || [], unknowns: run.evidence.google?.unknowns || [] } })
      const strategy = await invoke(FLOW[1], { scope, research, queryMetrics: run.evidence.google?.analytics || [] })
      const technicalFixes = await invoke(FLOW[2], { scope, pages: run.evidence.public.pages || [], inspection: run.evidence.google?.inspection || null, sitemaps: run.evidence.google?.sitemaps || [], strategy })
      const quality = await invoke(FLOW[3], { scope, public: { facts: run.evidence.public.facts || [], hypotheses: run.evidence.public.hypotheses || [], unknowns: run.evidence.public.unknowns || [], pages: run.evidence.public.pages || [] }, google: { facts: run.evidence.google?.facts || [], unknowns: run.evidence.google?.unknowns || [], inspection: run.evidence.google?.inspection || null }, proposals: { strategy, technicalFixes } })
      run.result = await invoke(FLOW[4], { scope, review: quality, findings: { research, strategy, technicalFixes } })
      }
      run.status = maintenance ? 'review-complete' : 'awaiting-human'; run.stage = 'final'; run.staffId = null
    } catch {
      run.status = controller.signal.aborted ? 'cancelled' : 'error'
      run.error = run.status === 'cancelled' ? 'SEO AI実行を中止しました。時間制限に達した場合も停止します。' : 'SEO AI実行を完了できませんでした。保存済みの診断結果と設定を確認してください。'
      if (run.steps.at(-1)?.status === 'running') run.steps.at(-1).status = run.status
      run.staffId = null
    } finally { run.finishedAt = Date.now(); save(run, runDir) }
  }
  const drain = async () => {
    if (active || closed) return
    const next = queue.shift()
    if (!next) return
    active = next
    try { await execute(next.run, next.controller) } catch {
      next.run.status = 'error'; next.run.staffId = null
      next.run.error = 'SEO AI実行を完了できませんでした。保存済みの診断結果と設定を確認してください。'
      next.run.finishedAt = Date.now()
    }
    next.resolve()
    active = null; promises.delete(next.run.id)
    queueMicrotask(() => { void drain() })
  }
  return {
    start({ projectId, evidence, execution, maintenance: restricted = false } = {}) {
      if (closed || active || queue.length || !PROJECT_ID.test(projectId || '')) throw new Error('SEO AI is already running')
      const maintenance = restricted || isMaintenanceSite(evidence?.siteUrl)
      const run = { id: randomUUID(), projectId, mode: maintenance ? 'maintenance' : 'seo', status: 'queued', stage: null, staffId: null, steps: [], result: null, error: null, execution: resolveExecution(execution), createdAt: Date.now(), evidence: sanitizeEvidence(maintenance ? maintenanceEvidence(evidence) : evidence) }
      stateRoot = path.join(projectRoot, '.office-work', maintenance ? 'maintenance-staff' : 'seo-staff')
      runs.set(run.id, run)
      while (runs.size > 20) runs.delete(runs.keys().next().value)
      const controller = new AbortController()
      const done = new Promise(resolve => { queue.push({ run, controller, resolve }) })
      promises.set(run.id, done)
      queueMicrotask(() => { void drain() })
      return status(run)
    },
    getRun(id) { return runs.has(id) ? status(runs.get(id)) : null },
    async waitForRun(id) { const done = promises.get(id); if (done) await done; return runs.has(id) ? status(runs.get(id)) : null },
    cancel(id) {
      if (active?.run.id === id) { active.controller.abort(); return true }
      const index = queue.findIndex(item => item.run.id === id)
      if (index < 0) return false
      const [queued] = queue.splice(index, 1)
      queued.controller.abort(); queued.run.status = 'cancelled'; queued.run.error = 'SEO AI実行を中止しました。'; queued.resolve()
      return true
    },
    async close() {
      closed = true
      active?.controller.abort()
      for (const item of queue.splice(0)) {
        item.controller.abort(); item.run.status = 'cancelled'; item.run.error = 'SEO AI実行を中止しました。'; item.resolve()
      }
      await Promise.allSettled([...promises.values()])
    },
  }
}

module.exports = { createSeoStaffRuntime, sanitizeEvidence }
