# OAuth browser navigation repair
Branch: main
Owner: codex-oauth-window
Classification: hotfix
Current Phase: test
Checkpoint SHA: 8046d34
## Session Info
oauth-window-20260914. Confidence: 95%. Reuse auth-security and frontend-patterns.
## Gate Evidence
Search-console.cjs acknowledges OS dispatch, not visible browser navigation; SeoPanel disables connect while pending and has no reopen/cancel. User explicitly requests repair.
## Plan
Use a same-origin user-activated top-level local redirect to Google authorization instead of relying on an OS launcher. Keep state/PKCE/TTL and readonly scope; URL stays server-side until standard redirect. Allow reopen/cancel without disconnecting stored tokens. Verify navigation boundary and mocked OAuth lifecycle; no real approval on user's behalf.
## Evidence
Live Chrome: clicking the new Office link opened a separate Google account login tab; verified only title and Google origin, never printed the OAuth URL. Left the tab for human approval. Focused tests: 13 PASS; build PASS. Existing OS dispatch remains for API compatibility but the UI uses browser-native navigation.
Final: full Vitest PASS 147 files / 2,491 tests (2026-09-14 19:54, normal Windows permissions); build PASS; diff whitespace check PASS. Real Google approval remains a human step, not claimed complete.
## Review
Verdict: PASS. Authorization redirect requires same-origin, user-activated top-level document navigation after existing local/token authorization. OAuth state, PKCE, TTL and fixed readonly scope retained. Cancel closes only pending callback; stored tokens/configuration untouched. Reopening reuses an unexpired unconsumed attempt; expired requests cannot redirect. No raw OAuth URL returned in JSON or page content.
## Drift Log
None.
## Rollback
Revert the repair commit. Retain OAuth vault and project settings; no backup or production WordPress writes.
