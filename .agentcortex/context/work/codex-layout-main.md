# Dashboard visibility correction
Branch: main
Owner: codex-layout
Classification: hotfix
Current Phase: tested
Checkpoint SHA: d25c2b8
## Session Info
layout-20260913. User authorizes unclipped header and central lower workspace.
## Gate Evidence
Plan: bounded dashboard frame with header outside scrolling content; move long panels to persistent central workspace sections. Existing frontend-patterns conventions apply. No API changes.
## Evidence
Observed min-height-only dashboard permits document scroll; header is not sticky. Right sidebar contains editor plus all long workflows.
Vite build passed (existing configuration/chunk warnings). Real Chrome at 1920px: header y=0 height88; central workspace below office; right sidebar no longer contains SEO/WordPress/request forms. Switching WordPress/diagnosis retained the existing draft title. At 390x844: header y=0 height128.5, body width390, scroll area has no horizontal overflow. Viewport restored. No API, persistent user content or external site changed. No new automated test for CSS/layout-only changes; actual DOM measurements and browser interaction verify layout and retained inputs.
## Drift Log
None.
## Review
Verdict: PASS. Existing project keys preserved; hidden panels remain mounted; no duplicated API components. Header remains outside the bounded scroll area, responsive header wraps. Theme/license unchanged.
## Handoff
Verified. Spec: docs/specs/dashboard-layout.md. Code: src/components/CorporationDashboard.jsx and corporationDashboard.css. CSS and component move can be reverted together.
`nExisting regression tests: corporationDashboard.test.jsx and projectBoard.test.js, 11 tests passed.
