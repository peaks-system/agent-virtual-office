# WordPress single-page maintenance

Status: Implemented and locally verified; live connection/approval pending. Owner: codex-wordpress. Scope approved 2026-09-11.

## Contract
One neutral information/test page at https://school-jk-style.com only. The user enters a numeric source page ID (optional for a new test page), plain-text title/body and reason. The server snapshots the selected page, freezes before/after and returns an immutable proposal hash. A separate explicit approval submits that hash. The only remote mutation is POST /wp-json/wp/v2/pages with status=draft and closed comments/pings. No updates, publication, deletion, plugins, themes, users, affiliate fields or SEO optimization. Existing source pages, backup directory and Google credentials are untouched.

WordPress REST Application Password authentication requires HTTPS. For this minimum implementation, existing credentials are supplied through masked local fields and held in server memory only until Office stops; no credential file is created or changed. No credential management API. Configure only when no proposal is executing. Never return upstream errors, response bodies or credentials in errors. Existing localhost/origin authorization protects all endpoints. The user performs any credential creation themselves after separate explanation. Application passwords inherit account capabilities; Office's narrower endpoint restrictions are not a server-side WordPress capability restriction.

## API and safety
GET /api/wordpress/projects/:id: bounded proposal/history and connection boolean.
POST /api/wordpress/connection: session-only existing credentials.
POST /api/wordpress/projects/:id/proposals: {sourceId?, title, content, reason, neutral:true}.
POST /api/wordpress/projects/:id/approvals: {id, hash, approved:true}.
At most 50 proposals per project, 100 projects; text body <=8000 characters, request <=32768 bytes, API response <=256 KiB. Exact HTTPS host, public DNS pinned for each request, certificate verification, no redirects, 10-second total request deadline including DNS. GET only one selected page, no crawling. A global single-flight mutation guard prevents concurrent writes/configuration. Persist 'sending' before POST; interrupted/uncertain writes cannot be retried automatically, even across restarts. Use unique proposal slug for manual reconciliation. Check source hash before sending; stale source requires new proposal. Persist confirmed draft ID before read-back QA. Do not resend after QA failure. Local proposal snapshots are under ignored .office-work/wordpress, atomically written with symlink and size checks.

## UI and verification
Japanese project panel: connection explanation, neutral-content acknowledgement, before/after, reason/effect/risk, explicit draft approval, result/history and manual trash instructions. Plain text is escaped into paragraphs; no arbitrary HTML, shortcodes or embeds. Existing source HTML is displayed as escaped text, never executed. Automated QA reads the resulting draft and checks status, exact title/body, paragraph-only markup. Visual/mobile appearance, theme metadata, canonical/noindex and structured data are explicitly unverified and require authenticated WordPress preview. Do not label deterministic checks as AI staff execution. No model calls are made by this minimum feature; existing Terra policy is unchanged.

Tests: wrong origin, approval hash, stale source, duplicate approval, restart after uncertain send, read-back failure, public/private DNS, redirect refusal, payload whitelist, source untouched. Build and local UI check without remote writes. Live WordPress test awaits human connection and approval; use neutral test text only.

Rollback: revert feature commit to remove integration. Original remote page is never changed. User can manually trash the newly created draft using recorded ID; uncertain results require checking the unique slug first. Never access the pre-existing migration backup.

References: https://developer.wordpress.org/rest-api/reference/pages/ and https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/.

## Verification receipt (2026-09-12)
140 test files / 2473 tests pass under normal Windows user context; Vite build passes. Real Office browser verified offline neutral proposal, persistent history after launcher stop/start, readonly Google connection retained, and disabled draft submission without connection. No real WordPress write or credential configuration performed. Actual theme/mobile/metadata checks remain manual and visibly unverified. Code rollback baseline: 28a253d; use an ordinary revert of the feature commit, preserving ignored proposal records and existing credential/backup storage.
