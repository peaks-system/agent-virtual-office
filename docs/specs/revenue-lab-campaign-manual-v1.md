---
status: frozen
title: Revenue Lab Campaign Manual Vertical Slice v1
primary_domain: revenue-lab
secondary_domains: [api, data-pipeline, ui]
---

# Revenue Lab Campaign Manual Vertical Slice v1

## Goal

Persist and review the complete lineage from a scored YouTube opportunity and successful AI analysis through a human-verified product, campaign iteration, creative treatment, and manually registered YouTube video without requiring a product API.

## Acceptance Criteria

- AC-1: Search links for Amazon Japan, Rakuten, Yahoo! Shopping, and Google are generated only from saved `product_search_keywords`; no scraping or product-fact inference occurs.
- AC-2: A human provides product name, HTTPS URL, merchant, discovery channel, and the search keyword used. Price, affiliate URL, notes, and currency are optional human observations.
- AC-3: Campaign lifecycle is limited to `active`, `completed`, and `stopped`; iteration lifecycle is independently limited to `draft`, `ready_to_publish`, `published`, `measuring`, `review_due`, and `closed`.
- AC-4: Creating a manual campaign atomically saves the curated product, campaign, every Discovery/Tracking context attached to the analysis, and iteration treatment. A publication is saved only when a real YouTube Video ID is supplied.
- AC-5: The campaign stores immutable analysis and origin snapshots. The iteration stores an immutable product/creative treatment snapshot and SHA-256 fingerprint.
- AC-6: YouTube publication is optional at Campaign creation. With no Video ID the iteration remains `draft` and no publication row exists. A real Video ID can be registered later through a dedicated service-only RPC/API and Dashboard form; dummy IDs are never required.
- AC-7: Existing Discovery, Tracking, Opportunity Scores, AI Analyst, Rakuten Provider, and Candidate Score behavior and storage remain unchanged.
- AC-8: The Dashboard shows external search links, a manual campaign form, Rakuten as optional, and a Campaign Board that exposes end-to-end lineage.
- AC-9: Every new RPC revokes execution from PUBLIC, `anon`, and `authenticated`, and grants it only to `service_role`.
- AC-10: Tests cover search URL encoding, publication-optional input validation, no-publication Campaign creation, later publication registration, atomic payload/fingerprint creation, schema constraints and privileges, Dashboard lineage, and existing Revenue Lab regressions.
- AC-11: The form locks immediately while saving, displays a saved confirmation, and retains a stable operation UUID. The server uses that UUID as an idempotency key so retrying the same operation returns the existing Campaign instead of creating another.

## Future-Compatible Boundaries

- `youtube_channel_snapshots` will separately retain channel totals and period metrics for six- and twelve-month leverage evaluation.
- `publication_revisions` will preserve post-publication title, thumbnail, and description changes without rewriting the initial publication metadata.
- YouTube Analytics is the primary Performance/Retention provider. YouTube Reporting is an optional future Reach provider for impressions and CTR, not an MVP dependency.
- Local Windows OAuth will use a Desktop app authorization-code flow with a `127.0.0.1` loopback redirect, state, PKCE, offline access, and a credential-store abstraction that never exposes tokens to the browser or Supabase.

## Non-goals

- Score v2, YouTube OAuth or Analytics collection, Reporting API, affiliate outcomes, AI campaign review, automatic product facts, or external publication.

## Creation Idempotency

`campaign_creation_requests` is unique on `(project_id, idempotency_key)`. It records the selected analysis, a canonical full-request fingerprint, and `treatment_fingerprint`, then points to the created product, Campaign, Iteration, and optional Publication. A replay with the same key and same inputs returns those IDs. Reusing the key for different input fails. The treatment fingerprint itself is deliberately not unique, so a future deliberate Campaign or Iteration may reuse the same treatment with a new operation key.

## Rollback

Disable the manual campaign endpoint and UI, then apply the paired down migration. Existing Phase 1, Phase 2, and optional Rakuten tables remain untouched.
