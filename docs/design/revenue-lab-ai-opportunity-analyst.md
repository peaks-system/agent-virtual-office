# Revenue Lab AI Opportunity Analyst Design

Status: Approved for Phase 2 v1

## Dashboard Extension

```text
+------------------------------------------------------------------+
| AI OPPORTUNITY ANALYST                      [TOP1をAI分析]         |
| 保存済みメタデータだけを読み、Scoreと順位は変更しません           |
+------------------------------------------------------------------+
| Existing Discovery card #1                                      |
| ... existing score and evidence ...                              |
| AI分析: pending / running / cached / succeeded / failed          |
| [商品・テーマ] [推奨: 採用/保留/除外] [根拠品質]                 |
| 成長仮説: confidence + supporting indicators                     |
| 次の企画 / Hook / 商品検索キーワード             [詳細を見る]   |
| 人間評価: [採用] [保留] [除外]                                  |
+------------------------------------------------------------------+
| Existing cards retain their deterministic order                  |
+------------------------------------------------------------------+
```

## Interaction

- The validation button submits `limit: 1`. It never starts analysis automatically.
- A cached result is shown immediately; otherwise the durable job status is shown after refresh.
- No progress wording implies that the model is watching a video.
- Analysis is visually subordinate to Opportunity and Breakout scores.
- Human feedback records a decision and optional note without modifying the AI result.

## States

- Not configured: explain that `OPENAI_API_KEY` must be added server-side; Phase 1 controls remain usable.
- Not analyzed: show the one-video manual validation action.
- Pending/running: show queue status and ask the user to refresh after the local worker completes.
- Succeeded/cached: show recommendation, confidence-bearing hypotheses, and concise next actions.
- Failed/refused/incomplete: show a safe retry-oriented message without provider response bodies.

## Accessibility and Responsive Behavior

- Status is conveyed by text as well as color.
- Disclosure controls use native `details`/`summary`.
- Human-decision buttons have visible labels and remain keyboard reachable.
- On narrow screens, the analysis block stacks under existing card metrics without changing card order.
