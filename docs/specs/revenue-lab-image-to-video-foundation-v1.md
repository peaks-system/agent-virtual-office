---
status: frozen
version: 1
date: 2026-10-12
---

# Revenue Lab Image-to-Video Foundation v1

## Goal

Create one reproducible, product-preserving image-to-video attempt from an immutable Product Asset revision. The domain request is provider-neutral; the first adapter is Pollo-hosted Wan 2.2 Flash.

## Asset evidence

`product_asset_revisions` is append-only. Each revision freezes the exact bytes by SHA-256, MIME type, byte size, decoded dimensions, source URL, private object key, permission, and an explicit I2V decision. `owned` never implies I2V permission. Phase v1 requires both `permission_snapshot = owned` and `i2v_allowed_snapshot = true`.

A derived 9:16 asset is another immutable revision. It points to its parent and freezes derivation type, canonical derivation specification, and transformation fingerprint. Padding preserves the complete source image and never crops or stretches the product.

## Provider-neutral request

`ImageToVideoRequest` contains generation mode, immutable asset identity, temporary input URL, positive/negative prompts, duration, resolution, aspect ratio, and audio policy. Provider field names are absent from this contract.

Every model publishes a versioned capability manifest. Capability state is `SUPPORTED`, `UNSUPPORTED`, or `UNDOCUMENTED`; a requested capability must be `SUPPORTED` before submit. Unknown or undocumented behavior is rejected rather than guessed.

## Initial provider

The first adapter uses Pollo's official Wan 2.2 Flash API contract:

- model `wan-v2-2-flash`;
- image-to-video with one input image;
- 5 seconds, 720p, no audio;
- positive and negative prompts;
- 9:16 guaranteed by the input revision itself.

Provider payload construction stays inside the adapter. Pollo 2.0 text-to-video remains unchanged.

## Prompt safety

`product-i2v-identity-v1` is deterministic. It locks visible product identity, keeps the product stationary, allows only a slow camera push-in, and separately forbids shape, proportion, color, material, logo, label, button, opening, text, duplication, morphing, and watermark changes.

## Submission safety

The generation fingerprint covers plan revision, scene, provider/model, asset revision and SHA-256, derivation fingerprint, prompt-builder version, both prompts, duration, resolution, aspect ratio, and audio. Active duplicates and uncertain submissions block new submit.

The provider task ID is persisted immediately. Thereafter the attempt may only poll/resume. Poll timeout is non-terminal. Transport loss or an invalid submit receipt that could hide an accepted task becomes `submission_uncertain`; it is never automatically resubmitted.

## Secret and URL boundary

Private bytes live under an immutable object key. A short-lived signed HTTPS URL is created by the Worker immediately before submit and is never persisted, returned to React, or written to normal logs. Source retrieval rejects local/private destinations, limits redirects and bytes, verifies signature/MIME, fully decodes the image, and hashes the exact stored bytes.

The deployment creates a private Supabase Storage bucket outside this migration and sets only its name in the server/worker environment as `REVENUE_LAB_PRODUCT_ASSET_BUCKET`. The bucket must remain non-public. Browser roles receive no table or RPC access; the existing server-side service role performs immutable upload and one-hour-or-shorter signing. The migration deliberately does not create or alter a live bucket.

## Non-goals

No Seedance adapter, final composition, TTS, native audio, YouTube upload, bucket creation, migration application, or provider Live request.
