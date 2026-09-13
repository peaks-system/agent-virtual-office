import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { it, expect } from 'vitest'
import { createRequire } from 'node:module'
import MaintenanceReview, { describeMaintenancePage } from '../src/components/MaintenanceReview'
const require = createRequire(import.meta.url)
const { maintenanceEvidence } = require('../scripts/maintenance-scope.cjs')
it('does not apply HTML heading rules to legacy XML records or error responses', () => {
  const xml = { url: 'https://school-jk-style.com/post-sitemap.xml', status: 200, headings: { h1: [] } }
  expect(describeMaintenancePage(xml)).toMatchObject({ type: 'xml-candidate', headingCheck: false })
  const data = maintenanceEvidence({ siteUrl: 'https://school-jk-style.com/', public: { pages: [xml, { ...xml, contentType: 'text/html', status: 404 }, { ...xml, contentType: 'text/html', status: 200 }] } })
  expect(data.public.pages.map(p => p.headings.h1)).toEqual([null, null, 0])
  const checked = maintenanceEvidence({ siteUrl: 'https://school-jk-style.com/', public: { pages: [{ ...xml, headCheck: { status: 200, type: 'xml', checkedAt: '2026-09-13T00:00:00Z', method: 'GET', body: 'exclude-me' } }] } })
  expect(checked.public.pages[0].headCheck).toMatchObject({ status: 200, type: 'xml', method: 'HEAD' })
  expect(JSON.stringify(checked)).not.toContain('exclude-me')
})
it('renders actual URL mapping, nonapproval status and read-only next action for old reports', () => {
  const html = renderToStaticMarkup(<MaintenanceReview report={{ generatedAt: '2026-09-11T00:00:00Z', pages: [{ url: 'https://school-jk-style.com/お問い合わせ/', status: 404 }] }} checks={{ 0: { checkedAt: '2026-09-13T00:00:00Z', status: 404, type: 'html' } }} onCheck={() => {}} />)
  expect(html).toContain('お問い合わせのURL')
  expect(html).toContain('承認して実行できる修正案はまだありません')
  expect(html).toContain('このURLの応答を再確認')
  expect(html).toContain('HEAD方式')
  expect(html).not.toContain('承認して別の下書きに保存')
})
