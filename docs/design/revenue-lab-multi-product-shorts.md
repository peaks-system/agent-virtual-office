# Revenue Lab Multi-product Shorts DSoT

Status: approved
Approved: 2026-10-14

```text
Revenue Lab · normal workflow
[1 商品] ──→ [2 Three Picks制作] ──→ [3 MP4] ──→ [4 公開・分析]
   登録          3商品を選択             合成          Publication / Analytics
```

Campaign、Iteration、Publication、Analyticsはこの導線の内部DSoTとして維持する。通常画面は制作タスクを
主語にし、台帳、revision、SHA、prompt/schema version、fingerprint、lineage IDは「履歴・監査情報」へ置く。

```text
Three Picks制作
├─ Product Set · human · 3 products
│  ├─ image · display_name · short_appeal · fact_badge
│  ├─ image · display_name · short_appeal · fact_badge
│  └─ image · display_name · short_appeal · fact_badge
├─ [Three Picks制作案を生成]
│  └─ display_name · short_appeal · fact_badge · tts(text only)
└─ [Shorts MP4を合成]
   └─ 1080×1920 · 30fps · 約20秒 · 音声なし
      ├─ queued / rendering / succeeded / failed
      └─ preview when succeeded

[履歴・監査情報]
└─ Campaign / Iteration / Product Set / Asset Revision / SHA-256 / prompt・schema version / fingerprints
```

```text
Three Picksを作成 · Human selection
├─ 選択数 0 / 3 · presentation order is selection order
├─ 商品候補pool（eligible件数にかかわらず常時表示）
│  └─ Candidate card × N
│     ├─ checkbox · Product image · display_name
│     ├─ eligible / not eligible
│     ├─ short_appeal
│     ├─ fact_badge
│     └─ [Asset Revisionを準備]（owned / 利用許可済み素材のみ）
├─ [商品を追加] → 既存Direct Product Intakeを開く
└─ [Three Picksを作成]（eligibleな3商品選択時のみ有効）
```

The candidate pool is not progressive disclosure: it stays visible even when empty or when fewer than three products are eligible. Checkbox selection order is presentation order, never rank. The existing Direct Product Intake and Product Asset Revision action are reused in place. Direct Product normal input excludes Campaign name, objective, appeal hypothesis, Hook, outline, and script. Verified facts use a compact confirmation plus expandable detail. Technical lineage stays in expandable history/audit details. No ranking wording or score is shown. Existing lineage and single-product production behavior remain intact.
