# Revenue Lab Operations UI DSoT

Status: approved
Approved: 2026-10-28 by user-directed implementation
Spec: `docs/specs/revenue-lab-operations-ui.md`

## Information architecture

```text
Revenue Lab
├─ 今日やること (default)
│  └─ Human attention card × N
│     ├─ Campaign · Revision
│     ├─ 原稿確認 / 動画確認 / 公開待ち / 要確認
│     └─ one next CTA
├─ 商品
│  ├─ 今日の新着 / 継続上昇
│  ├─ 商品分析 / 商品登録
│  ├─ 登録済み
│  └─ Three Picks候補 / Three Picks選択
├─ 制作
│  ├─ latest Planner v4 Revision
│  ├─ 原稿 + origin badge + review badge
│  ├─ TTS / timing
│  └─ MP4 / Preview
├─ 公開・分析
│  ├─ publication readiness checklist
│  ├─ completed video / Preview
│  ├─ title / description / product links
│  ├─ Publication registration
│  └─ YouTube Analytics / performance
└─ 設定・監査 (outside normal nav)
   ├─ technical IDs / versions / raw timing / lineage
   ├─ API and Analytics connection / Query Settings
   └─ legacy production and Campaign history
```

## Desktop layout

```text
┌ Revenue Lab ───────────────────────────────────────── 更新 ┐
│ [今日やること] [商品] [制作] [公開・分析]                  │
└────────────────────────────────────────────────────────────┘

┌ 今日やること ─────────────────────────────────────────────┐
│ Campaign name                         Revision 18           │
│ 原稿確認 · 自動修正を確認してください      [制作を確認]     │
└────────────────────────────────────────────────────────────┘

                         ▸ 設定・監査
```

Cards use the existing Revenue Lab surface, border, green, and warning colors. Normal copy is 16px with a 1.65 line height. Repaired copy is amber, safe copy is strong blue, and manually edited copy is violet. Review state is visually separate and neutral.

## Narrow layout

- The four-area navigation scrolls horizontally without hiding labels.
- Cards and readiness items collapse to one column.
- CTAs remain full-width and keyboard reachable.
- Audit stays collapsed below the active normal area.

## Copy review example

```text
PICK 1
商品名

訴求
「開けるとLEDが点灯」  [自動修正] [未確認]

TTS
「蓋を開けるとライトが点く車載ダストボックスです」 [AI生成] [確認済み]
```

Origin and review are independent metadata axes. Absence of persisted review metadata renders `未確認`; the UI never invents confirmation.

## Three Picks material preparation

Product selection and production-material readiness are separate axes.

```text
Three Picks候補
┌ 商品名 ────────────────────────┐
│ 商品選択  選択可能              │
│ 制作素材  未準備                │
│                         [選択]  │
└────────────────────────────────┘

3商品選択 → building Campaign

制作素材を準備
┌ PICK 1 / 商品名 ───────────────┐
│ 商品情報 ✓                     │
│ 制作素材 未準備                │
│ [素材を追加] [AIで素材を作る]   │
└────────────────────────────────┘

全PICK準備済み → [制作を開始]
```

- Missing Asset Revisions never render as product ineligibility.
- `building` Campaigns surface `制作素材の準備` in Today and Production.
- The material card shows an existing preview when available; the AI action is an explicit unavailable placeholder in this phase.
- `制作を開始` performs the explicit lock operation. Planner generation becomes available only after the refreshed Product Set is `locked`.
