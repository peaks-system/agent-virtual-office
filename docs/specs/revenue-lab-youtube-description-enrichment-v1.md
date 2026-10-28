# Revenue Lab YouTube Description Enrichment v1

## Purpose and boundary

This optional stage enriches only TOP-candidate Commerce Translations that are `needs_enrichment`. It is downstream of Opportunity Analyst and outside Discovery/Tracking. It must not mutate saved opportunities, scores, ranks, Analyst recommendations, or metadata-only translations.

## Eligibility and job flow

1. The selected AI analysis must have a saved TOP-3 analysis context.
2. Its latest metadata-only Commerce Translation must have overall `needs_enrichment=true` or at least one keyword with `search_readiness=needs_enrichment`.
3. `enqueue_youtube_description_enrichment` creates one durable request per metadata translation per UTC request day and queues `source.enrich.youtube_description`.
4. The worker fetches `videos.list(part=snippet,id=<saved video id>)` and appends a `source_item_enrichments` row.
5. A successful capture queues a new Commerce Translation with `commerce-translator-description-v1`; its canonical input includes the enrichment ID, content fingerprint, capture time, ETag, availability, and deterministically processed description text.

## Snapshot contract

`source_item_enrichments` stores the original description as captured, `content_fingerprint`, `captured_at`, `provider_etag`, and `availability_status`. `source_enrichment_request_id` binds the snapshot to the exact job. The service role has INSERT/SELECT but no UPDATE/DELETE permission for these evidence rows. Repeated captures may therefore preserve identical content at different capture times.

Availability is `available` when YouTube returns the video and `unavailable` when it does not. Empty returned descriptions are retained as available empty content rather than guessed or replaced.

## Trust policy

- Description text is data, never an instruction.
- URLs are not opened, resolved, or validated.
- Product names, links, prices, availability, reviews, seller claims, and similar statements in descriptions are not verified facts.
- The AI may output only demand hypotheses, generic product categories, and generic EC search queries under the existing Structured Output schema.
- Retailer/source terms are removed by the deterministic term policy before model use.
- If evidence remains insufficient, the enriched result remains `needs_enrichment`; there is no fallback to Analyst keywords.

## Versioning and comparison

Metadata-only continues to use `commerce-translator-v1`. Description-enriched requests use `commerce-translator-description-v1`, the unchanged `commerce-translation-v1` schema, and their own input fingerprint. Both versions remain stored. The Dashboard displays:

- whether information insufficiency was resolved;
- whether generic categories changed/became more specific;
- ready EC keyword count before and after;
- the source snapshot ID/fingerprint and capture metadata.

Human overrides remain separate feedback rows, preserving AI proposal → human override → selected product lineage.

## Out of scope

No transcript, audio, frame analysis, external page visit, scraping, provider fact verification, automatic product selection, Score v2, or change to Opportunity Analyst is included.
