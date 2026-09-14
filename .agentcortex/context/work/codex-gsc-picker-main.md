# Search Console property picker repair
Branch: main
Owner: codex-gsc-picker
Classification: hotfix
Current Phase: test
Checkpoint SHA: dae39ab
## Session Info
gsc-picker-20260914. Existing skills: frontend-patterns, auth-security. Confidence: 95%; existing readonly sites endpoint and project settings available.
## Gate Evidence
Scope: restore discoverable picker in Site Settings, property-only project save, consistent coverage validation and Japanese errors. No OAuth scope/storage or WP change. docs/specs/site-policy.md is canonical spec.
## Evidence
SiteSettingsPanel only exposes manual input; SeoPanel still has a hidden connected-only list. site-policy only permits exact origin/domain, unlike Google's subdomain coverage.
Final validation: `node node_modules/vitest/vitest.mjs run --maxWorkers=2` PASS, 147 files / 2,489 tests, 2026-09-14 10:18 (normal Windows permissions). New picker integration covers list/match/select/property-only save/reload, separate projects, restricted-policy preservation, invalid permission, stale selection, disconnected/forbidden and manual fallback. `node node_modules/vite/bin/vite.js build` PASS (existing export/config/chunk warnings); `git diff --check` PASS.
## Drift Log
None.
## Review
Verdict: PASS. Coverage validation rejects host suffix attacks and scheme/path mismatches; no OAuth scope or credential store changes; selected identifiers are not normalized/reconstructed. Property-only writes preserve WP execution revision and category. Per-project immutable origins and separate files remain. Manual fallback deliberately does not claim verified account permissions. Google result rows are restricted to registered origin when using parent domain properties.
## Browser
Live Office Site Settings shows the new list button and Japanese not-connected guidance. The current runtime reports Google not connected; no reauthorization, credentials or production site settings were changed. Successful list/save/reload is exercised by API fixtures, not claimed as a live Google approval.
## Plan
Add pure property coverage helper, annotate sites by saved project URL, add explicit property-only save without changing category/permissions, keep manual fallback. Test list/failure/match/persistence/two-project isolation and build/live UI. Revert this commit for rollback; retain ignored settings and OAuth storage.
