# Revenue Lab Campaign Learning Loop

## Lineage

```text
Opportunity context -> AI analysis -> human-verified product -> Campaign
  -> Campaign Iteration (product + appeal + hook + outline/script)
  -> YouTube publication -> Performance/Retention/Affiliate -> AI review -> human decision
```

Campaign is the long-lived experiment envelope. Campaign Iteration is the immutable treatment and future learning-example unit. A published treatment is never edited; product, appeal, hook, or structure changes create another iteration.

## Phase 3A Dashboard

Each successful AI analysis shows search links for every saved `product_search_keyword`, followed by a manual entry form. Submission atomically creates the product, Campaign, copied opportunity contexts, and iteration. Publication is optional: a real Video ID supplied at creation creates it immediately; otherwise the iteration remains `draft`, no publication row is created, and the Campaign Board provides a later registration action. A separate Campaign Board shows the saved origin types and score versions, human-verified product, creative treatment, lifecycle states, and YouTube link when available.

## Campaign ledger operations v1

The normal ledger shows non-voided Campaigns. A collapsed `無効化したCampaign` section retains voided history and its reason. Each unpublished draft card contains an inline creative editor for appeal hypothesis, Hook, outline, and script plus a guarded `下書きCampaignを削除` action when the backend read model confirms no evidence exists. A published or otherwise locked Iteration never shows the editor; it shows `この内容から新Iteration` and creates a new draft while keeping the original card unchanged. Evidence-bearing Campaigns show a reason-selecting `Campaignを無効化` action instead of hard delete.

All operation results are reloaded from the server. The browser's eligibility labels are explanatory only; database RPCs re-check status, Publication, Analytics, and evidence-marker constraints atomically.

Rakuten Product Candidate Finder remains available in a secondary optional panel. Missing Rakuten credentials do not block or warn against the manual flow.

The manual form creates one UUID per save operation, locks synchronously on submit, and shows a persistent saved state after success. `campaign_creation_requests` makes the RPC retry-safe on `(project_id, idempotency_key)` and verifies both the canonical full-request fingerprint and treatment fingerprint before returning an existing result. The treatment fingerprint is audit evidence, not a global uniqueness key, so intentional later experiments remain possible.

## Lifecycle Separation

- Campaign: `active -> completed | stopped`.
- Iteration: `draft -> ready_to_publish -> published -> measuring -> review_due -> closed`.
- Phase 3A creates an active Campaign. An iteration without a video ID is `draft`; adding a real video ID makes it `ready_to_publish`, and providing `published_at` makes it `published`.

## Publication Revision Boundary

Phase 3A stores `initial_metadata` on the publication. A later additive `publication_revisions` table will store revision number, captured time, title, thumbnail URL, description, source, and a content fingerprint. Analytics and reviews will join the revision effective at each measurement time instead of reading mutable current metadata.

Planned identity is `(campaign_publication_id, revision_number)`. Each row also carries `effective_from`, nullable `effective_to`, `captured_at`, `title`, `thumbnail_url`, `description`, `revision_source`, and `content_fingerprint`. Performance facts remain attached to the publication/iteration and resolve the revision by measurement time; revisions never rewrite the initial treatment.

## Analytics and Reporting Boundary

YouTube Analytics will be the Phase 3B/3C provider for views, watch time, average duration/percentage, subscribers, and retention. A later `YouTubeReachProvider` backed by YouTube Reporting may add impressions and CTR without changing Analytics snapshots.

Planned additive structures include `youtube_analytics_connections`, `campaign_measurement_schedules`, `youtube_analytics_runs`, `youtube_performance_snapshots`, and `youtube_retention_segments`. Performance and retention rows will reference `campaign_publication_id` and therefore its immutable Campaign Iteration treatment.

Separately, planned `youtube_channel_snapshots` uses `(youtube_analytics_connection_id, youtube_channel_id, captured_at, period_start, period_end)` as its observation identity and stores:

- channel totals: `subscriber_count`, `total_views`, `video_count`;
- period facts: `period_views`, `period_watch_time_minutes`, `period_subscribers_gained`, `period_subscribers_lost`;
- provenance: `provider`, `provider_run_id`, `provider_payload`, and metric availability flags.

This series is channel-scoped rather than Campaign-scoped. Campaign results can be compared with the channel series over six- and twelve-month windows without attributing all channel growth to one Campaign.

YouTube Analytics API is authoritative for the MVP performance and retention metrics. A provider-neutral `reach_metric_snapshots` extension can later accept YouTube Reporting API impressions and thumbnail CTR, with `provider`, `metric_definition_version`, period, and publication/channel references. Phase 3B/3C does not require that provider.

## OAuth Boundary

Local Windows uses a Google OAuth Desktop app with authorization code, state, PKCE, offline access, and an exact `127.0.0.1` loopback redirect. Refresh tokens live behind `YouTubeAnalyticsCredentialStore`; the Phase 3B implementation uses CurrentUser DPAPI ciphertext in a repository-external Local App Data file. Supabase stores only connection metadata and a credential reference. Browser responses never contain access or refresh tokens.
# Direct Product Intake boundary

CampaignはOpportunity起点だけでなく、`direct_product`起点も持てる。Direct Product Intakeは
Discovery、AI Opportunity Analyst、Commerce Translationを通らず、ダミーのOpportunityや
AI Analysisを作成しない。`campaigns.lineage_kind`が起点を明示し、Direct Productでは
`source_item_id`、`primary_analysis_id`、`campaign_iterations.source_analysis_id`をnullに保つ。

人間が確認した商品事実は`curated_products`とその`facts_snapshot`へ保存し、訴求仮説、Hook、
構成、台本は`campaign_iterations`のcreative hypothesisとして分離する。AIは商品事実の領域を
補完・改変せず、将来AIをCreative Productionへ接続する場合も登録済み事実だけを根拠にする。

`product_assets`は実商品の正本素材レジストリである。素材URLだけでなく、素材種別、入手元、
利用許諾を保存する。URLの内容を自動取得・検証したという意味ではなく、人間が登録した素材と
権利情報の監査記録である。将来の生成処理は`owned`、`licensed`、
`authorized_reference`のように明示された許諾を見て使用可否を判断し、`unknown`を自動使用しない。
# Creative Production v1 boundary

After a Campaign Iteration is saved, Creative Production may create an immutable, provider-neutral YouTube Shorts plan. Its frozen input records the exact Campaign/Iteration creative hypothesis, selected product, verified product facts, and Product Asset metadata used at generation time. Product facts remain separate from creative hypotheses, and real-product scenes reference Product Asset IDs rather than model-generated product appearances.

Regeneration appends a numbered revision. A future rendering provider adapter consumes the saved `provider-neutral-shorts-v1` export; it does not change the Campaign Iteration, the plan revision, or upstream Opportunity/Analysis/Commerce Translation lineage.
