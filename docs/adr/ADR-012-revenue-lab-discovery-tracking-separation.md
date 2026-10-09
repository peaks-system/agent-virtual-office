# ADR-012: Separate Revenue Lab Discovery and Tracking

- Status: Accepted
- Date: 2026-10-09
- Applies to: `revenue_lab` snapshots, jobs, scoring, and Dashboard read model

## Decision

Discovery and Tracking share immutable source items and metric snapshots, but every snapshot records its capture kind and job. Discovery scores read only Discovery baselines. Tracking uses a separate job type, target/run/opportunity tables, and score version.

## Rationale

Daily search results churn and cannot observe videos that leave the search result. A separate ID-based Tracking pipeline preserves Discovery behavior, avoids additional search calls, provides explicit previous/current snapshot provenance, and allows future trend classification without rewriting `youtube-v1` history.

## Consequences

- Existing Discovery data and APIs stay compatible.
- Tracking adds an additive migration and one daily job per enabled YouTube source.
- The worker/provider boundaries remain replaceable by a cloud runner.
- Growth ratios are retained for validation but do not affect Tracking v1 scores.
