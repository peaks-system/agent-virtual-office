# Revenue Lab Phase 1 Setup

## Environment

Set these only in the process environment used to start AI Office and the worker:

- `SUPABASE_URL` — project URL, for example `https://<project-ref>.supabase.co`.
- `SUPABASE_SERVICE_ROLE_KEY` — server/worker-only service-role key.
- `YOUTUBE_API_KEY` — server/worker-only YouTube Data API key.
- `REVENUE_LAB_WORKER_ID` — optional stable worker label; defaults to hostname/process ID.
- `REVENUE_LAB_POLL_INTERVAL_MS` — optional, defaults to 30000 and is bounded to 5000–300000.
- `REVENUE_LAB_JOB_LEASE_SECONDS` — optional, defaults to 300 and is bounded to 60–3600.
- `REVENUE_LAB_PROJECT_ID` — optional project UUID when more than one Revenue Lab project exists.

Do not put these values in source files, browser storage, `config/revenue-lab.json`, or Supabase tables.

## Supabase

1. Apply `supabase/migrations/20261007210000_revenue_lab_phase1.sql` in a development project first.
2. Apply `supabase/seed/revenue_lab_phase1.sql`. It creates three disabled starter themes with unset human Scores; edit and enable them in the dashboard.
3. Add `revenue_lab` to the API exposed schemas in Supabase project settings.
4. Enable the `pg_cron` extension before applying the migration if daily enqueueing is desired. The migration installs the 05:15 JST schedule only when the extension is available.
5. Verify anon/authenticated roles cannot access the schema; the local server uses the service role.
6. Confirm only the intended themes are enabled; the database rejects more than three enabled themes.

The matching rollback is `supabase/rollback/20261007210000_revenue_lab_phase1_down.sql`. Do not run it after production snapshots are needed without exporting the schema first.

## Google Cloud

1. Enable YouTube Data API v3 for the selected Google Cloud project.
2. Create an API key restricted to YouTube Data API v3.
3. Restrict the key by IP where the worker environment permits it.
4. Review quota usage. One query run uses one `search.list`, one `videos.list`, and up to one `channels.list` request; `search.list` carries the dominant quota cost.
5. Place the key only in the worker/server process environment.

## Run

```text
npm run revenue:worker
```

AI Office starts the worker automatically when all three required environment variables are available. `npm run revenue:worker` is also available for a dedicated process. A queued job remains in Supabase while the PC is off and is processed after the worker next starts.

To enqueue manually, open Revenue Lab and choose 「今すぐ収集」. The HTTP request creates a queue row; it does not wait for YouTube collection.

## Operational Checks

- Dashboard health reports configuration readiness without revealing values.
- A manual enqueue appears as `pending`, then `running`, then `succeeded`.
- A worker interruption leaves a lease that becomes claimable after expiry.
- A query missing buyer intent or commerce fit displays `設定不足` and produces no opportunity rows.
- Stored opportunity rows contain `score_version = youtube-v1` and complete `score_parameters`.

## Official References

- YouTube search: https://developers.google.com/youtube/v3/docs/search/list
- YouTube videos: https://developers.google.com/youtube/v3/docs/videos/list
- YouTube channels: https://developers.google.com/youtube/v3/docs/channels/list
- Supabase Data API: https://supabase.com/docs/guides/api
- Supabase Cron: https://supabase.com/docs/guides/cron
