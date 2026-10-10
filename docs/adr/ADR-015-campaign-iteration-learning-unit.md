---
status: accepted
date: 2026-10-10
---

# ADR-015: Campaign Iteration is the learning unit

## Context

A Campaign can test multiple products, appeals, hooks, and structures. Updating one Campaign row would erase which treatment produced a publication and its downstream outcome.

## Decision

Use Campaign as the lifecycle envelope and Campaign Iteration as an immutable versioned treatment. Publications and future performance records reference the iteration. Preserve source opportunity, analysis, product, and treatment snapshots so later edits or source retention do not rewrite historical meaning.

Manual human-verified products are the primary Phase 3A flow. Provider candidates may be curated later, but existing Rakuten storage and deterministic ranking remain optional and unchanged.

Campaign creation does not require a publication. A pre-publication iteration remains `draft`; a later explicit registration attaches the real YouTube Video ID without fabricating a placeholder publication.

## Consequences

- Multiple iterations can coexist under one active Campaign without ambiguous lifecycle state.
- Post-publication changes create a new iteration or future publication revision rather than mutating training provenance.
- Future Score v2 datasets can use pre-publication treatment fingerprints and post-publication labels without look-ahead.

## Applies To

Campaign migrations, manual campaign APIs, Campaign Board UI, future publication revisions, Analytics/Reporting providers, affiliate outcomes, and campaign reviews.
