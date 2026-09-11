# SEO diagnostic mode

Select an existing project, save its public HTTP(S) URL, then choose `公開サイトを診断`. Results distinguish observed facts, hypotheses and unknowns. The crawler samples at most 10 pages, 30 requests, 30 seconds, 512 KiB per response and 3 MiB total. Only the exact registered hostname and standard ports are allowed. Private/reserved IPs, credential URLs and cross-host redirects are blocked. DNS results are pinned to prevent rebinding.

Static HTML is inspected without executing JavaScript. Robots restrictions and network limits may leave pages uninspected. Broken-link results cover sampled links only. Thin/duplicate content is a heuristic; public results cannot establish Google's index status or guarantee rankings.

## Google connection (human operated)

1. In Google Cloud, select/create a project and enable Google Search Console API.
2. Configure the OAuth consent screen and a Desktop app OAuth client. If in testing mode, add your Google account as a test user. Download the client JSON outside the repository; never paste its contents into chat.
3. Expand `Google接続の準備`, select `認証用JSONを読み込む`, then `Search Consoleに接続`. Complete consent yourself in the system browser. Only `https://www.googleapis.com/auth/webmasters.readonly` is requested.
4. Retrieve accessible sites, select the property covering the saved URL, and fetch Google data. Search analytics cover the preceding 28 Pacific dates, at most 100 rows; URL Inspection covers the registered URL, not every sampled page. Google quotas, permissions and missing data remain explicit limitations.

Client information and tokens are encrypted with Windows CurrentUser DPAPI under `%LOCALAPPDATA%/AI-Office/seo/search-console.dpapi`. They are never included in diagnostic persistence or AI input. No plaintext fallback exists. Google connection is Windows-local only; container/non-Windows Google authorization is unavailable. Disconnect removes local tokens; it does not revoke the app in your Google account.

## AI workflow and storage

`AIスタッフに改善案を依頼` sends selected diagnostic/search data through the existing Codex login. Research, strategy, engineering, quality and PM run sequentially with separate histories/workspaces/memory. The president is excluded. Defaults remain Terra, medium (low optional); Astra requires explicit approval for each run. No tools or publishing are allowed. Stage prompts are in `config/seo-workflow.json` and base roles in `config/staff.json`.

Diagnostics live in ignored `.office-work/seo`; AI records in `.office-work/seo-staff`. Browser project backup does not include these server records or encrypted credentials. Preserve these directories when backing up; do not add them to Git. Revert the feature commit to roll back code while retaining local data. Existing Start-Office.cmd/Stop-Office.cmd and copyright/license remain unchanged.
