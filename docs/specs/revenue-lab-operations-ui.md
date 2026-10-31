---
status: frozen
version: 1.1
date: 2026-10-31
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
- **AC-10:** Planner v4, schema-v5, Progressive Fallback, typed facts, selectable fact IDs, manifest-v3, layout-v2, hard/soft separation, stored revisions, Publication, and Analytics are unchanged.
- **AC-11:** Three Picks v2 product eligibility is independent from production-material readiness. A product with minimum identity, commerce destination, and verified fact evidence remains selectable when no Asset Revision exists.
- **AC-12:** Selecting three eligible products creates a `building` Product Set without requiring Asset Revisions. A building Campaign cannot enqueue Planner, TTS, or composition work.
- **AC-13:** Asset Revision assignment is allowed only while the Product Set is `building` and verifies revision availability, product lineage, and an allowed permission snapshot.
- **AC-14:** An explicit lock operation revalidates exactly three products, verified facts, destinations, Asset Revision lineage, availability, and permission before the one-way `building -> locked` transition.
- **AC-15:** Planner enqueue is guarded in both the application store and database RPC and succeeds only for a fully validated locked Three Picks v2 Product Set.
- **AC-16:** Existing locked Campaigns, their Asset Revision lineage, Revisions, audio artifacts, compositions, Publication, Analytics, and Three Picks v1 remain unchanged.

## Three Picks v2 material preparation contract

`campaign_product_sets.status` is the workflow source of truth.

- `building`: exactly three human-selected products may exist with nullable `campaign_product_set_items.product_asset_revision_id`. Product identity, commerce destination, and verified-fact references are captured, but Planner work is prohibited.
- `locked`: every item has a valid available Asset Revision belonging to that product through an allowed Product Asset permission. Existing immutability guards remain active.
- The only newly permitted transition is `building -> locked`. `locked -> building` and asset replacement on locked sets remain prohibited.

`create_three_picks_v2_campaign` creates the Campaign, building Product Set, three item snapshots, destinations, and draft iteration without assigning assets or locking the set. Asset preparation uses two explicit mutations:

1. Assign an Asset Revision to one building Product Set item after product lineage, revision availability, and permission validation.
2. Lock the Campaign only after all three items pass the full eligibility and material validation again.

The Planner enqueue RPC independently rejects a building or incomplete Product Set even if a client bypasses the UI.

## Target files

- `docs/specs/revenue-lab-operations-ui.md`
- `docs/design/revenue-lab-operations-ui.md`
- `src/components/revenueLabWorkspace.js`
- `src/components/RevenueLabDashboard.jsx`
- `src/components/revenueLabDashboard.css`
- `src/services/revenueLabApi.js`
- `scripts/revenue-api.cjs`
- `scripts/revenue-lab/supabase-store.cjs`
- `supabase/migrations/20261031120000_revenue_lab_three_picks_material_preparation.sql`
- `supabase/rollback/20261031120000_revenue_lab_three_picks_material_preparation_down.sql`
- `tests/revenueApi.test.js`
- `tests/revenueStore.test.js`
- `tests/revenueMigration.test.js`
- `tests/revenueCreativeArchetypeV2Store.test.js`
- `tests/revenueLabWorkspace.test.js`
- `tests/revenueLabWorkspaceUx.test.jsx`
- `tests/revenueMultiProductDashboard.test.jsx`

## Non-goals

- No Live DB write, provider, Planner v4/schema-v5, renderer, Publication-model, or Analytics-model change.
- No Live generation, stage, commit, push, force operation, or merge.
- No deletion or conversion of legacy data or controls.
- No persisted manual copy editing or confirmation mutation.

## Rollback

Apply the matching rollback only after verifying that no building Product Set item has a null Asset Revision. The rollback fails closed when nullable rows remain and never deletes or rewrites business data.
