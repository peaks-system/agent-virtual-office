'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { loadStaffConfig, buildInstructions } = require('./staff-config.cjs')

const SPECIALISTS = new Set(['arch', 'res', 'ops', 'gate', 'designer', 'dev'])
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)
const hasCredential = value => /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\b(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*["']?[^\s"']{12,}/i.test(value)
const MAX_OUTPUT = 1048576

function createStaffRuntime({ provider, dataRoot, configPath, onStatus = () => {}, timeoutMs = 120000 }) {
  if (typeof provider !== 'function' || !dataRoot) throw new Error('Invalid runtime configuration')
  const root = path.resolve(dataRoot)
  const runs = new Map(), promises = new Map()
  let active = null, closed = false
  const ensureDir = dir => {
    const relative = path.relative(root, dir)
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe data path')
    fs.mkdirSync(root, { recursive: true })
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Unsafe data path')
    let current = root
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part)
      if (!fs.existsSync(current)) fs.mkdirSync(current)
      if (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory()) throw new Error('Unsafe data path')
    }
    return dir
  }
  const readHistory = dir => {
    const file = path.join(dir, 'history.json')
    if (!fs.existsSync(file)) return []
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > MAX_OUTPUT) throw new Error('Invalid staff history')
    const history = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!Array.isArray(history) || history.some(h => !h || typeof h.output !== 'string' || hasCredential(h.output) || typeof h.stage !== 'string' || typeof h.runId !== 'string')) throw new Error('Invalid staff history')
    return history.slice(-4)
  }
  const readMemory = dir => {
    const file = path.join(dir, 'memory.md')
    if (!fs.existsSync(file)) return ''
    if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 48000) throw new Error('Invalid staff memory')
    const memory = fs.readFileSync(file, 'utf8')
    if (hasCredential(memory)) throw new Error('Invalid staff memory')
    return memory.slice(0, 12000)
  }
  const write = (file, value) => {
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe data file')
    fs.writeFileSync(file, value, { encoding: 'utf8', mode: 0o600 })
  }
  const publicRun = run => JSON.parse(JSON.stringify(run))
  const notify = run => { try { onStatus({ runId: run.id, projectId: run.projectId, staffId: run.staffId, stage: run.stage, status: run.status }) } catch { /* UI callbacks cannot invalidate work. */ } }

  async function workflow(run, controller) {
    let outputBytes = 0
    const config = loadStaffConfig(configPath)
    const eligible = new Set(config.staff.filter(staff => SPECIALISTS.has(staff.id) && staff.executionEnabled).map(staff => staff.id))
    const projectDir = ensureDir(path.join(root, run.projectId))
    const runDir = ensureDir(path.join(projectDir, 'runs'))
    const save = () => write(path.join(runDir, `${run.id}.json`), JSON.stringify(run))
    const call = async (staffId, stage, content) => {
      if (controller.signal.aborted) throw new Error('cancelled')
      if (staffId === 'president') throw new Error('President cannot execute')
      const instructions = buildInstructions(config, staffId, stage)
      const staffDir = ensureDir(path.join(projectDir, staffId))
      const cwd = ensureDir(path.join(staffDir, 'workspace'))
      const history = readHistory(staffDir)
      const ownMemory = readMemory(staffDir)
      run.status = 'running'; run.staffId = staffId; run.stage = stage
      const step = { staffId, stage, status: 'running' }
      run.steps.push(step); save(); notify(run)
      let timer, abortListener
      const input = JSON.stringify({ request: run.request, stage, content, ownMemory, ownHistory: history.map(h => ({ stage: h.stage, output: h.output.slice(0, 12000) })) })
      const output = await Promise.race([
        provider({ staffId, instructions, input, cwd, signal: controller.signal }),
        new Promise((_, reject) => {
          timer = setTimeout(() => { reject(new Error('timeout')); controller.abort() }, Math.min(timeoutMs, 120000))
          abortListener = () => reject(new Error('cancelled'))
          controller.signal.addEventListener('abort', abortListener, { once: true })
        }),
      ]).finally(() => { clearTimeout(timer); controller.signal.removeEventListener('abort', abortListener) })
      if (typeof output !== 'string' || !output.trim() || hasCredential(output)) throw new Error('Invalid output')
      outputBytes += Buffer.byteLength(output)
      if (outputBytes > MAX_OUTPUT) throw new Error('Output limit')
      step.output = output; step.status = 'complete'
      const nextHistory = [...history, { runId: run.id, stage, output: output.slice(0, 12000) }].slice(-4)
      // All files here belong exclusively to this project and staff member.
      write(path.join(staffDir, 'history.json'), JSON.stringify(nextHistory))
      write(path.join(staffDir, 'memory.md'), output.slice(0, 12000))
      write(path.join(cwd, `${run.id}-${stage}.txt`), output)
      save(); notify(run)
      return output
    }
    try {
      if (eligible.size === 0) {
        run.error = '実行可能な専門社員がいません。社員設定で専門担当を有効にしてください。'
        throw new Error('No eligible specialists')
      }
      const planText = await call('pm', 'planning', { eligibleStaffIds: [...eligible] })
      const stripped = planText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      const plan = JSON.parse(stripped)
      if (!Array.isArray(plan.assignments) || plan.assignments.length < 1 || plan.assignments.length > 6) throw new Error('Invalid plan')
      const seen = new Set()
      for (const a of plan.assignments) {
        if (!a || !eligible.has(a.staffId) || seen.has(a.staffId) || typeof a.task !== 'string' || !a.task.trim() || a.task.length > 8000) throw new Error('Invalid assignment')
        seen.add(a.staffId)
      }
      const drafts = []
      // Barrier: each initial draft receives only its own assignment and history.
      for (const a of plan.assignments) drafts.push({ staffId: a.staffId, output: await call(a.staffId, 'draft', { task: a.task }) })
      const reviews = []
      for (const a of plan.assignments) reviews.push({ staffId: a.staffId, output: await call(a.staffId, 'review', { task: a.task, drafts }) })
      const revisions = []
      for (const a of plan.assignments) revisions.push({ staffId: a.staffId, output: await call(a.staffId, 'revise', { task: a.task, ownDraft: drafts.find(d => d.staffId === a.staffId).output, reviews }) })
      const quality = await call('qa', 'quality', { revisions })
      run.result = await call('pm', 'final', { assignments: plan.assignments, revisions, quality })
      run.status = 'awaiting-human'; run.staffId = null; run.stage = 'final'
    } catch {
      run.status = controller.signal.aborted ? 'cancelled' : 'error'
      run.error = run.status === 'cancelled' ? '実行を中止しました。時間制限に達した場合も停止します。' : run.error || 'AI実行を完了できませんでした。接続状態・社員設定・出力形式を確認して再実行してください。'
      if (run.steps.at(-1)?.status === 'running') run.steps.at(-1).status = run.status
      run.staffId = null
    } finally { run.finishedAt = Date.now(); save(); notify(run) }
  }
  return {
    start({ projectId, request } = {}) {
      if (closed || active) throw new Error('現在は実行を開始できません。実行中の処理が終わるまでお待ちください。')
      if (!safeId(projectId) || typeof request !== 'string' || !request.trim() || request.length > 8000 || hasCredential(request)) throw new Error('依頼は機密情報を含めず、1〜8000文字で入力してください。')
      const id = randomUUID()
      const run = { id, projectId, request, status: 'queued', stage: null, staffId: null, steps: [], result: null, error: null, createdAt: Date.now() }
      const controller = new AbortController()
      active = { id, controller }; runs.set(id, run)
      if (runs.size > 20) runs.delete(runs.keys().next().value)
      const promise = Promise.resolve().then(() => workflow(run, controller)).catch(() => {
        run.status = 'error'; run.error = '設定または作業データを読み書きできませんでした。'; run.staffId = null; notify(run)
      }).finally(() => { active = null; promises.delete(id) })
      promises.set(id, promise)
      return publicRun(run)
    },
    getRun(id) { return runs.has(id) ? publicRun(runs.get(id)) : null },
    async waitForRun(id) { await promises.get(id); return runs.has(id) ? publicRun(runs.get(id)) : null },
    cancel(id) { if (active?.id === id) { active.controller.abort(); return true } return false },
    async close() { closed = true; active?.controller.abort(); await Promise.allSettled([...promises.values()]) },
  }
}
module.exports = { createStaffRuntime }
