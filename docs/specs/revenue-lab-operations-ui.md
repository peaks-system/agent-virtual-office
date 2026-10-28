---
status: frozen
version: 1.0
date: 2026-10-28
classification: architecture-change
primary_domain: revenue-lab
secondary_domains: []
---

# Revenue Lab Operations UI

## Goal

Reframe Revenue Lab as an operations workspace where automation progresses by default and people see only decisions, reviews, and publication work that require attention.

## Normal navigation

The default area is `今日やること`. The four normal areas are:

1. `今日やること` — human-attention queue with Campaign, latest Revision, current state, and one next CTA.
2. `商品` — discovery, tracking, opportunity analysis, direct product intake, registered products, and Three Picks selection.
3. `制作` — latest Planner v4 Revision, script, TTS, timing, MP4, and Preview.
4. `公開・分析` — completed video, Preview, publication metadata, product link readiness, Publication registration, YouTube Analytics, and performance.

Settings, audit data, and legacy functionality are outside the normal navigation and remain available in a collapsed `設定・監査` surface.

## Copy review

Each soft-copy field displays one origin badge and one independent review badge.

- Origin: `AI生成`, `自動修正`, `安全文`, or `手動修正`.
- Review: `未確認` or `確認済み`.
- `自動修正`, `安全文`, and `手動修正` receive stronger visual emphasis.
- Normal script and TTS copy uses a 15–16px reading size.

The UI reads persisted generation/review metadata when present and defaults conservatively to `未確認`. This work does not add a persistence or editing API.

## Settings, audit, and legacy

Request, plan, job, UUID, segment, provider, raw timing, version, revision, fingerprint, lineage, generation metadata, API connection, YouTube Analytics connection, and Query Settings are available only through `設定・監査` or nested audit disclosures.

Three Picks v1, single-product Campaign production, Creative Production Plan v1/v2 history, I2V, Wan, and legacy production history remain readable and operable only where the existing contracts permit; they are removed from the normal operations path and are not deleted.

## Acceptance criteria

- **AC-1:** `今日やること` is the initial area and lists only active Campaign work requiring human attention.
- **AC-2:** Normal navigation exposes exactly `今日やること`, `商品`, `制作`, and `公開・分析`.
- **AC-3:** Queue items show Campaign name, latest Revision, human-readable state, and one next CTA without technical identifiers.
- **AC-4:** Product operations use human-readable labels and include discovery/tracking, analysis, direct intake, registered products, and Three Picks selection.
- **AC-5:** Production centers the latest v2 Revision and shows copy origin and independent review badges.
- **AC-6:** Production emphasizes repaired, safe, and manually edited copy and keeps body/TTS copy at 15–16px.
- **AC-7:** Publication readiness summarizes video, script review, product links, and YouTube publication state in one place.
- **AC-8:** Publication registration and analytics controls are available from `公開・分析`, not repeated in the normal Campaign flow.
- **AC-9:** Settings/audit and legacy functionality remain available outside normal navigation.
- **AC-10:** Planner v4, schema-v5, Progressive Fallback, typed facts, selectable fact IDs, manifest-v3, layout-v2, hard/soft separation, DB/RPC/migrations, API contracts, data models, and stored revisions are unchanged.

## Target files

- `docs/specs/revenue-lab-operations-ui.md`
- `docs/design/revenue-lab-operations-ui.md`
- `src/components/revenueLabWorkspace.js`
- `src/components/RevenueLabDashboard.jsx`
- `src/components/revenueLabDashboard.css`
- `tests/revenueLabWorkspaceUx.test.jsx`

## Non-goals

- No DB write, migration, RPC, API, provider, planner, schema, renderer, publication-model, or analytics-model change.
- No Live generation, stage, commit, push, force operation, or merge.
- No deletion or conversion of legacy data or controls.
- No persisted manual copy editing or confirmation mutation.

## Rollback

Revert only the six target-file hunks. No persisted or external state is changed.
