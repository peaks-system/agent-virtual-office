import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import StaffApproval from '../src/components/StaffApproval'
const require = createRequire(import.meta.url)
const { createStaffRuntime } = require('../scripts/staff-runtime.cjs')
const { parseConfirmation } = require('../scripts/staff-confirmation.cjs')
const final = { report: 'Report', items: [{ question: 'Which evidence?', options: [{ label: 'First' }, { label: 'Second' }], recommended: '1', reason: 'Reason', risk: 'Risk' }] }
const configPath = path.resolve('config/staff.json')
describe('staff decisions', () => {
  it('validates PM format, leaving legacy output explicitly unstructured', () => {
    expect(parseConfirmation(JSON.stringify(final)).items).toHaveLength(1)
    expect(parseConfirmation('Legacy report').fallback).toBe(true)
    expect(parseConfirmation(JSON.stringify({ ...final, items: [{ ...final.items[0], recommended: '99' }] })).fallback).toBe(true)
  })
  it('renders actionable controls, recommendation, risk and separate WordPress boundary', () => {
    const html = renderToStaticMarkup(<StaffApproval run={{ id: 'x', confirmation: parseConfirmation(JSON.stringify(final)) }} />)
    for (const label of ['承認して追加調査へ進む', '修正を依頼', '却下', 'PM推奨', 'Risk', 'WordPress変更は別承認', '自己申告']) expect(html).toContain(label)
  })
  it('persists decisions, rejects duplicates, scopes projects and passes choices without Astra inheritance', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-decisions-'))
    const calls = []
    const provider = async call => { calls.push(call); const { stage } = JSON.parse(call.input); return stage === 'planning' ? JSON.stringify({ assignments: [{ staffId: 'dev', task: 'Review' }] }) : stage === 'final' ? JSON.stringify(final) : 'Evidence' }
    let runtime = createStaffRuntime({ provider, dataRoot: root, configPath })
    try {
      const run = await runtime.waitForRun(runtime.start({ projectId: 'one', request: 'Review', execution: { model: 'gpt-6-astra', humanApprovedAstra: true } }).id)
      const body = { action: 'approve', actor: 'Local', feedback: '', selections: { '1': '2' } }
      expect(() => runtime.decide(run.id, 'other', body)).toThrow()
      expect(() => runtime.decide(run.id, 'one', { ...body, selections: {} })).toThrow()
      const result = runtime.decide(run.id, 'one', body)
      expect(result.next.execution.model).toBe('gpt-5.6-terra')
      expect(() => runtime.decide(run.id, 'one', body)).toThrow()
      const next = await runtime.waitForRun(result.next.id)
      expect(next.request).toContain('Second')
      expect(next.parentRunId).toBe(run.id)
      const beforeReject = calls.length
      runtime.decide(next.id, 'one', { ...body, action: 'reject' })
      expect(calls).toHaveLength(beforeReject)
      await runtime.close()
      runtime = createStaffRuntime({ provider, dataRoot: root, configPath })
      expect(runtime.getRun(run.id, 'one').decision.nextRunId).toBe(next.id)
      expect(runtime.getRun(next.id, 'one').decision.action).toBe('reject')
      expect(runtime.getRun(run.id, 'other')).toBeNull()
      expect(() => runtime.decide(run.id, 'one', body)).toThrow()
      const fresh = await runtime.waitForRun(runtime.start({ projectId: 'one', request: 'Review again' }).id)
      expect(() => runtime.decide(fresh.id, 'one', { ...body, action: 'revise' })).toThrow()
      const revised = runtime.decide(fresh.id, 'one', { ...body, action: 'revise', feedback: 'Clarify evidence' })
      const revisedRun = await runtime.waitForRun(revised.next.id)
      expect(revisedRun.request).toContain('Clarify evidence')
    } finally { await runtime.close(); fs.rmSync(root, { recursive: true, force: true }) }
  })
})
