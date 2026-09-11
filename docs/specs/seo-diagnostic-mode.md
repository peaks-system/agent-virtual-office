# SEO diagnostic mode

Classification: architecture-change. Single feature, user-approved scope 2026-09-10.

## Acceptance criteria
- AC1: Register a site URL per project. Read-only crawl records HTTP/redirects, robots, sitemap, noindex, canonical, title/description/headings, sampled internal broken links, rendering obstacles and thin/duplicate candidates.
- AC2: Exact registered hostname, HTTP(S) standard ports only. Block private/local/reserved addresses and credentials; validate each redirect and DNS result, pin vetted IP at connection time. Bound pages, requests, duration and bytes; no scripts/cookies/auth/site mutations.
- AC3: Japanese facts, hypotheses and unknowns separately, with evidence and scope/limits. Public fetch cannot prove Google indexing or ranking; no guarantees.
- AC4: Google desktop OAuth code+S256 PKCE/state, external browser, single-use expiring loopback callback. Only webmasters.readonly scope. Credentials stay backend memory/encrypted Windows DPAPI outside Git; never public API payloads/logs/prompts. No plaintext fallback.
- AC5: Read permitted sites, bounded search analytics, sitemaps and URL Inspection fields. Validate chosen property covers project URL and belongs to connected account. No writes/indexing requests.
- AC6: Dedicated fixed sequence res -> arch -> dev -> qa -> pm. Selective evidence/proposals per stage, shared role prompts and separate staff state; Terra low/medium default and human-only Astra exception retained.
- AC7: Existing project page adds URL, public audit, Google connect/status/property/data, results and AI request. No new setup of existing office. OAuth prerequisite/consent requires human interaction and is honestly unverified until granted.
- AC8: Regression/security tests, build, local UI and harmless live public audit verified; launch/license/history preserved.

## Architecture and contracts
- Public crawler: scripts/seo-crawler.cjs exports auditSite(siteUrl, options?), normalizeSiteUrl, safe public transport. Result {siteUrl, generatedAt, limits, usage, pages, facts, hypotheses, unknowns}; finding {message,url,evidence?}.
- Google: scripts/search-console.cjs exports createSearchConsole({vault?,openBrowser?,fetchImpl?}); methods status(), configure(installedClientJson), connect(), sites(), diagnose({siteUrl,property}), disconnect(), close(). Public returns are sanitized data only. scripts/seo-vault.cjs provides encrypted local storage.
- Root SEO API uses existing same-origin loopback authorization. POST projects/:id/site, POST projects/:id/audits, GET projects/:id, POST google/configuration, POST google/connection, GET google/status/sites, POST projects/:id/google, POST projects/:id/proposals. Poll async public audits. Per-server one crawl and bounded state; outputs private ignored storage.
- Dedicated AI service exports createSeoStaffRuntime({root,provider?}) with start({projectId,evidence,execution}), getRun(id), close(). Evidence is built from stored server results, never arbitrary client credentials. Config/seo-workflow.json contains Japanese stage prompts. Returns standard run shape for UI stages/results.

## Design
Add a Japanese SEO section under the selected project's normal editor, above general AI requests. Existing three-column white office retained. Compact URL form, two-stage buttons, status, bounded results sections, and explicit AI transmission/action button. Explain no verified Google state before OAuth/inspection, and no external mutations. OAuth client import uses file input without displaying contents. Default connection uses system browser; never embedded Google login.

## Validation and rollback
Mock adversarial network/DNS/redirects and OAuth/refresh/scope/replay; real DPAPI with nonsensitive marker; no real secrets in tests. Revert feature commit to undo code, retain .office-work/browser backup and encrypted local vault. No Git reset/clean or ignored-file deletion.
