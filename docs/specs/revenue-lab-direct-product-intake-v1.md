# Revenue Lab Direct Product Intake v1

Status: frozen for implementation
Approved: 2026-10-14

## Purpose

人間が指定した商品または自社商品を、OpportunityやAI Analysisを捏造せずCampaignへ接続する。

## Lineage

- `curated_products.source_kind = direct_product`
- `campaigns.lineage_kind = direct_product`
- `analysis_id`、`source_item_id`、`primary_analysis_id`、`source_analysis_id`はnull
- `campaign_origins`は作成しない
- Campaign、Iteration、Publication、YouTube Analyticsは既存構造を利用する

## Product facts

通常UIでは人間が商品URL、商品名、販売元、任意のcommerce destination、Product Asset、素材利用可否を登録する。
価格、通貨、カテゴリ、確認済み事実、注意事項、自社商品フラグは保持するが、補助的な確認・詳細入力として扱う。
これらは`fact_source = human_verified_direct_intake`としてsnapshotへ固定する。AI生成の内容を商品事実へ
書き込まない。

確認済み事実はThree Picks eligibilityに必要だが、Creative画面へ全文を常時表示しない。通常表示は短い
fact badgeと確認状態に限定し、全文は折り畳みの詳細・監査情報から確認する。

## Product assets

1商品につき最大10件。各素材はHTTPS URL、ordinal、kind、source、usage permission、任意ラベルを持つ。
素材は将来のCreative Productionにおける実商品正本候補だが、URL内容を自動訪問・確認した事実を表さない。
`usage_permission = unknown`の素材は将来の自動生成で利用可能とみなさない。

## Campaign creation

Direct Product、Campaign、draft Iterationを1つのservice-role RPC transactionで作る。Publicationは作らない。
通常利用者はCampaign名、目的、訴求仮説、Hook、構成、台本を入力しない。Campaign名は商品名から
deterministicに生成し、DB必須のdraft Iteration Creative列には固定・中立・識別可能なplaceholderを保存する。
placeholderは商品登録lineageの維持だけに使用し、Three Picks Plan、Product Card、MP4、PublicationへCreative
として流用しない。実際のCreative表現はThree Picks Planが選択済みverified factsから生成する。

- Campaign名: `<空白正規化済み商品名> · 商品登録`（全体を最大120文字へdeterministicに切り詰める）
- `appeal_hypothesis`: `[INTERNAL:DIRECT_PRODUCT_REGISTRATION_ONLY]`
- `hook_text`: `[INTERNAL:NO_CREATIVE_HOOK]`
- `content_outline.text`: `[INTERNAL:NO_CREATIVE_OUTLINE]`
- `content_outline.format = internal_placeholder`、`content_outline.reusable = false`、`script_text = null`

Dashboardは`format`と`reusable`を判定し、このIterationのCreative表示、編集、Creative Production生成を
通常導線から除外する。これによりplaceholderはlineageを満たす内部記録の外へ流れない。

UUID idempotency keyとcanonical request/treatment fingerprintにより二重送信を防止する。

## Security

新規tableとRPCは`PUBLIC`、`anon`、`authenticated`から権限をrevokeし、`service_role`だけに許可する。
ブラウザはSupabaseへ直接アクセスせず、`/api/revenue/direct-products/campaigns`だけを利用する。

## Out of scope

動画生成Provider、素材ダウンロード、画像内容解析、AIによる商品仕様補完、Score v2は実装しない。
