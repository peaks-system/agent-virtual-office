# ADR-011: Revenue Lab Job and Secret Boundary

- Status: Accepted
- Date: 2026-10-07
- Applies to: `scripts/revenue-*`, `scripts/revenue-lab/*`, `supabase/migrations/*revenue_lab*`, `src/components/RevenueLabDashboard*`

## Context

Revenue Lab needs durable scheduled work even when the local PC is stopped, while YouTube and Supabase privileged credentials must remain outside the browser and database. Phase 1 uses a local worker, but the execution mechanism must be replaceable later.

## Decision

Create a dedicated `revenue_lab` PostgreSQL schema. Supabase Cron enqueues database rows once daily; it never calls the local machine. A local worker polls and atomically claims jobs with expiring leases. Job handlers depend on injected storage and provider interfaces and do not own the polling loop.

The browser communicates only with `/api/revenue/*`. The local server and worker read `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `YOUTUBE_API_KEY` from their process environment. Credentials are never sent to the browser, written to configuration, or stored in Supabase rows.

The initial adapter uses PostgREST through Node's built-in `fetch`. This avoids a new dependency while preserving an explicit storage boundary. Score computation is a pure module and persists complete version metadata.

## Alternatives Considered

- Direct browser-to-Supabase: rejected because it expands the client trust boundary and risks privileged key exposure.
- Cron directly calling the local worker: rejected because the PC may be offline and inbound connectivity is not required for the MVP.
- In-process server scheduler: rejected because queued work would be lost while the PC is stopped.
- Supabase SDK: deferred because built-in fetch covers the narrow Phase 1 contract without another dependency.
- Edge Function execution: deferred; the injected handler boundary keeps this migration possible.

## Consequences

Positive:

- Jobs remain pending while the PC is off.
- Secrets stay in server/worker process memory.
- Local and future cloud runners can share the handler contract.
- Score computation remains independently testable and replayable.

Negative:

- Operators must enable the custom schema for PostgREST and configure service-role credentials locally.
- Queue health depends on the database claim function and worker lease behavior.
- Phase 1 has no remote worker while the PC is off; collection runs after the next local startup.
