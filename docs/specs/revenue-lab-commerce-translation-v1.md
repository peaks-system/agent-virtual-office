# Revenue Lab Commerce Translation v1

Status: frozen implementation specification (2026-10-11)

## Boundary

Commerce Translation is an independent downstream layer after AI Opportunity Analyst. It does not update Discovery, Tracking, Opportunity Score, ranks, Analyst recommendations, or the existing Analyst prompt/version.

Phase 1 input is metadata-only: saved video title, source queries, and selected fields from the immutable Analyst output. YouTube description, transcript, media, product pages, and provider facts are excluded.

## Flow

`Analyst output → deterministic term policy → Structured Output proposal → deterministic readiness → optional human feedback → external search/provider → human-selected product`

The deterministic policy identifies retailer/source/discovery terms and removes them from the text supplied for commerce abstraction. The original observed terms and every removal match remain in the request snapshot.

## Readiness

- `ready`: evidence references exist and both category and query confidence are medium/high.
- `needs_enrichment`: the Structured Output explicitly requires more evidence. No Analyst-keyword fallback is allowed.
- `human_review`: enrichment is not required, but confidence/evidence does not satisfy automatic search readiness.

`needs_enrichment=false` alone never implies `ready`. External Amazon, Rakuten, Yahoo! Shopping, Google, and Product Provider searches are enabled only for AI-ready, human-approved, or human-overridden effective queries.

## Generation restrictions

The model may generate only demand hypotheses, generic product categories, and generic research queries. It must not generate or assert concrete product names, brands/models, SKU/ASIN/JAN, price, URL, stock, seller, ratings, reviews, or product availability. Server validation rejects source terms, URLs, prices, and identifier-like product facts in generated queries.

## Reproducibility and cache

The canonical request snapshot includes the deterministic policy result, original observations, metadata-only limitations, and a source enrichment tuple. Phase 1 freezes that tuple as `{id:null, content_fingerprint:null, included:false}`. A future enriched request must persist both `source_enrichment_id` and `source_enrichment_fingerprint`; the database enforces that both are present or absent together.

Cache identity is the unique combination of project, analysis, canonical `input_fingerprint`, prompt version, schema version, requested model, and term-policy version. A successful identical request is returned without another OpenAI call.

## Human and product lineage

Feedback is append-only. It records the original AI query, action (`approve`, `override`, `reject`), optional human override, and effective query. It never overwrites the AI proposal. A selected manual product stores a separate immutable origin row linking product → translation → AI keyword → feedback/override → effective query.

This lineage is designed to compare metadata-only and later description-enriched translations against selected products, Campaign outcomes, conversions, and revenue without rewriting v1.
