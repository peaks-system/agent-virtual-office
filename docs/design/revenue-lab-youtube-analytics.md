# Revenue Lab YouTube Analytics Phase 3B

## Dashboard wireframe

```text
┌ YouTube Analytics ────────────────────────────────────────────────┐
│ 未設定 / 未接続 / 接続中 / 接続済み / 再認証が必要               │
│ [YouTube Analyticsを接続]   Channel: title (channel id)           │
│ token・client secret・credential_refは表示しない                  │
└───────────────────────────────────────────────────────────────────┘

Campaign実験台帳
└ Campaign
  └ Iteration
    └ YouTube Publication
      ├ 対象期間 [start] ～ [end] [Analyticsを取得]
      └ 最新Performance
        views / watch minutes / avg duration / avg %
        subscribers +/- / likes / comments / shares
        captured_at / data_through_date / query_version
```

## Component states

- `not_configured`: OAuth environment variable names only; no value is returned.
- `disconnected`: connect button enabled.
- `authorizing`: button disabled and system-browser guidance shown; Dashboard polls safe status.
- `connected`: channel identity and last verification time shown.
- `reauth_required`: explicit warning and reconnect button.
- Collection: idle, collecting, succeeded, no-data, and sealed-error states are Publication-local.

## Server flow

```text
POST /api/revenue/youtube-analytics/oauth/start
  -> bind 127.0.0.1:0
  -> generate state + PKCE in server memory
  -> open Google authorization URL in system browser
  -> loopback callback validates state
  -> exchange code (offline access)
  -> channels.list(mine=true)
  -> DPAPI credential store save(refresh token)
  -> service-role connection metadata upsert

POST /api/revenue/campaign-publications/:id/youtube-analytics/runs
  -> load Publication + active connection
  -> refresh access token in memory
  -> videos.list(id) and channel ownership check
  -> reports.query summary + day coverage
  -> atomic run/snapshot persistence
  -> safe snapshot response
```

## Secret boundary

The React app receives only `{configured, flowStatus, connection, latestSnapshot}`. OAuth state, PKCE verifier, authorization code, access token, refresh token, client secret, and `credential_ref` never cross `/api/revenue/*`. The credential file contains DPAPI ciphertext only and defaults to `%LOCALAPPDATA%\AI Office\Revenue Lab\youtube-analytics-credentials.json`.

## Data and time semantics

- Requested dates are inclusive Google Analytics dates.
- `captured_at` is server UTC time.
- Summary metrics come from the undimensioned report row.
- `data_through_date` is the maximum returned `day` from a companion daily coverage query; it is null for an empty report.
- An empty report creates a snapshot with nullable metrics and run status `no_data`.
