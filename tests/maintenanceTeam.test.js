import { it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createSeoStaffRuntime } = require('../scripts/seo-staff-runtime.cjs')
const { maintenanceEvidence, isMaintenanceSite } = require('../scripts/maintenance-scope.cjs')
const evidence = {
  siteUrl: 'https://school-jk-style.com/', generatedAt: '2026-09-12T00:00:00Z',
  public: { pages: [{ url: 'https://school-jk-style.com/private-path-marker', status: 404, title: 'excluded-title-marker', headings: { h1: ['excluded-heading-marker'] }, redirects: [{ from: 'excluded-redirect-marker' }], noindex: true }], facts: [{ message: 'excluded-fact-marker' }], hypotheses: [{ message: 'excluded-hypothesis-marker' }] },
  google: { analytics: [{ query: 'excluded-query-marker', clicks: 50 }], inspection: { indexingState: 'excluded-index-marker' } },
}
it('projects technical numbers only and rejects host lookalikes', () => {
  expect(isMaintenanceSite(evidence.siteUrl)).toBe(true)
  expect(isMaintenanceSite('https://school-jk-style.com.evil.test')).toBe(false)
  const projected = maintenanceEvidence(evidence)
  expect(JSON.stringify(projected)).not.toContain('marker')
  expect(projected.google).toBeNull()
  expect(projected.public.pages[0]).toMatchObject({ url: 'diagnostic-page:1', status: 404, redirects: 1, headings: { h1: null, h2: null } })
  expect(maintenanceEvidence({ ...evidence, public: { pages: [{ status: 'injected', redirects: 'injected', headings: {} }] } }).public.pages[0].status).toBeNull()
})
it('enforces technical scope with independent QA, separate history and Terra', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-team-test-'))
  fs.mkdirSync(path.join(root, 'config'))
  for (const name of ['staff.json', 'seo-workflow.json', 'maintenance-workflow.json']) fs.copyFileSync(path.resolve('config', name), path.join(root, 'config', name))
  const calls = []
  const runtime = createSeoStaffRuntime({ root, provider: async call => { calls.push({ ...call, input: JSON.parse(call.input) }); return `technical-result-${calls.length}` } })
  try {
    const run = await runtime.waitForRun(runtime.start({ projectId: 'p', evidence, mode: 'seo' }).id)
    expect(run.mode).toBe('maintenance'); expect(run.status).toBe('review-complete')
    expect(calls.map(c => c.staffId)).toEqual(['pm', 'dev', 'qa', 'dev', 'qa', 'pm'])
    expect(calls.every(c => c.instructions.includes('技術保守専用工程') && c.instructions.includes('アフィリエイト登録導線の最適化は対象外'))).toBe(true)
    expect(calls.every(c => c.execution.model === 'gpt-5.6-terra' && c.execution.reasoningEffort === 'medium')).toBe(true)
    expect(JSON.stringify(calls.map(c => c.input))).not.toContain('marker')
    expect(JSON.stringify(calls[2].input)).not.toContain('technical-result-2')
    expect(calls[2].input.ownHistory).toEqual([])
    expect(calls[3].input.evidence.independentQuality).toBe('technical-result-3')
    expect(calls[4].input.evidence.revised).toBe('technical-result-4')
    expect(new Set(calls.map(c => c.cwd)).size).toBe(3)
    const previous = calls[2].cwd
    const again = await runtime.waitForRun(runtime.start({ projectId: 'p', evidence }).id)
    expect(again.status).toBe('review-complete')
    expect(calls[8].cwd).not.toBe(previous); expect(calls[8].input.ownHistory).toEqual([])
    expect(fs.existsSync(path.join(root, '.office-work', 'seo-staff'))).toBe(false)
    expect(() => runtime.start({ projectId: 'p', evidence, execution: { model: 'gpt-6-astra' } })).toThrow()
  } finally { await runtime.close(); fs.rmSync(root, { recursive: true, force: true }) }
})
