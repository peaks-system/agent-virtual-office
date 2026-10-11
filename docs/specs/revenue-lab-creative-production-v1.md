# Revenue Lab Creative Production v1

## Scope

Creative Production v1 is an interpretation and planning layer after a saved Campaign Iteration. It creates a provider-neutral YouTube Shorts production plan. It does not render video, call a video-generation provider, modify Campaign creative fields, or alter Discovery, Tracking, scoring, Analyst, or Commerce Translation results.

## Frozen input

Each request stores a canonical input snapshot and SHA-256 fingerprint containing:

- Campaign and Campaign Iteration identity and creative hypothesis;
- the selected curated/direct product identity;
- verified product facts as stable fact IDs;
- Product Asset metadata and usage permission, without supplying asset URLs to the model;
- the fixed YouTube Shorts / 9:16 contract and safety constraints.

Campaign text, product text, and asset metadata are untrusted data. They are never treated as model instructions. Only `verified_product_facts` may support a product claim.

## Structured output

`schema_version = creative-production-plan-v1`

The Responses API uses strict Structured Outputs and returns:

- `target_format = youtube_shorts` and `aspect_ratio = 9:16`;
- target duration and creative objective;
- narration and its product fact references;
- timed subtitle segments and fact references;
- an ordered scene timeline with duration, purpose, on-screen text, narration, subtitle references, and fact references;
- exactly one scene source type: `real_product_asset`, `ai_generated_scene`, or `text_only`;
- a Product Asset ID for real-product scenes;
- a safety-prefixed prompt for AI-generated background/people/atmosphere/effect scenes;
- CTA and production notes.

The application validates the structured result again before persistence. Unknown fact IDs, unverified numeric product specifications, unknown or ineligible asset IDs, invalid timelines, and AI prompts containing the product identity are rejected.

## Product appearance boundary

- Product-body appearance must not be generated or reconstructed.
- When an eligible Product Asset exists, a product display scene must reference a real Product Asset.
- AI-generated scenes are limited to backgrounds, people without a visible product, generic usage atmosphere, transitions, and effects.
- Price, size, weight, capacity, performance, compatibility, and similar specifications may appear only when supported by a frozen verified fact reference.
- The model is not told that it inspected an image and receives no asset URL.

## Revision and idempotency

`creative_production_requests` owns input, model/prompt/schema identity, job state, token usage, and revision number. `creative_production_plans` stores the immutable output and provider-neutral export.

Every explicit regeneration creates the next revision. Retrying the same UI operation uses its UUID idempotency key and returns the existing request. Worker persistence ignores a duplicate insert for the same request and never updates an existing plan.

## Provider-neutral export

`provider_export.export_version = provider-neutral-shorts-v1` contains target metadata, asset bindings, generation prompts, and the complete timeline. `generation_provider` remains `null`. A future Higgsfield, Pollo AI, or other adapter consumes this record without changing the v1 plan.

## Security and configuration

- `OPENAI_API_KEY` remains server/worker-only.
- Optional model override: `REVENUE_LAB_CREATIVE_PRODUCTION_MODEL`.
- Requests use `store: false` and no tools.
- New tables have no browser-role privileges.
- The enqueue RPC revokes EXECUTE from `PUBLIC`, `anon`, and `authenticated`, and grants only `service_role`.

## Non-goals

No video rendering, upload, provider API, asset download, asset visual inspection, publication mutation, score change, or automatic Campaign decision is part of v1.
