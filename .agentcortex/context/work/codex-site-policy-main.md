# Site categories and draft permissions
Branch: main
Owner: codex-site-policy
Classification: feature
Current Phase: handoff
Checkpoint SHA: 810e6b5
## Session Info
site-policy-20260913. User explicitly selected minimum: categories, backend permission checks, general-site draft creation.
## Gate Evidence
Inventory: category/policy (selected), project credentials/draft (selected), wider article workflow/live edits/scheduling (future, disabled). Spec: docs/specs/site-policy.md.
## Evidence
Current WP transport hardcodes one host; credentials are global in-memory; generic staff API has no category guard. Existing draft journal prevents duplicate sends.
Final verification: `node node_modules/vitest/vitest.mjs run --maxWorkers=2` under normal Windows permissions: 146 files / 2,486 tests PASS (2026-09-13 20:35, 23.25s), including launcher, model/role isolation, DPAPI, policy and WP transport tests. Restricted sandbox rerun had two OS-backed failures (DPAPI and skill-context storage); normal-permission rerun resolved both without code changes.
`node node_modules/vite/bin/vite.js build`: PASS, 98 modules; existing configuration/export/chunk-size warnings only. `git diff --check`: PASS. No production WP write was used; general-site create/readback uses mocked transport. Browser validation is described in Handoff.
## Drift Log
None.
## Review
Verdict: PASS. Reviewed persisted policy enforcement at generic staff, SEO staff and WordPress entrypoints; immutable origin and restricted-host floor; per-project ephemeral WP connections; policy revision binding, write-ahead journal, no retry and readback. No publish/update/delete endpoint was added. General drafts remain escaped plain text only. Existing staff role and project memory isolation is retained.
## Handoff
Document: docs/specs/site-policy.md. Code: scripts/site-policy.cjs, scripts/wordpress-api.cjs, src/components/SiteSettingsPanel.jsx. Work log: this file.
Resume: General site users save confirmed category/permissions, enter project-specific WP credentials locally, review one proposal, then approve a separate draft. No live general-site credentials or site were provided for an actual write; mocked transport is the validation boundary. Google OAuth remains shared account-scoped, read-only; project property/results are separate. Automated AI-to-draft transfer, live edits, publication, rich HTML, scheduled work and separate simultaneous Google accounts remain out of scope.
Rollback: revert only this feature commit; retain ignored .office-work policy/proposal/history files and existing backups. New general drafts are never overwritten or deleted by rollback. Stop using new general-site proposals before running the old single-site version.
Browser evidence: real Office at 127.0.0.1:5173 showed the user's new project as unclassified with AI/draft disabled; legacy school-jk-style.com was restricted with neutral draft/technical permissions. Existing header and center workspace tabs remained visible. No live policy edit, credential entry, AI run or WordPress write was performed.
