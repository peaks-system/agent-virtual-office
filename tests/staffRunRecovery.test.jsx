import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect, vi, afterEach } from 'vitest'
import StaffWorkPanel from '../src/components/StaffWorkPanel'
import { lookupStaffRun, staffStartBlocked } from '../src/systems/staffRunRecovery'

const project = { id: 'project-a', title: 'Test' }
const settings = { category: 'general', permissions: { ai: true } }
const base = { project, settings, request: '調査してください', astraReason: '', runId: 'old', lookup: 'checking', run: null }
const response = (status, run) => async () => ({ status, ok: status === 200, json: async () => run })
afterEach(() => vi.unstubAllGlobals())
describe('persisted staff run recovery', () => {
  it('shows reset and lookup explanation on reload before results or errors exist', () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'old') })
    for (let reload = 0; reload < 2; reload++) {
      const html = renderToStaticMarkup(<StaffWorkPanel project={project} settings={settings} />)
      expect(html).toContain('実行表示をリセット')
      expect(html).toContain('staff-start-reason')
      expect(html).toContain('処理の中止や成果物の削除は行いません')
    }
    expect(localStorage.getItem).toHaveBeenCalledWith('office-staff-active-run:project-a')
  })
  it('allows a general investigation without WordPress after display reset', () => {
    expect(staffStartBlocked({ ...base, runId: null })).toBe('')
    expect(staffStartBlocked(base)).toContain('実行IDを確認')
  })
  it('handles nonexistent IDs without trapping the start button', async () => {
    const state = await lookupStaffRun('old', project.id, { fetcher: response(404) })
    expect(state.lookup).toBe('missing')
    expect(staffStartBlocked({ ...base, ...state })).toBe('')
  })
  it.each(['awaiting-human', 'error', 'cancelled'])('accepts terminal %s records after reload', async status => {
    const state = await lookupStaffRun('old', project.id, { fetcher: response(200, { id: 'old', projectId: project.id, status }) })
    expect(staffStartBlocked({ ...base, ...state })).toBe('')
  })
  it.each(['queued', 'running'])('retains active %s protection', async status => {
    const state = await lookupStaffRun('old', project.id, { fetcher: response(200, { id: 'old', projectId: project.id, status }) })
    expect(staffStartBlocked({ ...base, ...state })).toContain('実行中')
  })
  it('bounds a hung request and allows explicit reset without assuming cancellation', async () => {
    const state = await lookupStaffRun('old', project.id, { fetcher: () => new Promise(() => {}), timeoutMs: 5 })
    expect(state.lookup).toBe('unavailable')
    expect(staffStartBlocked({ ...base, ...state })).toContain('再確認')
    expect(staffStartBlocked({ ...base, ...state, runId: null })).toBe('')
  })
  it('does not expose another project or malformed response', async () => {
    for (const run of [{ id: 'old', projectId: 'other', status: 'running' }, {}]) {
      expect((await lookupStaffRun('old', project.id, { fetcher: response(200, run) })).lookup).toBe('unavailable')
    }
  })
  it('explains category and permission blocks', () => {
    expect(staffStartBlocked({ ...base, settings: { category: 'unclassified' } })).toContain('一般サイト')
    expect(staffStartBlocked({ ...base, settings: { ...settings, permissions: {} } })).toContain('許可')
  })
})
