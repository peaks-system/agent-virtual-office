import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createSeoStaffRuntime } = require('../scripts/seo-staff-runtime.cjs')
const roots = []
const makeRoot = () => { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-staff-')); roots.push(root); fs.mkdirSync(path.join(root, 'config'), { recursive: true }); fs.copyFileSync(path.resolve('config/staff.json'), path.join(root, 'config/staff.json')); fs.copyFileSync(path.resolve('config/seo-workflow.json'), path.join(root, 'config/seo-workflow.json')); return root }
const evidence = () => ({ siteUrl: 'https://example.test/', generatedAt: '2026-09-10T00:00:00Z', public: { facts: [{ message: 'robots found', url: 'https://example.test/robots.txt' }], hypotheses: [{ message: 'thin pages may exist' }], unknowns: [{ message: 'index state is unavailable' }], pages: [{ url: 'https://example.test/', status: 200, redirects: [{ from: 'http://example.test/', to: 'https://example.test/', status: 301 }], title: 'Example', headings: { h1: ['Heading'] } }], limits: { pages: 10, durationMs: 30000, requestMs: 5000, responseBytes: 512000, totalBytes: 3000000 }, usage: { requests: 3, bytes: 99 } }, google: { analytics: [{ query: 'example', clicks: 2, impressions: 20 }], sitemaps: [{ path: 'https://example.test/sitemap.xml', lastSubmitted: '2026-09-01', isPending: false }], inspection: { verdict: 'PASS', coverageState: 'Submitted and indexed', robotsTxtState: 'ALLOWED', indexingState: 'INDEXING_ALLOWED', lastCrawlTime: '2026-09-09', pageFetchState: 'SUCCESS', googleCanonical: 'https://example.test/', userCanonical: 'https://example.test/', sitemap: 'https://example.test/sitemap.xml' }, facts: [{ message: 'property read-only' }], unknowns: [{ message: 'sampled data only' }], property: 'sc-domain:example.test' } })
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

describe('SEO staff runtime', () => {
  it('runs the fixed five-person sequence with selective evidence and isolated staff state', async () => {
    const calls = [], root = makeRoot()
    const runtime = createSeoStaffRuntime({ root, provider: async call => { calls.push({ ...call, input: JSON.parse(call.input) }); return `${call.staffId}:${calls.length}` } })
    const queued = runtime.start({ projectId: 'site_1', evidence: evidence() })
    expect(queued.status).toBe('queued')
    const run = await runtime.waitForRun(queued.id)
    expect(run.status).toBe('awaiting-human')
    expect(calls.map(call => call.staffId)).toEqual(['res', 'arch', 'dev', 'qa', 'pm'])
    expect(calls.map(call => call.input.seoStage)).toEqual(['research', 'strategy', 'technical', 'quality', 'final'])
    expect(calls.every(call => call.staffId !== 'president')).toBe(true)
    expect(new Set(calls.map(call => call.instructions)).size).toBe(5)
    expect(calls[0].input.evidence).toEqual(expect.objectContaining({ scope: expect.any(Object), public: expect.any(Object), google: expect.objectContaining({ facts: evidence().google.facts, unknowns: evidence().google.unknowns }) }))
    expect(calls[0].input.evidence.public.pages[0]).toEqual(expect.objectContaining({ redirects: [{ from: 'http://example.test/', to: 'https://example.test/', status: 301 }], headings: { h1: ['Heading'] } }))
    expect(calls[1].input.evidence).toEqual(expect.objectContaining({ research: 'res:1', queryMetrics: evidence().google.analytics }))
    expect(calls[2].input.evidence).toEqual(expect.objectContaining({ pages: evidence().public.pages, inspection: evidence().google.inspection, sitemaps: evidence().google.sitemaps, strategy: 'arch:2' }))
    expect(calls[3].input.evidence).toEqual(expect.objectContaining({ public: expect.any(Object), google: expect.objectContaining({ inspection: evidence().google.inspection }), proposals: expect.any(Object) }))
    expect(calls[4].input.evidence).toEqual(expect.objectContaining({ review: 'qa:4', findings: expect.any(Object) }))
    expect(calls[0].instructions).toContain('(res)'); expect(calls[1].instructions).toContain('SEO専用工程')
    expect(calls.every(call => call.execution.model === 'gpt-5.6-terra' && call.execution.reasoningEffort === 'medium')).toBe(true)
    expect(fs.existsSync(path.join(root, '.office-work', 'seo-staff', 'site_1', 'res', 'history.json'))).toBe(true)
    await runtime.close()
  })

  it('enforces approval, evidence/output limits, and never forwards credential-shaped data', async () => {
    const root = makeRoot(), providerCalls = [], provider = async call => { providerCalls.push(call); return 'ok' }
    const runtime = createSeoStaffRuntime({ root, provider })
    expect(() => runtime.start({ projectId: '../escape', evidence: evidence() })).toThrow()
    expect(() => runtime.start({ projectId: 'p', evidence: evidence(), execution: { model: 'gpt-6-astra' } })).toThrow()
    expect(() => runtime.start({ projectId: 'p', evidence: { ...evidence(), token: 'never' } })).toThrow()
    expect(() => runtime.start({ projectId: 'p', evidence: { ...evidence(), public: { ...evidence().public, facts: [{ message: 'api_key=long-secret-value' }] } } })).toThrow()
    expect(providerCalls).toHaveLength(0)
    for (const message of ['client_secret=example-marker', 'refresh_token=example-marker', 'id_token=example-marker', 'Authorization: Bearer example-marker', 'client_id%3Dexample-marker']) {
      expect(() => runtime.start({ projectId: 'p', evidence: { ...evidence(), public: { ...evidence().public, facts: [{ message }] } } })).toThrow()
    }
    expect(providerCalls).toHaveLength(0)
    const approved = await runtime.waitForRun(runtime.start({ projectId: 'approved', evidence: evidence(), execution: { model: 'gpt-6-astra', humanApprovedAstra: true, reasoningEffort: 'low' } }).id)
    expect(approved.status).toBe('awaiting-human')
    expect(providerCalls.every(call => call.execution.model === 'gpt-6-astra' && call.execution.reasoningEffort === 'low' && call.execution.humanApprovedAstra)).toBe(true)
    const large = createSeoStaffRuntime({ root: makeRoot(), provider: async () => 'x'.repeat(1024 * 1024 + 1) })
    expect((await large.waitForRun(large.start({ projectId: 'p', evidence: evidence(), execution: { model: 'gpt-6-astra', humanApprovedAstra: true, reasoningEffort: 'low' } }).id)).status).toBe('error')
    await runtime.close(); await large.close()
  })

  it('allows one queued run only and removes a cancelled queued run', async () => {
    const runtime = createSeoStaffRuntime({ root: makeRoot(), provider: () => new Promise(() => {}) })
    const first = runtime.start({ projectId: 'one', evidence: evidence() })
    expect(() => runtime.start({ projectId: 'two', evidence: evidence() })).toThrow('already running')
    expect(runtime.cancel(first.id)).toBe(true)
    expect((await runtime.waitForRun(first.id)).status).toBe('cancelled')
    await runtime.close()
  })
})
