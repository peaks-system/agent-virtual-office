---
status: frozen
---

# Revenue Lab Campaign lifecycle operations v1

## Purpose

Allow operators to correct unpublished Campaign work without corrupting published or measured experiment lineage.

## Acceptance criteria

- A `draft` Iteration with no Publication can update only its appeal hypothesis, Hook, outline, and script. Campaign ID, Iteration ID, product, AI Analysis, Commerce Translation, and selected-product lineage remain unchanged.
- Any Iteration with a Publication is immutable. Creative changes create a new `draft` Iteration that copies the source Iteration's selected product and analysis lineage and receives the next Campaign iteration number.
- A Campaign can be hard-deleted only when it has at least one Iteration, every Iteration is `draft`, and it has no Publication, Analytics run/snapshot, or generic evidence marker.
- Hard deletion removes the Campaign, origins, Iterations, idempotency records, and selected products no longer referenced by another Iteration. It never deletes an Opportunity, Analyst result, Commerce Translation, or shared product.
- Campaigns that cannot be hard-deleted can be set to `voided` with one reason: `duplicate`, `mistake`, `test`, or `other`. `other` requires a note. Voiding preserves every lineage and evidence row.
- Voided Campaigns are excluded from the normal ledger and displayed in a collapsed history section.
- New tables and RPCs deny `PUBLIC`, `anon`, and `authenticated`; only `service_role` may access them.

## Evidence extension point

`campaign_evidence_markers` is the deletion lock for future affiliate clicks, conversions, sales, commissions, Reporting API artifacts, or other durable outcomes. Future ingestion must append a marker before or atomically with its evidence row.

## Out of scope

Draft revision history, product editing, Publication editing, Affiliate ingestion, AI review, Score v2, and changes to Discovery, Tracking, Opportunity Score, Analyst, or Commerce Translation.
