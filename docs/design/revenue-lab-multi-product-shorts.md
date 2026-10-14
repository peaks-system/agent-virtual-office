# Revenue Lab Multi-product Shorts DSoT

Approved: 2026-10-13

```text
Campaign Iteration · Three Picks
├─ Product Set · human · 3 products
│  ├─ PICK 1 · Product name · Asset Revision · one fact · optional price
│  ├─ PICK 2 · Product name · Asset Revision · one fact · optional price
│  └─ PICK 3 · Product name · Asset Revision · one fact · optional price
├─ [Three Picks制作案を生成]
│  └─ Plan revision · Hook · presentation order · appeals · Summary · CTA
└─ [Shorts MP4を合成]
   └─ 1080×1920 · 30fps · 約20秒 · 音声なし
      ├─ queued / rendering / succeeded / failed
      ├─ immutable output lineage + SHA-256
      └─ preview when succeeded
```

```text
Three Picksを作成 · Human selection
├─ 選択数 0 / 3 · presentation order is selection order
├─ 商品候補pool（eligible件数にかかわらず常時表示）
│  └─ Candidate card × N
│     ├─ checkbox · Product image · Product name · merchant
│     ├─ Verified facts: あり / なし
│     ├─ Commerce destination: あり / なし
│     ├─ Product Asset Revision: あり / なし
│     ├─ eligible / not eligible + 理由
│     └─ [Asset Revisionを準備]（owned / 利用許可済み素材のみ）
├─ [商品を追加] → 既存Direct Product Intakeを開く
└─ [Three Picksを作成]（eligibleな3商品選択時のみ有効）
```

The candidate pool is not progressive disclosure: it stays visible even when empty or when fewer than three products are eligible. Checkbox selection order is presentation order, never rank. The existing Direct Product Intake and Product Asset Revision action are reused in place. The normal Campaign ledger shows product names, selected Asset Revision, plan/render status, and the two actions. Verified facts, fingerprints, render manifest, and technical output details stay in expandable details. No ranking wording or score is shown. Existing single-product Campaign and Creative Production panels retain their current layout and behavior.
