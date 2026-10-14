---
status: frozen
version: 1.1
date: 2026-10-14
---

# Revenue Lab Multi-product Shorts v1

## Goal

Create one approximately 20-second, silent, 9:16 H.264 Short from exactly three human-selected, verified products without using an external video-generation API.

## Product set and iteration lineage

`campaign_product_sets` is an immutable human selection record. `three_picks_v1` contains exactly three distinct `campaign_product_set_items`; each item freezes its curated product, immutable Product Asset revision, one verified fact, optional verified price, and commerce destination lineage. `presentation_order` is editorial sequence only. `rank_position` is always null and ranking language is prohibited.

Every Campaign Iteration references exactly one product shape: the existing `curated_product_id` for single-product work or `product_set_id` for multi-product work. The database enforces XOR. Existing rows remain single-product rows and are not rewritten. Publication, Analytics, and Campaign lifecycle continue to join through `campaign_iteration_id`.

## Human selection UI

The Three Picks intake always shows the complete candidate pool available in the Dashboard, including products that are not yet eligible. Each candidate shows product name, merchant, product image, verified-fact state, commerce-destination state, Product Asset Revision state, and explicit eligibility or ineligibility reasons.

Human selection uses checkboxes. At most three distinct products may be selected, and selection order is frozen as `presentation_order`; it is never a ranking. The selected count remains visible, and Product Set creation is enabled only when exactly three eligible products are selected. A pool with fewer than three eligible products remains visible.

An insufficient pool links to the existing Direct Product Intake; it does not create another product-registration path. A permitted Product Asset without an immutable revision exposes an Asset Revision preparation action that reuses the existing Product Asset Revision mechanism. Newly registered or prepared products enter the same candidate pool after the normal Dashboard refresh.

## Three Picks plan

`three-picks-planner-v1` uses Structured Outputs. The model may produce only a hook, presentation order, one-line short appeal and on-screen copy per selected item, summary, and CTA. Product names, price, specifications, reviews, ratings, and factual claims are supplied only from frozen human-verified input.

The deterministic validator rejects duplicate/missing items, ranking language, unknown fact references, product identity changes, and more than three items. Product Cards are assembled server-side from verified snapshots; model output never becomes a product fact.

## Product Card v1

Each card uses a real immutable `product_asset_revisions` row. The card contains only `PICK n`, the frozen product name, one short appeal, one verified fact, and an optional verified price. AI-generated product images are prohibited. Commerce destination lineage is frozen with the card.

## Background and composition

`simple-animated-background-v1` is a deterministic recipe containing a canonical seed, restrained gradient palette, shapes, and particles. It is visually subordinate to the Product Card.

`local-shorts-composer-v1` accepts a provider-neutral render manifest. A local FFmpeg provider keeps command details out of the database and plan. It renders 1080x1920, 30 fps, H.264, yuv420p, faststart, no audio, using only fade, slide, slow zoom, and scale. The output is immutable and records SHA-256, duration, dimensions, fps, composition fingerprint, and the complete provider-neutral render manifest.

## Security and idempotency

All new tables and RPCs revoke PUBLIC, `anon`, and `authenticated`; only `service_role` may access them. User-supplied URLs never become FFmpeg inputs. The composer reads only hash-verified private immutable Product Asset objects and writes to a private immutable composition bucket. Process invocation uses argument arrays without a shell; errors are normalized and never expose commands or local paths.

Plan and render fingerprints cover every frozen input. Active duplicate requests return the existing request and cannot start a second render.

## Non-goals

No AI product selection, `ranking_listicle`, separate product-registration path, stock B-roll, generated B-roll, TTS, BGM, Creative Critic, YouTube upload, affiliate event ingestion, I2V, Pollo, Wan, bucket creation, migration application, FFmpeg installation, or Live render.
