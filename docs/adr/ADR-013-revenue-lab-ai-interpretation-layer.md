---
status: accepted
applies_to:
  - scripts/revenue-api.cjs
  - scripts/revenue-worker.cjs
  - scripts/revenue-lab/*
  - supabase/migrations/*revenue_lab_ai_analyst*
  - src/components/RevenueLabDashboard.jsx
  - src/components/revenueLabDashboard.css
  - src/services/revenueLabApi.js
---

# ADR-013: Revenue Lab AI analysis is an immutable interpretation layer

Status: Accepted

## Context

Revenue Lab already ranks YouTube opportunities with deterministic Discovery and Tracking scores. Phase 2 needs model-assisted interpretation while preserving reproducibility, low cost, and honest metadata-only claims.

## Decision

Store AI requests, contexts, structured results, and human reviews in additive `revenue_lab` tables. Use a SHA-256 fingerprint of recursively canonicalized exact model input as the cache authority. The unique identity also includes project, source item, prompt version, schema version, and requested model; a snapshot foreign key is retained only for audit.

Run one `opportunity.analyze` queue job per deduplicated video through the existing replaceable worker boundary. Use the OpenAI Responses API with strict Structured Outputs, `store=false`, no tools, and no browser-visible key. The model receives metadata and saved metrics only. It emits hypotheses rather than causal findings and is blocked from claiming that it watched or verified unavailable material.

AI output is append-only interpretation data. It cannot update opportunities, score components, raw scores, ranks, collection runs, tracking runs, or snapshots. Human feedback is stored separately and does not feed v1 scoring.

## Consequences

- Cached analysis is reproducible and auditable across retries.
- Prompt, schema, or model changes intentionally create a new cache identity.
- The initial UI analyzes one video; the API boundary supports at most six deduplicated TOP3 candidates.
- Product APIs can later enrich a separate evidence layer without silently changing metadata-only historical analyses.
- Rollback removes only Phase 2 data and the added job type.

## Applies To

`scripts/revenue-api.cjs`, `scripts/revenue-worker.cjs`, `scripts/revenue-lab/*analysis*`, `scripts/revenue-lab/job-handlers.cjs`, `scripts/revenue-lab/runtime.cjs`, `scripts/revenue-lab/supabase-store.cjs`, `supabase/migrations/*ai_analyst*`, `src/components/RevenueLabDashboard*`, `src/services/revenueLabApi.js`.
