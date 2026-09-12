'use strict'
const config = require('../config/maintenance-workflow.json')
function isMaintenanceSite(siteUrl) {
  try { return config.restrictedHosts.includes(new URL(siteUrl).hostname.toLowerCase()) } catch { return false }
}
function maintenanceEvidence(evidence) {
  const pages = Array.isArray(evidence.public?.pages) ? evidence.public.pages : []
  // Deliberately omit URLs/paths, titles, body, free-form findings and all Google data.
  // Opaque page numbers refer back to the local diagnostic report for human review.
  return {
    siteUrl: new URL(evidence.siteUrl).origin,
    generatedAt: typeof evidence.generatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.Z+-]+$/.test(evidence.generatedAt) ? evidence.generatedAt : null,
    public: { pages: pages.slice(0, 10).map((page, index) => ({
      url: `diagnostic-page:${index + 1}`,
      status: Number.isInteger(page.status) && page.status >= 100 && page.status <= 599 ? page.status : null,
      redirects: Array.isArray(page.redirects) ? page.redirects.length : null,
      headings: Object.fromEntries(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(key => [key, Array.isArray(page.headings?.[key]) ? page.headings[key].length : null])),
    })), facts: [], hypotheses: [], unknowns: [{ message: '技術保守用にHTTP応答・リダイレクト回数・見出し数のみ抽出。実表示・スマホ・未取得ページ・リンク全体は未確認。' }] },
    google: null,
  }
}
module.exports = { isMaintenanceSite, maintenanceEvidence }
