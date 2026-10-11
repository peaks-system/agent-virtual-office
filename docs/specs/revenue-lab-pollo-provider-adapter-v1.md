---
status: frozen
version: 1
date: 2026-10-11
---

# Revenue Lab Pollo API Provider Adapter v1

## Goal

Render only `ai_generated_scene` entries from an immutable Creative Production plan as independent video assets through Pollo's official asynchronous API. Keep the production plan, product facts, real Product Assets, and text-only scenes unchanged.

## Provider contract

`VideoGenerationProvider` is a duck-typed server/worker boundary:

- `submitScene(request)` returns a normalized task receipt;
- `getTaskStatus(providerTaskId)` returns normalized pending/running/succeeded/failed state;
- `normalizeResult(payload)` seals provider output, cost, and URL;
- `normalizeError(error)` returns a safe provider error code without credentials or raw provider text.

Pollo v1 uses provider `pollo`, provider version `platform-v1`, and default model `pollo-v2`. `REVENUE_LAB_POLLO_MODEL` may select another allowlisted Pollo model slug. `POLLO_API_KEY` is worker/server-only.

## Scene eligibility and safety

- Only a saved scene whose `visual_source_type` is `ai_generated_scene` may be enqueued.
- `real_product_asset` and `text_only` are rejected before any provider call.
- The saved AI prompt is reused verbatim. It must retain the Creative Production safety prefix and must not be reconstructed from mutable Campaign data.
- No Product Asset URL or image is submitted in v1.
- `generateAudio` is always `false`.
- The provider receives text-to-video fields only: prompt, normalized duration, `9:16`, resolution, and audio disabled.

Pollo 2.0 supports 5 or 10 seconds. A scene duration at or below 5 seconds maps to 5; a longer scene maps to 10. Scenes longer than 10 seconds are still generated as a 10-second source clip for future composition/trimming. The original plan duration remains in the Creative Production plan.

## Persistence

### `video_generation_runs`

One explicit operator action creates one run for a production plan revision and provider/model. A regeneration action creates another run/attempt; it does not overwrite prior evidence.

### `video_generation_scenes`

One row represents one provider attempt for one Creative Production scene. It freezes scene number, prompt and prompt fingerprint, requested model, duration, aspect ratio, resolution, provider task ID, normalized task status, cost, output URL, and safe error.

Cost fields are `provider_cost_amount`, `provider_cost_currency`, and `cost_provenance = actual|estimated|unavailable`. Pollo `costUsd` is stored as `actual` USD. Missing cost is `unavailable` with null amount. v1 never creates an estimated cost.

## Idempotency

The enqueue RPC takes a UUID operation key. Replaying the same key and request fingerprint returns the existing scene attempt. A partial unique index also prevents two active attempts for the same production plan, scene, provider, model, and prompt fingerprint. After a terminal attempt, an explicit regeneration with a new operation key creates a new attempt number.

## Worker flow

1. Claim `video.generate.scene`.
2. If no provider task ID exists, mark submitting, submit, and persist the task ID immediately.
3. Poll the task with bounded attempts and delay.
4. Persist each normalized provider state.
5. On success, store HTTPS output URL and actual/unavailable cost provenance.
6. On terminal or polling failure, store only a safe code.

A retry resumes from the persisted task ID and never submits a second provider task for that attempt.

## API and UI

Authenticated endpoint:

`POST /api/revenue/creative-production-plans/:planId/scenes/:sceneNumber/video-generations`

Body: UUID `idempotencyKey`, optional `regenerate`, optional configured model. The server selects provider, version, resolution, and model policy.

The Dashboard displays generation controls only for AI-generated scenes and shows model, normalized status, provider task state, cost provenance, safe error, preview, and regeneration. It never receives the API key or request headers.

## Non-goals

No final composition, TTS, native audio, BGM, subtitle burn-in, YouTube upload, Product Asset animation, webhook, or live validation.
