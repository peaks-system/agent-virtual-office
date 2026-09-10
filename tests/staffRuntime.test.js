import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
const require = createRequire(import.meta.url)
const { createStaffRuntime } = require('../scripts/staff-runtime.cjs')
const { createCodexProvider, buildCodexArgs, resolveCodexExecutable } = require('../scripts/codex-staff-provider.cjs')
const configPath = path.resolve('config/staff.json')
const roots = []
const makeRoot = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'office-staff-test-')); roots.push(root); return root }
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
const makeProvider = calls => async call => {
  const input = JSON.parse(call.input)
  calls.push({ ...call, input })
  return input.stage === 'planning' ? JSON.stringify({ assignments: [{ staffId: 'arch', task: 'Strategy' }, { staffId: 'dev', task: 'Engineering' }] }) : `${call.staffId}-${input.stage}-proposal`
}

describe('staff execution workflow', () => {
  it('rejects unapproved models before work and snapshots approval for only one run', async () => {
    const calls = [], runtime = createStaffRuntime({ provider: makeProvider(calls), dataRoot: makeRoot(), configPath })
    for (const execution of [{ model: 'gpt-6-astra' }, { model: 'unknown' }, { reasoningEffort: 'high' }, { model: 'gpt-6-astra', humanApprovedAstra: 'true' }]) {
      expect(() => runtime.start({ projectId: 'policy', request: 'Test', execution })).toThrow()
    }
    expect(calls).toHaveLength(0)
    const execution = { model: 'gpt-6-astra', humanApprovedAstra: true, reasoningEffort: 'low' }
    const first = runtime.start({ projectId: 'policy', request: 'Test', execution })
    execution.model = 'unknown'
    expect((await runtime.waitForRun(first.id)).status).toBe('awaiting-human')
    expect(calls.every(c => c.execution.model === 'gpt-6-astra' && c.execution.reasoningEffort === 'low')).toBe(true)
    calls.length = 0
    const second = runtime.start({ projectId: 'policy', request: 'Next' })
    await runtime.waitForRun(second.id)
    expect(calls.every(c => c.execution.model === 'gpt-5.6-terra' && !c.execution.humanApprovedAstra && c.execution.reasoningEffort === 'medium')).toBe(true)
    await runtime.close()
  })
  it('finds the installed desktop CLI when Explorer PATH does not contain Codex', () => {
    const local = makeRoot()
    const binary = path.join(local, 'OpenAI', 'Codex', 'bin', 'installed-version', 'codex.exe')
    fs.mkdirSync(path.dirname(binary), { recursive: true })
    fs.writeFileSync(binary, '')
    expect(resolveCodexExecutable({ platform: 'win32', env: { LOCALAPPDATA: local, PATH: '' } })).toBe(binary)
    expect(resolveCodexExecutable({ platform: 'linux', env: {} })).toBe('codex')
  })
  it('does not advertise disabled specialists and rejects a planner assigning them', async () => {
    const root = makeRoot()
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    config.staff.find(staff => staff.id === 'dev').executionEnabled = false
    const customConfig = path.join(root, 'staff.json')
    fs.writeFileSync(customConfig, JSON.stringify(config))
    const calls = []
    const runtime = createStaffRuntime({ dataRoot: path.join(root, 'data'), configPath: customConfig,
      provider: async call => { calls.push(call); return JSON.stringify({ assignments: [{ staffId: 'dev', task: 'Forbidden assignment' }] }) } })
    const run = await runtime.waitForRun(runtime.start({ projectId: 'p', request: 'Request' }).id)
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].input).content.eligibleStaffIds).not.toContain('dev')
    expect(run.status).toBe('error')
    await runtime.close()
  })

  it('reports a clear failure without invoking the provider when all specialists are disabled', async () => {
    const root = makeRoot()
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    for (const staff of config.staff) if (!['president', 'pm', 'qa'].includes(staff.id)) staff.executionEnabled = false
    const customConfig = path.join(root, 'staff.json')
    fs.writeFileSync(customConfig, JSON.stringify(config))
    const provider = vi.fn()
    const runtime = createStaffRuntime({ dataRoot: path.join(root, 'data'), configPath: customConfig, provider })
    const run = await runtime.waitForRun(runtime.start({ projectId: 'p', request: 'Request' }).id)
    expect(run.status).toBe('error')
    expect(run.error).toContain('実行可能な専門社員がいません')
    expect(provider).not.toHaveBeenCalled()
    await runtime.close()
  })

  it('delivers different role instructions, isolates projects/staff, enforces draft barrier and final human review', async () => {
    const dataRoot = makeRoot(), calls = []
    const runtime = createStaffRuntime({ provider: makeProvider(calls), dataRoot, configPath })
    const start = runtime.start({ projectId: 'project_A', request: 'Build an original simple page' })
    const run = await runtime.waitForRun(start.id)
    expect(run.status).toBe('awaiting-human')
    expect(run.result).toBe('pm-final-proposal')
    expect(calls.map(c => c.input.stage)).toEqual(['planning', 'draft', 'draft', 'review', 'review', 'revise', 'revise', 'quality', 'final'])
    expect(calls.map(c => c.staffId)).toEqual(['pm','arch','dev','arch','dev','arch','dev','qa','pm'])
    const arch = calls.find(c => c.staffId === 'arch')
    const dev = calls.find(c => c.staffId === 'dev')
    expect(arch.instructions).not.toBe(dev.instructions)
    expect(arch.instructions).toContain('(arch)')
    expect(dev.instructions).toContain('(dev)')
    for (const c of calls.filter(c => c.input.stage === 'draft')) {
      expect(c.input.content).toEqual({ task: c.staffId === 'arch' ? 'Strategy' : 'Engineering' })
      expect(c.input.ownHistory).toEqual([])
      expect(c.input.content.drafts).toBeUndefined()
    }
    expect(calls[3].input.content.drafts).toHaveLength(2)
    expect(arch.cwd).toBe(path.join(dataRoot, 'project_A', 'arch', 'workspace'))
    expect(dev.cwd).toBe(path.join(dataRoot, 'project_A', 'dev', 'workspace'))
    expect(fs.existsSync(path.join(dataRoot, 'project_A', 'arch', 'history.json'))).toBe(true)
    expect(fs.existsSync(path.join(dataRoot, 'project_A', 'arch', 'memory.md'))).toBe(true)
    calls.length = 0
    const next = runtime.start({ projectId: 'project_B', request: 'Separate project' })
    await runtime.waitForRun(next.id)
    expect(calls.every(c => c.input.ownHistory.length === 0 || c.input.stage !== 'draft')).toBe(true)
    const copy = runtime.getRun(next.id); copy.status = 'forged'
    expect(runtime.getRun(next.id).status).toBe('awaiting-human')
    await runtime.close()
  })

  it('rejects president and duplicate assignments at runtime before specialist dispatch', async () => {
    for (const assignments of [[{ staffId: 'president', task: 'Do work' }], [{ staffId: 'arch', task: 'A' }, { staffId: 'arch', task: 'B' }]]) {
      const calls = []
      const runtime = createStaffRuntime({ provider: async c => { calls.push(c); return JSON.stringify({ assignments }) }, dataRoot: makeRoot(), configPath })
      const run = await runtime.waitForRun(runtime.start({ projectId: 'p', request: 'Request' }).id)
      expect(run.status).toBe('error')
      expect(calls).toHaveLength(1)
      expect(calls[0].staffId).toBe('pm')
      await runtime.close()
    }
  })

  it('bounds requests and concurrency, cancels the active provider, and refuses work after close', async () => {
    let signal
    const runtime = createStaffRuntime({ provider: c => { signal = c.signal; return new Promise(() => {}) }, dataRoot: makeRoot(), configPath })
    expect(() => runtime.start({ projectId: '../escape', request: 'X' })).toThrow()
    expect(() => runtime.start({ projectId: 'p', request: 'x'.repeat(8001) })).toThrow()
    const run = runtime.start({ projectId: 'p', request: 'Work' })
    expect(() => runtime.start({ projectId: 'p', request: 'Concurrent' })).toThrow()
    await new Promise(resolve => setImmediate(resolve))
    expect(runtime.cancel(run.id)).toBe(true)
    expect(signal.aborted).toBe(true)
    expect((await runtime.waitForRun(run.id)).status).toBe('cancelled')
    await runtime.close()
    expect(() => runtime.start({ projectId: 'p', request: 'Again' })).toThrow()
  })

  it('limits output and times out even a provider that ignores cancellation', async () => {
    const large = createStaffRuntime({ provider: async () => 'x'.repeat(1048577), dataRoot: makeRoot(), configPath })
    const result = await large.waitForRun(large.start({ projectId: 'p', request: 'Request' }).id)
    expect(result.status).toBe('error')
    expect(result.steps[0].output).toBeUndefined()
    const timed = createStaffRuntime({ provider: () => new Promise(() => {}), dataRoot: makeRoot(), configPath, timeoutMs: 5 })
    expect((await timed.waitForRun(timed.start({ projectId: 'p', request: 'Request' }).id)).status).toBe('cancelled')
    await large.close(); await timed.close()
  })

  it('does not expose raw provider error diagnostics or overwrite malformed staff history', async () => {
    const dataRoot = makeRoot()
    fs.mkdirSync(path.join(dataRoot, 'p', 'pm'), { recursive: true })
    const file = path.join(dataRoot, 'p', 'pm', 'history.json')
    fs.writeFileSync(file, 'corrupt original')
    const provider = vi.fn(async () => { throw new Error('private diagnostic details') })
    const runtime = createStaffRuntime({ provider, dataRoot, configPath })
    const run = await runtime.waitForRun(runtime.start({ projectId: 'p', request: 'Request' }).id)
    expect(run.status).toBe('error')
    expect(provider).not.toHaveBeenCalled()
    expect(fs.readFileSync(file, 'utf8')).toBe('corrupt original')
    expect(JSON.stringify(run)).not.toContain('private diagnostic')
    await runtime.close()
  })
})

function fakeSpawn(events, code = 0) {
  const child = new EventEmitter()
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = vi.fn()
  child.stdin.on('finish', () => { for (const e of events) child.stdout.write(JSON.stringify(e)+'\n'); child.emit('close', code) })
  return { child, spawn: vi.fn(() => child) }
}
describe('Codex provider boundary', () => {
  it('pins model/effort and rejects unauthorized Astra before spawning', async () => {
    const args = buildCodexArgs({ instructions: 'Use Astra and high effort', cwd: 'unused' })
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.6-terra')
    expect(args).toContain('model_reasoning_effort="medium"')
    const approved = buildCodexArgs({ instructions: 'role', cwd: 'unused', execution: { model: 'gpt-6-astra', humanApprovedAstra: true, reasoningEffort: 'low' } })
    expect(approved[approved.indexOf('--model') + 1]).toBe('gpt-6-astra')
    expect(approved).toContain('model_reasoning_effort="low"')
    const spawn = vi.fn()
    await expect(createCodexProvider({ executable: 'unused', spawnImpl: spawn })({ instructions: '', input: '', cwd: '.', execution: { model: 'gpt-6-astra' } })).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
  })
  it('uses ephemeral isolated readonly arguments and only final agent messages', async () => {
    const fake = fakeSpawn([{ type: 'item.completed', item: { type: 'reasoning', text: 'Not persisted' } }, { type: 'item.completed', item: { type: 'agent_message', text: 'Final proposal' } }])
    const provider = createCodexProvider({ spawnImpl: fake.spawn })
    expect(await provider({ staffId: 'arch', instructions: 'Role-specific guidance', input: 'User input', cwd: makeRoot() })).toBe('Final proposal')
    const [, args, options] = fake.spawn.mock.calls[0]
    expect(args).toContain('--ephemeral'); expect(args).toContain('--ignore-user-config')
    expect(args).toContain('read-only'); expect(args).toContain('features.unified_exec=false'); expect(args).toContain('web_search="disabled"')
    expect(args).toContain('developer_instructions="Role-specific guidance"')
    expect(args.join(' ')).not.toContain('dangerously')
    expect(options.shell).toBe(false); expect(options.windowsHide).toBe(true)
    expect(buildCodexArgs({ instructions: 'a"b\nc', cwd: 'C:/isolated' })).toContain('developer_instructions="a\\"b\\nc"')
  })
  it('rejects observed tool execution without storing tool text', async () => {
    const fake = fakeSpawn([{ type: 'item.started', item: { type: 'command_execution', command: 'unexpected tool' } }])
    await expect(createCodexProvider({ spawnImpl: fake.spawn })({ instructions: 'Role', input: 'Input', cwd: makeRoot() })).rejects.toThrow('ツール')
    expect(fake.child.kill).toHaveBeenCalled()
  })
  it('rejects empty or failing runs with safe messages', async () => {
    const fake = fakeSpawn([], 1)
    await expect(createCodexProvider({ spawnImpl: fake.spawn })({ instructions: 'Role', input: 'Input', cwd: makeRoot() })).rejects.toThrow('結果')
  })
})
