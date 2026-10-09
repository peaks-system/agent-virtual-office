---
status: frozen
title: Revenue Lab Product Candidate Finder v1
primary_domain: revenue-lab
secondary_domains: [api, data-pipeline, ui]
provider: rakuten-ichiba
provider_api_version: "20260701"
score_version: product-rakuten-v1
---

# Revenue Lab Product Candidate Finder v1

## Goal

Turn successful AI Opportunity Analyst output into verifiable product candidates from one real catalog provider. Provider facts remain immutable facts; AI supplies search language only and never invents or rewrites product names, prices, URLs, availability, reviews, or affiliate rates.

## Acceptance Criteria

- AC-1: A manual action searches one successful AI analysis using at most three normalized terms derived from `product_search_keywords`, `product_or_theme_name`, and `similar_product_categories`.
- AC-2: Rakuten Ichiba Item Search API version `20260701` is the only v1 provider. `RAKUTEN_APPLICATION_ID` and `RAKUTEN_ACCESS_KEY` are required; `RAKUTEN_AFFILIATE_ID` is optional and all three remain server-side.
- AC-3: Every provider request uses `availability=1`, no more than ten hits, and sequential execution.
- AC-4: Product facts are normalized exclusively from the provider response and saved as immutable offer snapshots with provider API version and capture time.
- AC-5: `product-rakuten-v1` is deterministic. Weights are keyword match 25%, search coverage 25%, provider rank 25%, review count 10%, review average 10%, and affiliate rate 5%.
- AC-6: Ranking uses unrounded values. Saved component scores use four decimals and the final score uses two decimals. Ties resolve by raw candidate score, search coverage, review count, then provider product ID ascending.
- AC-7: AI is not called during product search and cannot modify ranking or provider facts.
- AC-8: An exact canonical input fingerprint and daily idempotency key prevent duplicate jobs. A successful identical run is cached for 24 hours.
- AC-9: The Dashboard shows provider, API version, capture time, cache state, terms, top five candidates, score explanation, and provider-derived product facts.
- AC-10: Human decisions are append-only and mean selection for the next research step, not approval to publish or promote.
- AC-11: Discovery, Tracking, `youtube-v1`, `youtube-tracking-v1`, existing ranks, and AI Opportunity Analyst prompt/schema/output are unchanged.
- AC-12: Tests cover credentials, provider normalization, `availability=1`, keyword matching, every score component, ties, missing values, cache/idempotency, API authorization, UI wording, and existing rank immutability.

## Keyword Match v1

Normalize with Unicode NFKC and lowercase. Split every search phrase on whitespace, deduplicate non-empty terms, and remove whitespace from both term and candidate text. `keyword_match_score` is the length-weighted percentage of terms found as literal substrings in `title + catchcopy`, clamped to 0–100. No model call or semantic similarity is used.

## Non-goals

- Amazon or another provider.
- Automatic scheduling, publishing, purchasing, or campaign creation.
- AI product ranking, AI fact completion, or AI fact correction.
- Changing any existing opportunity score, rank, prompt, collection, or tracking behavior.

## Rollback

Disable the product-search endpoints and handler, then apply the paired down migration. Existing Phase 1 and Phase 2 tables remain independent.
