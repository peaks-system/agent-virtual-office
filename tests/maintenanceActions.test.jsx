import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { it, expect } from 'vitest'
import { createRequire } from 'node:module'
import MaintenanceActionSummary from '../src/components/MaintenanceActionSummary'
const require = createRequire(import.meta.url)
const { createMaintenanceActions, matchingLinks } = require('../scripts/maintenance-actions.cjs')
const { maintenanceEvidence } = require('../scripts/maintenance-scope.cjs')

it('keeps only neutral links and ignores scripts, comments, foreign origins and fragments', () => {
  expect(matchingLinks('<script>"<a href="/contact/">"</script><!-- <a href="/contact/"> --><a href="https://other.test/contact/">x</a><a href="/contact/#top">x</a><a href="/%E3%81%8A%E5%95%8F%E3%81%84%E5%90%88%E3%82%8F%E3%81%9B/">x</a>')).toMatchObject({ '/contact/': 1, '/お問い合わせ/': 1 })
})
it('rejects other sites before transport; retains no source prose and reports real observations', async () => {
  const calls = []
  const run = createMaintenanceActions({ resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async (url, options) => { calls.push(url.href); expect(options.maxBytes).toBe(524288); return { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<p>DO NOT RETAIN</p><a href="/お問い合わせ/">text</a><a href="/privacy-policy/">text</a>') } },
    probe: async url => { calls.push(url); return { status: /contact|privacy-policy/.test(url) ? 200 : 404, checkedAt: '2026-09-13T00:00:00Z' } },
  })
  await expect(run('http://127.0.0.1/')).rejects.toThrow()
  expect(calls).toHaveLength(0)
  const result = await run('https://school-jk-style.com/')
  expect(calls).toHaveLength(5)
  expect(result.items.map(item => item.state)).toEqual(['change-needed', 'replacement-observed'])
  expect(JSON.stringify(result)).not.toContain('DO NOT RETAIN')
  expect(result.writerSupported).toBe(false)
  const projected = maintenanceEvidence({ siteUrl: 'https://school-jk-style.com/', maintenanceAction: result })
  expect(projected.public.facts).toHaveLength(2)
  expect(projected.public.facts[0].evidence).toContain('"oldAnchorCount":1')
  expect(JSON.stringify(projected)).not.toContain('/contact/')
  const html = renderToStaticMarkup(<MaintenanceActionSummary result={result} />)
  expect(html).toContain('あなたの承認待ちではありません')
  expect(html).toContain('/contact/')
  expect(html).toContain('今、何をすればよいか')
  expect(html).not.toContain('承認して実行')
})
it('does not call missing or redirected source a successful repair', async () => {
  const run = createMaintenanceActions({ resolve: async () => [{ address: '93.184.216.34', family: 4 }], request: async () => ({ status: 302, headers: { location: 'http://127.0.0.1/' }, body: Buffer.from('') }), probe: async () => ({ status: 200 }) })
  const result = await run('https://school-jk-style.com/')
  expect(result.source.inspected).toBe(false)
  expect(result.items.every(item => item.state === 'source-unknown' && item.oldLinks === null)).toBe(true)
})
