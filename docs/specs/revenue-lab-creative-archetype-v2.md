---
status: frozen
version: 1.1
date: 2026-10-19
---

# Revenue Lab Creative Archetype v2

## Goal

Produce a 35–45 second, 9:16 Three Picks Short in which real product imagery is the visual subject and narration, subtitles, sound effects, and background music follow one deterministic template. This is an additive `three_picks_v2` path. The frozen `three_picks_v1` schema, RPCs, validator, Product Card renderer, and 20-second silent composer remain unchanged.

## Lineage and compatibility

v2 creates a new human-selected Product Set and Campaign Iteration; it never upgrades a v1 Product Set or rewrites a v1 plan. Campaign, Iteration, Publication, and Analytics continue to join through `campaign_iteration_id`. Existing v1 rows remain readable, renderable, and publishable by the v1 path.

The v2 path has dedicated RPCs: `create_three_picks_v2_campaign`, `enqueue_three_picks_v2_plan`, and `enqueue_final_composition_v2`. They may share existing tables and job types, but must reject non-v2 lineage. v1 RPC bodies and signatures are frozen.

## Product Set assets

Each of the three Product Set items freezes one to four available immutable Product Asset Revisions in `campaign_product_set_item_assets`. `asset_order` is 1–4 and is unique inside the item. A revision cannot appear twice inside one item. `asset_order = 1` is the primary/hero source of truth and must equal `campaign_product_set_items.product_asset_revision_id`. Every revision must belong to the selected Curated Product and must snapshot permitted `owned`, `licensed`, or `authorized_reference` usage.

One asset is sufficient; two to four are recommended. v2 never requires Pollo, Wan, I2V, background-video generation, or generated product imagery.

## AI plan

The planner contract is `multi-product-shorts-plan-v3` / `three-picks-production-planner-v2`. It receives exactly three frozen products in presentation order and may generate only theme, Hook, per-product `short_appeal`, verified fact selection, narration text, CTA, and bounded motion emphasis. The server fixes `template_id` to `hero-carousel-v2`; template selection is not exposed to the model.

Model output contains no Product Card and no render coordinates. `display_name` and `fact_badge` are copied from frozen input. Ranking language, unsupported facts, changed identity, unknown fact references, and excess text are rejected.

Limits after whitespace compaction:

- Hook display text: 22 characters. Hook narration is a separate, single short sentence capped at 14 characters, targeting 3–4.5 seconds with the configured Japanese voice. It must not contain product descriptions or a product list.
- `display_name`: 18 characters.
- `short_appeal`: 28 characters.
- `fact_badge`: 18 characters.
- Per-product narration: 140 characters.
- CTA display text: 18 characters; CTA narration: 70 characters.

### Production Creative Quality v1

New revisions use `three-picks-production-planner-v3` and `multi-product-shorts-plan-v4`. The server supplies the complete normalized product title as `source_product_name` plus bounded `fact_candidates` made only from complete semantic units. UI truncation is never reused as planner evidence, and no candidate may end inside a bracket, word, symbol sequence, or verified-fact statement.

The planner translates commerce copy into video copy instead of copying it. `display_name` is a 4–14 character category identity; `short_appeal` is one complete 8–22 character benefit phrase; `fact_badge` is one grounded 3–12 character line; and product narration is one natural 12–40 character sentence. Every appeal, badge, and narration includes evidence anchors that occur verbatim in the selected fact candidate. The validator rejects changed identity, unsupported structured claims, dangling fragments, authority/superlative badges, and claims without an evidence anchor. Hook narration remains one segment and at most 14 characters. CTA copy must identify the description as its destination.

## Narration and audio artifacts

Hook narration must validate to exactly one deterministic segment. Product and CTA narration retain punctuation-based splitting with the fixed 42-character segment maximum. Segment IDs and input fingerprints are stable for identical plans. TTS generation is segment-based. Subtitle cue timing uses each ready audio artifact's measured duration; timing is never estimated from the full narration string.

`creative_audio_artifacts` persists the minimal provider boundary: segment identity/order, provider, model, voice, input text and SHA-256, audio SHA-256, measured duration, status, immutable object key, and request fingerprint. Plan persistence creates `planned` records only. This version chooses no external TTS provider and makes no paid call. Final composition enqueue requires all narration segments to have `ready` artifacts.

## Manifest and deterministic composition

`three-picks-composition-manifest-v2` uses `hero-product-layout-v1` and server-fixed `hero-carousel-v2`. It contains independent image, `display_name`, `short_appeal`, `fact_badge`, and subtitle layers. A completed Product Card image is not a v2 intermediate artifact.

Default timing is 39 seconds: Hook 4 seconds, three product scenes at 10 seconds each, CTA 5 seconds. The compiler may expand within 35–45 seconds to fit measured narration while preserving Hook 3–5 seconds, each product 7–13 seconds, and CTA 4–6 seconds. It fails closed when measured audio cannot fit these bounds.

The template deterministically owns 1080×1920 layout, 30 fps H.264/yuv420p output, product-first safe areas, image motion, transition timing, text animation, subtitle placement, SE timing, BGM loop and ducking envelope. Background B-roll remains optional and visually subordinate; the initial implementation uses a deterministic low-prominence graphic background. FFmpeg commands and local paths are never persisted.

New revisions compile `three-picks-composition-manifest-v3` with `hero-product-layout-v2`. The v2 layout keeps every text pixel inside 96 px horizontal safe margins, uses actual FFmpeg font metrics to fit a two-line 56–64 px display name and two-line appeal, rejects an overflowing one-line badge before rendering, and reserves a separate subtitle band. Product scenes use a neutral 840 px product card with contained imagery. One-image motion spans the full scene; multi-image scenes keep each selected image visible for at least about three seconds and deterministically reduce excess assets. `PICK 1` through `PICK 3` remain visually subordinate.

Compatibility is version-dispatched. Stored v1-layout/v2-manifest requests continue through the unchanged legacy renderer. Existing revisions and outputs are read from their stored `final_composition_requests.render_manifest`; they are never reconstructed, revalidated with the v4 validator, upgraded, or backfilled.

## Dashboard and API

The normal path remains `Product → Three Picks production → MP4 → Publish & Analyze`. Human selection chooses up to four eligible revisions for each product while retaining one primary revision. v2 plans show concise Creative copy, narration segment/audio readiness, the fixed template, and a scene-level composition timing preflight. The preflight displays `required / max` from measured ready audio using the compiler's 0.5-second padding and 30 fps alignment, explains each overflow, and disables MP4 composition until every segment is ready and every scene fits. Composition-start errors are also shown beside the action rather than only in the page-level alert. Revision numbers, SHA values, versions, fingerprints, and object keys remain under history/audit disclosure.

All new HTTP mutations require the existing AI Office authorization and controller validation. All new tables/functions revoke PUBLIC, `anon`, and `authenticated`; only `service_role` receives access.

## Non-goals

No v1 changes, v1 data upgrade, AI product selection, ranking, Product Card v3, URL product auto-fetch, Asset Prep, background-video generation, external TTS provider choice/call, voice generation UI, paid API call, Live render, Pollo, Wan, I2V, Publication logic change, Analytics logic change, migration application, commit, push, or merge.
