---
status: frozen
title: Revenue Lab Phase 1
primary_domain: revenue-lab
secondary_domains: [api, data-pipeline, ui]
score_version: youtube-v1
---

# Revenue Lab Phase 1

## Goal

Add an isolated Revenue Lab department that collects a small set of Japanese YouTube search themes daily, persists time-series snapshots, computes deterministic scores, and shows the three strongest current opportunities in AI Office.

## Relationship

This specification is INDEPENDENT from the existing SEO, WordPress, and AI staff specifications. It must not alter their behavior or safety boundaries.

## Acceptance Criteria

- AC-1: Revenue Lab has a separate dashboard entry and loading, error, configuration-missing, empty, and success states.
- AC-2: `revenue_lab` schema is created only through a migration, with queue, project, source, query, item, snapshot, run, and opportunity tables.
- AC-3: At most three source queries may be enabled; buyer intent and commerce fit accept integers 0–100 or null.
- AC-4: A collection job searches the preceding seven days with `regionCode=JP`, `relevanceLanguage=ja`, and no more than 25 videos per query.
- AC-5: YouTube API and Supabase service keys remain server/worker-only and are never persisted or returned to the browser.
- AC-6: Jobs are queued durably, claimed through a lease, retried after failure, and can remain pending while the PC is off.
- AC-7: The local worker and job handler communicate through injected store/client ports so another runner can replace the local process.
- AC-8: Video and channel metrics are stored as immutable captured-at snapshots, while source items hold stable external identity and metadata.
- AC-9: `youtube-v1` implements the exact formulas, percentiles, missing-value behavior, rounding, and ranking defined below.
- AC-10: Queries missing buyer intent or commerce fit are not scored and surface a configuration-required reason.
- AC-11: `/api/revenue/*` exposes bounded dashboard/query reads and authorized query mutation/manual enqueue endpoints.
- AC-12: Manual execution enqueues work; it does not call YouTube directly in the HTTP request.
- AC-13: Dashboard TOP3 uses the latest successful collection run per query and the exact unrounded tie-break order.
- AC-14: Unit and integration tests cover score boundaries, both velocity modes, average-rank ties, N=1, decreasing views, missing subscriber count, missing query inputs, queue recovery, API validation, and dashboard states.

## Constraints

- Enabled queries: maximum 3.
- Search results: maximum 25 per query.
- Search window: preceding 7 days.
- Cadence: normally once per day.
- Search locale: Japan / Japanese.
- API namespace: `/api/revenue/*`.
- Secrets exist only in process environment variables.
- Scores are deterministic and never decided or modified by an LLM.
- Historical `youtube-v1` outputs are immutable when later score versions are introduced.

## Score Contract: `youtube-v1`

### Population

The percentile population is successful videos within the same `source_query` and `collection_run`. A video is eligible only when `view_count` and `published_at` exist. Populations never mix queries. For N=1 every generated percentile is `50.0`.

### Base Metrics

- `age_hours = max((captured_at - published_at) / 3600 seconds, 1)`.
- With a previous snapshot and non-decreasing views: `views_velocity = (current_view_count - previous_view_count) / max((current_captured_at - previous_captured_at) / 3600 seconds, 1)` and `velocity_mode = observed_delta`.
- Without a previous snapshot: `views_velocity = current_view_count / age_hours` and `velocity_mode = estimated_lifetime`.
- With decreasing views: `views_velocity = 0` and `velocity_mode = observed_delta`.
- With a visible subscriber count: `channel_ratio = current_view_count / max(subscriber_count, 100)`.
- With a hidden subscriber count: `channel_ratio = null`.
- `engagement_rate = (coalesce(like_count, 0) + 2 * coalesce(comment_count, 0)) / max(current_view_count, 1)`.
- `freshness = max(0, 100 * (1 - age_hours / 168))`.

### Percentiles

Generate ascending average-rank percentiles independently for velocity, non-null channel ratio, and engagement:

`percentile = 100 * (average_rank - 1) / (N - 1)`.

Hidden-subscriber videos have no channel-ratio percentile. The channel-ratio population contains only eligible videos with a computed ratio. Velocity and engagement populations contain all eligible videos.

### Breakout

Visible subscriber count:

`breakout = velocity_percentile * 0.45 + channel_ratio_percentile * 0.30 + engagement_percentile * 0.15 + freshness * 0.10`.

Hidden subscriber count:

`breakout = velocity_percentile * 0.60 + engagement_percentile * 0.25 + freshness * 0.15`.

### Opportunity

`opportunity = breakout * 0.70 + buyer_intent * 0.15 + commerce_fit * 0.15`.

`buyer_intent` and `commerce_fit` are human-set integer values from 0 to 100. If either is null, the query is excluded from scoring without a default.

### Rounding and Ranking

Use JavaScript Number without intermediate rounding. The shared persisted rounding operation is `Math.round(value * 10^digits) / 10^digits`.

- Base metrics: 6 decimals.
- Percentiles: 4 decimals.
- Freshness: 4 decimals.
- Breakout and opportunity scores: 2 decimals.
- Ranking uses unrounded values in this order: opportunity descending, breakout descending, `published_at` descending, `youtube_video_id` ascending.
- UI displays persisted two-decimal scores.

### Reproducibility Metadata

Every opportunity persists `score_version`, velocity mode, base metrics, percentiles, buyer intent, commerce fit, scores, population size, and `score_parameters` containing breakout/opportunity weights, percentile method, missing-value policy, and rounding policy.

## API Contract

- `GET /api/revenue/dashboard?limit=3` — latest TOP3, query configuration, and latest job status. Public to the same local read boundary as the existing dashboard.
- `GET /api/revenue/queries?limit=3` — bounded query list.
- `PUT /api/revenue/queries/:id` — authorized mutation of label/query/enabled/buyer intent/commerce fit.
- `POST /api/revenue/jobs` — authorized manual enqueue; returns 201 for a new job or 200 for an existing idempotent job.
- Errors use `{ "error": { "code", "message", "details" } }` and never expose upstream response bodies or secrets.

## Job Contract

Job type `youtube.collect` contains only project/query identifiers and requested date. Claiming is atomic through a database function, sets a lease, and increments attempts. Expired running jobs become claimable. Handlers receive `{ job, store, youtube, clock }` and contain no polling loop. The local worker owns polling and shutdown.

## Data Contract

- `projects`: Revenue Lab experiment identity.
- `sources`: provider identity and non-secret provider configuration.
- `source_queries`: human-configured search themes and scoring inputs.
- `source_items`: stable provider items (`video` and `channel`).
- `source_item_snapshots`: immutable captured metrics.
- `collection_runs`: one query collection attempt and its result counts.
- `collection_run_items`: membership of a video in a run.
- `opportunities`: immutable score output per run/video/version.
- `jobs`: durable queue with lease, attempts, idempotency key, and error summary.

## Non-goals

OpenAI analysis, title/hook/script generation, Amazon/Rakuten products, affiliate revenue ingestion, YouTube publishing, Adult SEO, additional WordPress work, TikTok, Pinterest, and automated content publication are excluded.

## Domain Decisions

- [DECISION] Revenue Lab owns a separate database schema, API namespace, worker, configuration, and UI component.
- [DECISION] Browser requests terminate at the local AI Office API; service-role and YouTube keys never enter client code or Supabase rows.
- [DECISION] Queue claim/lease semantics live in PostgreSQL while execution remains an injected handler usable by local or cloud runners.
- [DECISION] Score inputs, output components, population size, and parameter metadata are immutable evidence for each score version.
- [CONSTRAINT] `youtube-v1` is never recalculated in place with changed rules.
- [CONSTRAINT] Quota limits are validated before any YouTube request.
- [TRADEOFF] Phase 1 uses Supabase REST via built-in fetch rather than adding an SDK dependency, reducing dependency surface at the cost of a small explicit adapter.
