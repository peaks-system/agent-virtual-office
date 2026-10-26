---
status: frozen
version: 1.1
date: 2026-10-26
classification: architecture-change
---

# Revenue Lab Three Picks Hard Fact / Soft Copy v1

## Goal

Replace post-hoc natural-language reconstruction of hard facts for new `three_picks_v2` revisions with an explicit typed-evidence lineage. Existing revisions remain immutable and continue through their stored prompt, schema, plan, and manifest paths.

## Versioned path

- New revisions use `three-picks-production-planner-v4` and `multi-product-shorts-plan-v5`.
- Final formatted plans continue to compile to `three-picks-composition-manifest-v3` and `hero-product-layout-v2`.
- Revisions 1–13 are not retried, backfilled, rewritten, or revalidated.
- Queued or running requests retain the planner/schema path recorded in their input snapshot.

## Typed evidence

The server splits verified facts into complete semantic candidates. Each candidate retains its stable ID, verified-fact reference, source text, and source anchor. Deterministically recognizable hard facts may additionally contain typed facts with a stable `fact_id`, a bounded type/key, a canonical value, and a canonical `display_text`.

The initial allowlist is `feature`, `quantity`, `duration`, `model`, `grade`, `material`, `connection`, `magnet_grade`, and `count`. Ambiguous claims remain soft evidence and are never coerced into typed facts. Text visible only inside product images is not evidence.

Quantitative typed facts retain every material qualifier present in the source. Duration facts preserve the item quantity and unit, duration value and unit, source approximation, maximum/minimum bound, estimate wording, and structured conditions such as per-day usage, usage count, or an explicit usage environment. The compiler never invents a qualifier. Canonical badge text must include every material qualifier; if the complete badge cannot fit the existing one-line 12-character contract, that duration fact is not selectable as a badge rather than being shortened into a misleading statement.

## Canonical identity

Every product receives one to three server-generated identity candidates. Candidates are category identities derived from the frozen product title, excluding merchant names, SEO duplication, promotional terms, and model-only tokens. If no safe candidate can be produced, enqueue stops with `IDENTITY_CANDIDATE_MISSING`; the model cannot invent a fallback identity.

## Planner v4

The compiler flattens typed facts into `selectable_facts[]`, where every option carries its exact `fact_id`, `source_candidate_id`, type, and canonical `display_text`. The planner selects `identity_id` only from `identity_candidates[].identity_id` and `fact_id` only from `selectable_facts[].fact_id`. Evidence candidate IDs remain a separate namespace used only by `short_appeal` and product `tts`; a candidate ID is never accepted as a `fact_id`.

The planner generates only Hook, `short_appeal`, product `tts`, and CTA copy. It does not output `display_name` or `fact_badge`, and may not add hard facts that are absent from selected evidence. When soft copy uses a quantitative fact, it must preserve all attached material conditions and qualifiers.

## Deterministic formatter and schema-v5 validation

After validating the planner selection and soft copy, the server resolves `identity_id` to `display_name` and `fact_id` to `fact_badge`. The persisted formatted plan keeps the renderer-facing fields `display_name`, `short_appeal`, `fact_badge`, and `tts`, and records selected identity/fact/candidate lineage in JSON metadata.

Validation requires selected IDs to exist in the exact input snapshot. Canonical display strings must equal the compiler output. Soft copy requires explicit evidence candidate IDs and may paraphrase only supported concepts; new numbers, models, materials, interfaces, specifications, or functions are rejected. A quantitative duration claim must match the typed value, units, approximation, bound, estimate, and every material condition. Omitting a material condition or adding an absent approximation is rejected. Hook and CTA cannot introduce product hard facts, and CTA must name the description destination.

## Progressive fallback and human review

Every new schema-v5 request completes its eight soft-copy fields through a bounded three-level process inside the same worker job and Revision:

1. Level 1 validates the creative Planner v4 output.
2. Level 2 sends only rejected field paths to one grounded repair request. Successful fields are immutable, and each rejected field receives at most one repair attempt.
3. Level 3 replaces any still-invalid field with deterministic canonical safe copy derived only from the selected identity, typed fact, material qualifiers, and source candidate lineage. Hook and CTA use fixed generic templates with no product facts.

Unknown or mismatched identity IDs, fact IDs, products, or presentation order remain hard failures and never enter repair. Soft-copy safety rules are identical at Levels 1 and 2; repair reduces writing freedom, not validation strength. Level 3 is accepted only when its value exactly equals the deterministic formatter output. A repair provider or response failure also resolves through Level 3, so no repair loop is possible.

The completed Plan stores one `soft_copy_fields[]` record for Hook, each product `short_appeal` and `tts`, and CTA. Records use `ai_generated`, `ai_repaired`, or `canonical_fallback`, include `repair_count`, and retain product, identity, fact, and evidence IDs where applicable. The normal pre-TTS review shows these modes as `AI生成`, `自動修正済み`, or `安全文へ置換`. This metadata also provides stable field identity for a future human partial-edit workflow; editing is not included here.

## Persistence and compatibility

Typed evidence and identity candidates are stored inside the existing request `input_snapshot` JSONB. Planner selection, formatted output, field generation modes, and lineage metadata are stored inside the existing plan `output_json` JSONB. No migration or RPC/API contract change is required.

Existing v3/v4 validators remain unchanged for historical and in-flight requests. Revisions 1–16 are not retried, rewritten, backfilled, or revalidated, and stored render manifests remain authoritative. A single user request still creates exactly one Revision; internal repair and fallback never enqueue another request.

## Acceptance criteria

- LED, N56 magnet grade, duration, quantity/count, and USB connection examples compile to typed facts and deterministic badges.
- Duration facts preserve material conditions and qualifiers; canonical badge and soft copy cannot omit them.
- Ambiguous evidence remains untyped.
- Canonical identity candidates exclude merchant, SEO duplicate, and model-only output; missing identity fails closed.
- Planner Structured Outputs contain IDs and soft copy, never free `display_name` or `fact_badge`.
- Unknown identity/fact IDs fail with safe diagnostics.
- Level 1 success makes no repair call; invalid soft fields receive at most one Level 2 call and otherwise use deterministic Level 3 copy.
- Successful fields remain byte-for-byte unchanged, and field generation mode plus lineage is persisted for human review.
- The formatter emits the current renderer-facing plan shape.
- v4 and earlier requests remain on their existing paths; manifest-v3/layout-v2 and real FFmpeg rendering remain compatible.

## Non-goals

No interactive field editing, repeated repair loop, DB/RPC/migration change, ElevenLabs change, Final Composer redesign, Publication/Analytics change, Three Picks v1 change, I2V change, Live generation, DB write, commit, push, or merge.

## Future consideration

Consider an explicitly versioned optional `fact_badge` fallback for products with no safely compilable typed fact. This version continues to fail closed instead of omitting the badge.
