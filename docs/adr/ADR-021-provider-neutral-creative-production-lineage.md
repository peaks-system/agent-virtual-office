# ADR-021: Provider-neutral Creative Production lineage

Status: Accepted

## Context

Revenue Lab must turn a Campaign Iteration into an actionable Shorts plan while preserving the difference between verified product facts, real product assets, and generated creative hypotheses. Rendering vendors will change over time, and a regenerated plan must not erase the plan used for an earlier production decision.

## Decision

Creative Production is a separate append-only layer keyed to `campaign_iteration_id` and `curated_product_id`.

1. Freeze Campaign, Iteration, verified facts, and Product Asset metadata into each request.
2. Generate one strict Structured Output through the OpenAI Responses API.
3. Validate fact IDs, numeric claims, asset IDs, timeline bounds, and AI-scene boundaries before saving.
4. Save every generation as a numbered immutable revision.
5. Save a provider-neutral export; provider adapters may be added later and may not rewrite the source plan.
6. Keep all access behind the server/service role.

## Consequences

Plans are reproducible and comparable across revisions. Product appearance remains grounded in human-registered Product Assets. Future rendering integrations need only translate the provider-neutral export. Storage grows append-only, and an unsafe or invalid model response must be regenerated as a new request rather than edited in place.
