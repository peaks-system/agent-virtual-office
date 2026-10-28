---
status: frozen
title: Revenue Lab YouTube Analytics Manual Snapshot v1
primary_domain: revenue-lab
secondary_domains: [api, data-pipeline, security, ui]
---

# Revenue Lab YouTube Analytics Manual Snapshot v1

## Goal

Connect one operator-owned YouTube channel through a local Google Desktop OAuth flow and persist one manually requested performance snapshot for an existing Campaign Publication without exposing OAuth credentials outside the server process and its local credential store.

## Acceptance Criteria

- AC-1: OAuth uses the system browser, an ephemeral `127.0.0.1` loopback redirect, authorization code flow, SHA-256 PKCE, one-time state validation, `access_type=offline`, and only `yt-analytics.readonly` plus `youtube.readonly` scopes.
- AC-2: Access tokens exist only in server memory. Refresh tokens are persisted only through `YouTubeAnalyticsCredentialStore`; the Windows implementation uses CurrentUser DPAPI in a repository-external local file. Tokens and the OAuth client secret never enter Supabase, React state, logs, or API responses.
- AC-3: OAuth completion calls `channels.list?mine=true` and persists only non-secret connection metadata. The Dashboard identifies the connected channel and clearly shows `reauth_required`.
- AC-4: Manual collection accepts an existing `campaign_publications` row and an explicit inclusive date range. Before Analytics collection it verifies that `videos.list` resolves the publication and that its channel matches the connection.
- AC-5: The `youtube-analytics-v1` report saves nullable `views`, `estimatedMinutesWatched`, `averageViewDuration`, `averageViewPercentage`, `subscribersGained`, `subscribersLost`, `likes`, `comments`, and `shares`; unavailable values remain null.
- AC-6: Each run and snapshot retains Publication -> Iteration -> Campaign lineage, requested dates, capture time, provider data-through date, query version, requested metrics, and raw provider metrics without credentials.
- AC-7: Empty Analytics rows are stored as a successful `no_data` run and a nullable snapshot, never as zero-filled facts.
- AC-8: OAuth rejection, state mismatch, code/PKCE exchange failure, revoked refresh token, channel mismatch, video unavailable, unconfirmed data, and Google API errors are normalized to bounded safe error codes.
- AC-9: All new tables and RPCs explicitly revoke PUBLIC, `anon`, and `authenticated`, and grant only `service_role`.
- AC-10: The Dashboard exposes safe connection status, a connect action, connected channel, Publication-level date inputs and collection action, and the latest snapshot. It never receives a token, client secret, state, code verifier, or credential reference.
- AC-11: Existing Discovery, Tracking, Opportunity Score, AI Analyst, Manual Campaign, Rakuten Provider, Candidate Score, worker collection, and rank behavior are unchanged.

## Non-goals

Automated measurement schedules, Cron collection, retention segments, YouTube Reporting API, impressions, CTR, affiliate outcomes, AI Campaign Review, and Score v2.

## Environment Contract

- `YOUTUBE_ANALYTICS_CLIENT_ID`: Google OAuth Desktop App client ID.
- `YOUTUBE_ANALYTICS_CLIENT_SECRET`: Google OAuth Desktop App client secret, server-only.
- `YOUTUBE_ANALYTICS_CREDENTIAL_STORE_PATH`: optional absolute path outside the repository; defaults under `%LOCALAPPDATA%`.

## Rollback

Disable the Phase 3B API/UI wiring, remove the isolated OAuth/Analytics modules, and apply the paired Phase 3B down migration. Phase 1–3A and Product Candidate Finder data remain intact.
