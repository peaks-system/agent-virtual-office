# Revenue Lab Product Candidate Finder Dashboard

## Placement

Inside each succeeded AI Opportunity Analyst panel, below the human analysis review controls.

```text
+ Product Candidate Finder -----------------------------------------+
| 楽天市場 / API 20260701 / 取得日時 / cached or fresh             |
| 検索語: [keyword] [keyword] [keyword]                             |
| [商品候補を検索]                                                  |
|                                                                   |
| #1 image  Provider商品名       Candidate 82.40                    |
|           ¥3,980 / 販売中 / shop / reviews / affiliate rate       |
|           上位理由 / 楽天で確認                                   |
|           [次の調査対象に選ぶ] [保留] [除外]                      |
+-------------------------------------------------------------------+
```

## States

- Not configured: list missing server-side variable names without values.
- Empty: explain that no product search has run.
- Pending/running: show durable job status.
- Succeeded/cached: show up to five ranked candidates and provider capture time.
- Failed: show a safe retry message without provider response bodies.

## Fact Boundary

Product name, price, availability, shop, URLs, images, reviews, and affiliate rate are labelled as Rakuten data captured at a stated time. Candidate explanations describe deterministic components only. “Select” always means select for the next human research step.

## Accessibility

External links open with `target="_blank"` and `rel="noopener noreferrer"`. Images use empty alternative text when the adjacent product title is present. Controls use visible Japanese labels and native buttons.
