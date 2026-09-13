# Scoped technical maintenance team

Status: implemented and verified. User approved technical-only autonomous collaboration for the designated site on 2026-09-12. A single button starts bounded work; no scheduled/background monitoring is implied.

Server-enforced host policy selects maintenance automatically, ignoring client mode claims. Existing SEO runtime is reused with a separate config and memory/workspace root. Extract at most 10 anonymous page references, HTTP status, redirect count and heading counts from existing diagnostic records. Never send page prose, URLs/paths, titles, queries, analytics, index data or free-form findings. No new crawling needed.

Fixed minimal team: PM plan; developer independent draft; QA independent draft without developer output; developer revision with QA feedback; QA final review; PM final integration. Initial QA receives neither current developer draft nor prior-run memory/history. Per-run isolation for maintenance prevents old SEO context contamination and independent-review leakage. All steps use existing readonly provider and model policy (Terra low/medium, Astra only explicit approval). No WordPress credentials or mutation interface are available to the team. Output stops awaiting human. Existing draft flow is separate and still requires exact per-proposal approval; no automatic publication or write.

UI distinguishes maintenance from SEO, explains the reduced evidence and six stages, maps anonymous page numbers to existing local report URLs for the human, and does not portray previous SEO output as a maintenance result. Prompts remain in config/maintenance-workflow.json. Rollback: revert this feature commit; ignored local run history remains intact. Existing WordPress draft 37 successfully saved/read back and preview approved by user before this work.

Acceptance: protected host cannot run SEO strategy; no marketing/president roles; QA initial input excludes developer answer; isolated workspaces/history; restricted text/Google data absent; no changes to draft approval or readonly credentials; bounded automatic progression to awaiting-human. Unit/mock tests, build, local UI verification. Live AI execution may be tested with neutral synthetic technical observations only and clearly identified as a smoke test.

Verification: 2475 tests / 141 files pass; build passes; real Terra low executes all six stages to awaiting-human on synthetic observations. Local browser confirms technical-only labeling. No additional live WordPress write, crawl or credential configuration performed. Original scope remains limited: this feature reviews stored mechanical observations; it does not autonomously browse, continuously monitor or generate unsupported source edits.

## Result correction (2026-09-13)
Maintenance completion now uses review-complete, not awaiting-human: advisory prose is not an executable change. Legacy completed reports receive the corrected UI without rerunning AI. Deterministic URL/reference cards explain observations, evidence age, missing facts and available actions; raw AI text is secondary and not an executable instruction. No fabricated approval button or automatic draft conversion.

Crawler records response Content-Type. Projection distinguishes confirmed HTML, XML, extension-derived candidates and unknown resources. Heading counts are usable only for HTTP200 confirmed HTML; XML and error-page heading counts are null. This corrects the mistaken treatment of sitemap XML as pages missing headings.

POST /api/seo/projects/:id/checks accepts pageIndex and exact report generatedAt, never a caller-supplied URL. The saved same-origin HTTPS URL is checked using bounded HEAD only (10 seconds, 16KiB headers, no redirects/auth/body, DNS public validation/pinning, TLS verification). New checks retain method/time separately from old GET facts and flow into later AI review. Full audits clear old checks. Existing report data is not silently rewritten. UI offers recheck and re-review, explaining that neither is a site modification.

Live header observations Sept13: record2 returned HTTP200 XML; record6 contact and record8 privacy paths returned HTTP404 HTML. No body was read, no WordPress mutation occurred. A concrete content or redirect fix remains unimplemented and must not be described as ready for approval.
