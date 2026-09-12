# WordPress maintenance work log
Branch: main
Owner: codex-wordpress
Classification: feature
Current Phase: handoff
Checkpoint SHA: 28a253d
Recommended Skills: auth-security, api-design

## Session Info
wp-20260911: scoped general maintenance; no promotional work. Existing checkout retained by user request.
## Gate Evidence
Plan PASS: one feature, explicit scope approval, spec docs/specs/wordpress-maintenance-mode.md. Confidence 90/100: existing middleware pattern and fixed REST contract; live credentials/server behavior remain unverified.
## Evidence
Initial git status clean; HEAD 28a253d. Read existing SEO API/vault and staff origin guard. Official WordPress pages/auth references checked.
## Drift Log

Separate owner-prefixed main work log preserves the previous SEO session. Skill metadata-first lookup was missed before initial full auth/api skill reads; reuse cached constraints in later phases. Session-only credentials chosen to honor latest instruction not to change credential storage.
- Recovered stale Work Log lock on 2026-09-12T00:59:48.209435+00:00; prior_owner=codex-wordpress; prior_session=wp-20260911; reason=stale-time; lock=codex-wordpress-main.lock.json

## Skill Notes
Auth-security: validate authorization server-side on all routes; suppress upstream errors; never persist secrets. Application Password is existing remote authentication, not a new local account/password database.
API-design: bounded inputs/results; POST for creation; conflict for stale/duplicate approval; static errors; no arbitrary remote endpoint.
## Risks
Actual WordPress permissions/plugins may reject or alter drafts. Mark QA failures or uncertain outcomes truthfully; never resend automatically. No live test until human supplies existing credentials and approves exact neutral draft.
## Handoff
Code: scripts/wordpress-api.cjs, scripts/wordpress-transport.cjs, src/components/WordPressPanel.jsx, src/components/wordpressPanel.css; integration in vite.config.js/server.mjs/CorporationDashboard.jsx.
Spec: docs/specs/wordpress-maintenance-mode.md. Focused tests: tests/wordpressApi.test.js and tests/wordpressTransport.test.js.
Live credential entry and exact draft approval remain human actions. No remote WordPress requests have been made. No backup or credential file was accessed by this feature. Existing Google status was displayed as connected, read-only.

## Review
Verdict: PASS (local code review, not an independent agent review). Fixed source-ID confusion before presenting any disposable draft link; source read-back adds an explicit unchanged check. Whitelisted transport has no update/delete route, fixed HTTPS host, DNS pinning, verified CA and response deadline/size bounds. Approval requires persisted immutable payload hash; journal prevents retries after unknown outcomes. Credentials remain memory-only; all errors are static, no upstream logging. No AI execution claimed for rule-based QA. Persistent snapshots excluded by existing .office-work ignore.

## Verification Progress
2026-09-12: focused 10 tests PASS initially; full suite in restricted context had two Windows user-context failures. Re-run under normal user: 2471 tests / 140 files PASS. Two additional source preservation tests added afterward; final run pending.
Vite build PASS. Browser: neutral local project created; offline proposal displayed with before/after, risks and disabled save without connection. Right panel scroll confirmed visually at 1280x720; checkbox layout corrected. Office started successfully with existing launcher; original browser tab was stale after overnight stop, fresh local tab confirmed new UI. No real WordPress content loaded.

Final evidence: full suite 2473 tests / 140 files PASS (normal Windows user); Vite build PASS, git diff --check PASS. Launcher stop exited 0; start returned normal Office URL; browser reload retained neutral proposal, WordPress unconfigured, Google readonly connected. Live draft test is intentionally pending human connection and exact content approval. All remote WordPress transport tests used mocks.
