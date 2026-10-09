# Revenue Lab Phase 1–2 Setup

## Environment

Set these only in the process environment used to start AI Office and the worker:

- `SUPABASE_URL` — project URL, for example `https://<project-ref>.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY` — server/worker-only service-role key.
- `YOUTUBE_API_KEY` — server/worker-only YouTube Data API key.
- `REVENUE_LAB_WORKER_ID` — optional stable worker label; defaults to hostname/process ID.
- `REVENUE_LAB_POLL_INTERVAL_MS` — optional, defaults to 30000 and is bounded to 5000–300000.
- `REVENUE_LAB_JOB_LEASE_SECONDS` — optional, defaults to 300 and is bounded to 60–3600.
- `REVENUE_LAB_PROJECT_ID` — optional project UUID when more than one Revenue Lab project exists.
- `OPENAI_API_KEY` — optional server/worker-only key. Required only for Phase 2 analysis; Discovery and Tracking work without it.
- `REVENUE_LAB_OPENAI_MODEL` — optional requested analysis model; defaults to `gpt-6-luna`.
- `RAKUTEN_APPLICATION_ID` — required for Product Candidate Finder; server/worker-only Rakuten application ID.
- `RAKUTEN_ACCESS_KEY` — required for Product Candidate Finder; server/worker-only Rakuten access key.
- `RAKUTEN_AFFILIATE_ID` — optional. When set, Rakuten may return an affiliate URL for each product.

Do not put these values in source files, browser storage, `config/revenue-lab.json`, or Supabase tables.

## Product Candidate Finder Live Validation

1. Apply `supabase/migrations/20261009200000_revenue_lab_product_candidate_finder_v1.sql` and restart AI Office.
2. Confirm the Dashboard reports Rakuten configuration without exposing values.
3. On exactly one succeeded AI analysis, select `商品候補を検索`.
4. Wait for the durable `product.search` job to complete and reload the Dashboard.
5. Confirm API version `20260701`, `availability=1`, capture time, search terms, up to five candidates, provider facts, and `product-rakuten-v1` components.
6. Select one candidate as `次の調査対象` and confirm the decision persists after reload.
7. Repeat the same search within 24 hours and confirm the existing run is returned without new Provider requests.

## Supabase

1. Apply `supabase/migrations/20261007210000_revenue_lab_phase1.sql` in a development project first.
2. Apply `supabase/migrations/20261009100000_revenue_lab_tracking_v1.sql`. It backfills existing snapshots as Discovery and creates Tracking targets from successful historical collection runs.
3. Apply `supabase/migrations/20261009150000_revenue_lab_ai_analyst_v1.sql`. It adds only analysis requests, contexts, structured results, human reviews, and the analysis job type.
4. Apply `supabase/seed/revenue_lab_phase1.sql` only for a new installation. It creates three disabled starter themes with unset human Scores; edit and enable them in the dashboard.
4. Add `revenue_lab` to the API exposed schemas in Supabase project settings.
5. Enable the `pg_cron` extension before applying the Phase 1 migration if daily enqueueing is desired. The existing 05:15 JST cron calls the replaced enqueue function and therefore adds both Discovery and Tracking jobs.
6. Verify anon/authenticated roles cannot access the schema; the local server uses the service role.
7. Confirm only the intended themes are enabled; the database rejects more than three enabled themes.

Phase 2 rollback is `supabase/rollback/20261009150000_revenue_lab_ai_analyst_v1_down.sql`. It removes analysis data only. Tracking rollback is `supabase/rollback/20261009100000_revenue_lab_tracking_v1_down.sql`; apply it before the Phase 1 rollback. Do not run a rollback after retained data matters without exporting the schema first.

## OpenAI Phase 2 Live Validation

1. Apply the Phase 2 migration and restart AI Office so the server and local worker receive `OPENAI_API_KEY`.
2. Confirm Discovery and Tracking TOP3 still have the same scores, ranks, and ordering as before migration.
3. Select `TOP1をAI分析`. The UI deliberately sends `limit: 1`; the server rejects values above six.
4. Wait for the durable `opportunity.analyze` job to complete, then reload the dashboard.
5. Review that the output says it is metadata-only, uses confidence-bearing growth hypotheses, and does not claim to have watched the video or checked descriptions, transcripts, products, or links.
6. Only after output quality is accepted should a caller use `limit: 2` through `limit: 6` on `POST /api/revenue/analysis/jobs`.

The Responses request uses strict JSON Schema output, disables provider-side storage with `store=false`, and does not enable tools. The canonical fingerprint covers the exact stable input JSON. Prompt, schema, or requested-model changes create a separate cache identity.

## Google Cloud

1. Enable YouTube Data API v3 for the selected Google Cloud project.
2. Create an API key restricted to YouTube Data API v3.
3. Restrict the key by IP where the worker environment permits it.
4. Review quota usage. One Discovery query uses one `search.list`, one `videos.list`, and up to one `channels.list`. Tracking uses no search call and batches saved video and channel IDs in groups of at most 50.
   - Discovery: approximately 102 quota units per enabled theme/day (100 + 1 + 1).
   - Tracking: 1 unit per `videos.list` batch plus 1 unit per `channels.list` batch. With one theme discovering 25 unique videos every day, the seven-day window is at most about 150 prior-day targets, or approximately 6 units/day in the worst case where every video has a different channel.
   - Combined initial ceiling: approximately 108 units/day for one theme, or 324 units/day for three themes. Duplicate videos/channels reduce Tracking requests; unavailable videos do not add `search.list` calls.
5. Place the key only in the worker/server process environment.

## Run

```text
npm run revenue:worker
```

AI Office starts the worker automatically when all three required environment variables are available. `npm run revenue:worker` is also available for a dedicated process. A queued job remains in Supabase while the PC is off and is processed after the worker next starts.

To enqueue manually, open Revenue Lab and choose `Discovery実行` or `Tracking実行`. Each HTTP request creates queue rows and does not wait for YouTube collection.

## Operational Checks

- Dashboard health reports configuration readiness without revealing values.
- A manual enqueue appears as `pending`, then `running`, then `succeeded`.
- A worker interruption leaves a lease that becomes claimable after expiry.
- A query missing buyer intent or commerce fit displays `設定不足` and produces no opportunity rows.
- Stored opportunity rows contain `score_version = youtube-v1` and complete `score_parameters`.
- Discovery snapshots have `capture_kind = discovery`; Tracking snapshots have `capture_kind = tracking` and a `capture_job_id`.
- A Tracking interval below six hours is `waiting_interval` and does not create a snapshot or Score.
- Tracking results use `score_version = youtube-tracking-v1`; growth ratio and percent are display-only.
- AI requests persist exact input, SHA-256 fingerprint, model/prompt/schema versions, response metadata, and token usage without changing opportunity rows.

## Official References

- YouTube search: https://developers.google.com/youtube/v3/docs/search/list
- YouTube videos: https://developers.google.com/youtube/v3/docs/videos/list
- YouTube channels: https://developers.google.com/youtube/v3/docs/channels/list
- Supabase Data API: https://supabase.com/docs/guides/api
- Supabase Cron: https://supabase.com/docs/guides/cron
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI Responses API: https://developers.openai.com/api/docs/guides/migrate-to-responses
