---
status: frozen
title: Revenue Lab Phase 2 AI Opportunity Analyst
primary_domain: revenue-lab
secondary_domains: [api, data-pipeline, ui]
prompt_version: opportunity-analyst-v1
schema_version: opportunity-analysis-v1
---

# Revenue Lab Phase 2 AI Opportunity Analyst

## Goal

Add a metadata-only interpretation layer over the existing Discovery and Tracking TOP3. The analyst explains possible commercial relevance and a next action without changing deterministic scores, ranks, collection, or tracking.

## Acceptance Criteria

- AC-1: A manual request selects the current Discovery TOP3 and Tracking TOP3, deduplicates the same video, and accepts a bounded limit of 1–6. The initial UI requests exactly one video.
- AC-2: The exact model input is stored and recursively canonicalized before SHA-256 fingerprinting.
- AC-3: Cache identity is unique on `project_id`, `source_item_id`, `input_fingerprint`, `prompt_version`, `schema_version`, and `requested_model`; `input_snapshot_id` is audit-only.
- AC-4: The Responses API uses strict Structured Outputs, `store=false`, no tools, and a fixed JSON Schema.
- AC-5: Inputs contain metadata and saved metrics only. Descriptions, transcripts, audio, frames, and affiliate/product links are not fetched or represented as inspected.
- AC-6: Output uses `growth_hypotheses`, each with confidence and supporting indicators. It never claims the model watched the video or verified content, links, products, descriptions, or transcripts.
- AC-7: AI results never update Discovery/Tracking scores, ranks, opportunities, runs, snapshots, or collection handlers.
- AC-8: Analysis stores requested/resolved model, prompt/schema versions, exact input, fingerprint, generation time, response id, and token usage.
- AC-9: Human decisions are append-only records that can later be compared with the AI recommendation.
- AC-10: The dashboard presents analysis beside the existing ranked card without reordering it, and distinguishes cached, pending, running, succeeded, and failed states.
- AC-11: `OPENAI_API_KEY` is server/worker-only and optional for Phase 1 collection and tracking.
- AC-12: Tests pin canonicalization, cache identity, strict schema, unsupported-claim rejection, one-item initial enqueue, six-item maximum, score/rank immutability, API validation, and UI states.

## Data Contract

The model input contains stable video identity and title/channel metadata, query labels/text, Discovery/Tracking context, saved score components, observed growth metrics when available, and explicit limitations. It excludes request time and other volatile fields so identical input produces an identical fingerprint.

The output contains:

- product or theme name and video subject;
- metadata-based growth hypotheses with confidence, supporting indicators, and basis;
- product dependence, presentation dependence, purchase intent, affiliate fit, reproducibility, and evidence quality;
- same-product expansion potential, similar product categories, search keywords, video ideas, and hooks;
- recommendation (`adopt`, `hold`, or `exclude`), reason, and cautions.

## Non-goals

- Changing `youtube-v1` or `youtube-tracking-v1`.
- Fetching descriptions, captions, transcripts, audio, frames, product links, or product APIs.
- Automatic publishing, product selection, or affiliate execution.
- Analysis of all 25 videos.

## Rollback

Disable the analysis endpoint and worker handler, then apply the paired down migration. Discovery and Tracking remain operational because Phase 2 adds independent tables and an optional job type.
