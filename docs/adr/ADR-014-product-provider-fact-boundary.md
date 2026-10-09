---
status: accepted
date: 2026-10-09
---

# ADR-014: Product providers own commerce facts

## Context

AI Opportunity Analyst generates search language from metadata, but it has no authority to assert current catalog facts.

## Decision

Use a small injected `ProductCatalogProvider` contract. Provider adapters alone normalize product facts. Save immutable provider snapshots and rank them with versioned deterministic code. Keep credentials in the local server/worker environment and expose only normalized facts through `/api/revenue/*`.

Rakuten Ichiba Item Search API `20260701` is the first adapter. Provider-specific identity and raw payload remain available for audit, while shared code consumes the normalized contract.

## Consequences

- Adding Amazon requires a new adapter and score version, not changes to Discovery, Tracking, or AI analysis.
- Price and availability are explicitly time-bound observations.
- AI-generated terms can affect which results are retrieved, but no model output becomes a product fact or ranking judgment.

## Applies To

`scripts/revenue-lab/product-*`, `scripts/revenue-lab/providers/*`, product-search migrations, `/api/revenue/*product*`, and the Product Candidate Finder Dashboard section.
