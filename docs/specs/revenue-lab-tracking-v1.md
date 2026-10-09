---
status: frozen
feature: revenue-lab-tracking-v1
approved: 2026-10-09
---

# Revenue Lab Tracking v1

## Objective

Keep the existing YouTube Discovery pipeline and immutable `youtube-v1` results, while following previously discovered videos for seven days and ranking their observed growth separately.

## Invariants

- Discovery remains `search.list` → `videos.list` → `channels.list`, at most 25 results per enabled query.
- Discovery previous snapshots use `capture_kind = discovery` only.
- Tracking never calls `search.list`; it batches saved IDs in groups of at most 50 for `videos.list` and `channels.list`.
- Tracking prefers the latest Tracking snapshot as its baseline. Only the first Tracking observation may use the latest Discovery snapshot.
- An interval below six hours is recorded as `waiting_interval`, is not scored, and does not create a Tracking snapshot.
- Missing videos increment `missing_count`; three consecutive misses retire the target.
- Tracking lasts seven days from first discovery. Same-day discoveries enter Tracking on the next JST day.
- `youtube-tracking-v1` reuses all `youtube-v1` weights, percentile, rounding, and tie-break policies. `growth_ratio` and `growth_percent` are display-only.
- Existing Discovery opportunities are never rewritten or recomputed.

## Persistence

Snapshots carry `capture_kind` and `capture_job_id`. Tracking targets, runs, run items, and opportunities use separate tables. A source item and job can create at most one snapshot, making retries idempotent.

## Read Model

The existing `opportunities` field remains Discovery-compatible. New fields are `trackingOpportunities` and `latestTrackingRun`. The Dashboard renders “本日の発掘TOP3” and “継続観測・急伸TOP3” separately.

## Acceptance Criteria

1. Historical snapshots are backfilled as Discovery snapshots and can seed the first Tracking delta.
2. Tracking snapshots cannot affect Discovery velocity or ranking.
3. Six-hour, missing-three-times, version separation, batching, and Dashboard separation have automated tests.
4. The migration is additive and has a rollback script.
