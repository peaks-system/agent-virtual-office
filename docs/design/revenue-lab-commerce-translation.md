# Commerce Translation implementation design

The local worker handles `commerce.translate` through the same job abstraction as other Revenue Lab jobs. The OpenAI adapter uses Responses API Structured Outputs, `store:false`, no tools, and a fixed schema. A deterministic postprocessor assigns keyword and translation readiness.

The database adds request/output/keyword/feedback tables, a future source-enrichment table, and selected-product origin lineage. Every table and RPC is denied to `PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`.

Dashboard reads show five distinct concepts: observed terms, removed source terms, demand hypotheses, generic categories, and EC queries. Search links and optional Rakuten provider execution consume only effective ready queries. Manual Campaign creation carries translation/keyword/feedback identifiers into the atomic RPC so the selected product can be audited back to both the AI proposal and any human override.

YouTube description enrichment is now an optional downstream job for TOP candidates that remain `needs_enrichment`. It freezes each description capture by request ID and content fingerprint, treats the body as untrusted data, and creates a separately versioned/fingerprinted translation rather than altering the metadata-only result. The Dashboard retains both versions for before/after comparison. See `ADR-018-youtube-description-untrusted-enrichment.md` and `revenue-lab-youtube-description-enrichment-v1.md`.
