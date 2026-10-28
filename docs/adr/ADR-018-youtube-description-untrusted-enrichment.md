# ADR-018: YouTube description is an immutable, untrusted enrichment input

## Status

Accepted for Revenue Lab Commerce Translation v1 enrichment.

## Context

Metadata-only Commerce Translation deliberately returns `needs_enrichment` when titles, search themes, and Analyst metadata cannot support a sufficiently specific generic product category. Replacing the original translation would destroy the audit trail, while adding description retrieval to Discovery or Tracking would couple scoring collection to an optional AI interpretation step.

## Decision

- Description retrieval is a separate `source.enrich.youtube_description` job and does not change Discovery, Tracking, Opportunity Score, rank, recommendation, or the Opportunity Analyst prompt.
- Only a TOP-candidate analysis whose latest metadata-only translation needs enrichment may enqueue the job.
- The worker calls YouTube `videos.list(part=snippet)` for the already-known video ID. It never uses `search.list`, follows links, or fetches linked pages.
- Each capture is inserted into `source_item_enrichments` with its request ID, raw description, SHA-256 content fingerprint, capture time, provider ETag, and availability status. Rows are immutable to the service role.
- The description is untrusted input. Deterministic retailer/source-term preprocessing runs first; the model prompt forbids following embedded instructions, visiting URLs, or promoting description claims to verified product facts.
- Enriched translation uses a separate prompt version and a new canonical input fingerprint. Metadata-only and description-enriched requests/results remain side by side.
- Product search and Campaign lineage may use only ready or human-approved translation keywords. Analyst keywords are never an automatic fallback.

## Consequences

The Dashboard can compare before/after results and reproduce which frozen description produced a proposal. An unavailable video remains an auditable enrichment attempt. Description text can improve category specificity but never becomes provider-verified product data.
