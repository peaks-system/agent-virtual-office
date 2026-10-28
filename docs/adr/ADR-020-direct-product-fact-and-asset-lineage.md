# ADR-020: Separate Direct Product facts from creative hypotheses

## Decision

Direct ProductをOpportunity起点の例外として偽装せず、明示的な`direct_product` lineageとして保存する。
商品事実は`curated_products`、正本素材は`product_assets`、訴求仮説は`campaign_iterations`に分離する。

## Rationale

ダミーOpportunityやAI Analysisは将来のPerformance比較を汚染する。商品事実と仮説を分けることで、
AIが未登録仕様を事実化することを防ぎながら、既存のPublicationとAnalytics lineageを再利用できる。

## Consequences

既存Campaignは`opportunity`を既定値として後方互換になる。Direct Product Campaignにはorigin行がなく、
起点はCampaignのlineageとIterationが参照するcurated productから追跡する。将来のCreative Productionは
assetの利用許諾を明示的に評価しなければならない。
