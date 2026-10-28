# ADR-017: Commerce Translation is a downstream interpretation boundary

Date: 2026-10-11
Status: accepted

## Decision

Add Commerce Translation after AI Opportunity Analyst as a separately versioned, cached, metadata-only Structured Outputs job. Keep source-term removal and final search readiness deterministic. Preserve AI proposals and human overrides as separate immutable records.

Product-provider facts remain provider-owned, and human-selected product facts remain human-owned. Commerce Translation cannot change Opportunity scores, ranks, recommendations, or existing Analyst records.

## Consequences

- Existing discovery and ranking behavior remains reproducible.
- Retailer/source wording cannot silently become an EC query.
- Information-poor results stop at `needs_enrichment`; they do not fall back to Analyst queries.
- Manual Campaign and optional provider flows share the same effective-query lineage.
- Description enrichment can later create a new fingerprinted request and be compared with metadata-only v1.
