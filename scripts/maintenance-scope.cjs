'use strict'
const config = require('../config/maintenance-workflow.json')
const { resourceKind } = require('./maintenance-resource.mjs')
function isMaintenanceSite(siteUrl) {
  try { return config.restrictedHosts.includes(new URL(siteUrl).hostname.toLowerCase()) } catch { return false }
}
function maintenanceEvidence(evidence) {
  const pages = Array.isArray(evidence.public?.pages) ? evidence.public.pages : []
  const neutralLinks = (Array.isArray(evidence.maintenanceAction?.items) ? evidence.maintenanceAction.items : []).filter(item => ['contact', 'privacy'].includes(item.key)).slice(0, 2).map(item => {
    const number = value => Number.isInteger(value) && value >= 0 && value <= 100000 ? value : null
    return { message: item.key === 'contact' ? 'お問い合わせリンクの機械的点検。編集元は未特定・自動修正未対応。人間の承認待ちではありません。' : 'プライバシーポリシーリンクの機械的点検。編集元は未特定・自動修正未対応。人間の承認待ちではありません。', evidence: JSON.stringify({ oldHttp: number(item.beforeCheck?.status), targetHttp: number(item.afterCheck?.status), oldAnchorCount: number(item.oldLinks), targetAnchorCount: number(item.newLinks), sourceInspected: evidence.maintenanceAction.source?.inspected === true, checkedAt: /^\d{4}-\d{2}-\d{2}T[\d:.Z+-]+$/.test(evidence.maintenanceAction.checkedAt || '') ? evidence.maintenanceAction.checkedAt : null }) }
  })
  // Deliberately omit URLs/paths, titles, body, free-form findings and all Google data.
  // Opaque page numbers refer back to the local diagnostic report for human review.
  return {
    siteUrl: new URL(evidence.siteUrl).origin,
    generatedAt: typeof evidence.generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.Z+-]+$/.test(evidence.generatedAt) ? evidence.generatedAt : null,
    public: { pages: pages.slice(0, 10).map((page, index) => ({
      url: `diagnostic-page:${index + 1}`,
      type: resourceKind(page.url, page.contentType),
      headCheck: page.headCheck && Number.isInteger(page.headCheck.status) && page.headCheck.status >= 100 && page.headCheck.status <= 599 ? {
        status: page.headCheck.status,
        type: ['html', 'xml', 'xml-candidate', 'asset', 'asset-candidate', 'unknown'].includes(page.headCheck.type) ? page.headCheck.type : 'unknown',
        checkedAt: typeof page.headCheck.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.Z+-]+$/.test(page.headCheck.checkedAt) ? page.headCheck.checkedAt : null,
        method: 'HEAD',
      } : null,
      status: Number.isInteger(page.status) && page.status >= 100 && page.status <= 599 ? page.status : null,
      redirects: Array.isArray(page.redirects) ? page.redirects.length : null,
      headings: Object.fromEntries(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(key => [key, resourceKind(page.url, page.contentType) === 'html' && page.status === 200 && Array.isArray(page.headings?.[key]) ? page.headings[key].length : null])),
    })), facts: neutralLinks, hypotheses: [], unknowns: [{ message: '技術保守用に機械的なHTTP応答・リダイレクト回数・見出し数・中立的なリンク点検のみ抽出。実表示・スマホ・未取得ページ・リンク全体は未確認。' }] },
    google: null,
  }
}
module.exports = { isMaintenanceSite, maintenanceEvidence, resourceKind }
