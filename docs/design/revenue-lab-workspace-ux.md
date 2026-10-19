# Revenue Lab Workspace UX v2 DSoT

Status: approved
Approved: 2026-10-19
Spec: `docs/specs/revenue-lab-workspace-ux.md`

## Route states

```text
AI Office             /
Revenue Lab           /revenue-lab?lang=ja
Selected Campaign     /revenue-lab?lang=ja&campaign=<campaign-id>

department click  → history.pushState
invalid selection → history.replaceState with deterministic active fallback
back / forward     → popstate → derive workspace from URL
F5                 → initial derive from URL
```

Every URL update starts from the current `URL`, preserving unrelated query parameters. Leaving Revenue Lab removes only `campaign` and changes the pathname to `/`.

## Desktop workspace

```text
┌──────────────────────────────── AI CORPORATION HEADER ────────────────────────────────┐
│ AI Office | Revenue Lab                                                               │
└────────────────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────── STICKY REVENUE WORKSPACE HEADER ──────────────────────────────┐
│ Campaign: Three Picks 秋冬企画       Iteration 3       Creative Revision 4             │
│ ● 商品  ─  ● 制作案  ─  ◉ 音声  ─  ○ 動画  ─  ○ 公開・分析                          │
│ Next: ナレーションを生成                              [Revenue Lab更新] [Primary CTA] │
│ reason/status message directly below the action when disabled                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
┌────────────── CAMPAIGN SELECTOR ──────────────┐  ┌────────── CURRENT STEP ────────────┐
│ active Campaigns only                         │  │ 3. 音声                            │
│ selected Campaign highlighted                 │  │ readiness summary                  │
│                                               │  │ scene timing summary               │
│ ▸ Archive (voided/rejected)                   │  │ local blocker / primary action      │
└───────────────────────────────────────────────┘  │ ▸ 開発・Live Validation操作         │
                                                   └────────────────────────────────────┘
┌──────────────────────────── COMPLETED STEPS · COMPACT ────────────────────────────────┐
│ ✓ 商品  3商品選択済み    ✓ 制作案  Revision 4                                         │
└────────────────────────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────── 監査情報 ────────────────────────────────────────────┐
│ ▸ 過去Iteration / Revision / Legacy v1 / UUID / SHA / versions / lineage              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## Narrow workspace

```text
┌──────── Sticky header ────────┐
│ Campaign name                 │
│ Iteration 3 · Revision 4      │
│ 商品 ● ● ◉ ○ ○ 公開          │
│ Next action                   │
│ [Primary CTA] [更新]          │
└───────────────────────────────┘
┌──────── Current step ─────────┐
│ expanded content              │
└───────────────────────────────┘
▸ 完了Step
▸ 監査情報
▸ Archive
```

## Component structure

```text
CorporationDashboard
├─ department route adapter (URL ↔ office/revenue)
└─ RevenueLabDashboard
   ├─ workspace model (pure selection/progress/action derivation)
   ├─ RevenueWorkspaceHeader (sticky)
   ├─ ActiveCampaignSelector
   ├─ RevenueStepList
   │  ├─ compact completed step
   │  └─ expanded current step
   ├─ AuditInformation
   │  ├─ past Iterations and Revisions
   │  └─ Legacy v1 · read only
   └─ CampaignArchive
```

Business/status derivation lives in the pure workspace model, not in rendering components. Existing service functions remain the only mutation boundary.

## Step visual states

| State | Marker | Presentation |
|---|---|---|
| complete | filled green check | one compact summary row |
| current | gold ring | expanded panel and one primary CTA |
| pending | neutral outline | compact label only |
| blocked | warning ring | expanded reason beside disabled CTA |
| running | animated status text, reduced-motion safe | disabled CTA; transient polling active |

Progress labels are exactly: `商品`, `制作案`, `音声`, `動画`, `公開・分析`.

## Primary action matrix

| Snapshot condition | Current step | Primary action |
|---|---|---|
| no current Product/Product Set | 商品 | no production CTA; show product-selection guidance |
| no persisted v2 plan | 制作案 | `制作案を生成` |
| v2 plan has planned audio | 音声 | `ナレーションを生成` |
| audio queued/generating | 音声 | disabled `ナレーション生成中` |
| audio failed/uncertain/missing duration | 音声 | disabled action + local recovery reason |
| all audio ready, timing overflow | 音声 | disabled `Shorts MP4を生成` + scene `required / max` |
| all audio ready and timing fits | 動画 | `Shorts MP4を生成` |
| composition queued/rendering | 動画 | disabled `Shorts MP4生成中` |
| completed output | 動画 | `Previewを確認` |
| publication exists, analytics absent | 公開・分析 | `Analyticsを取得` |
| analytics snapshot exists | 公開・分析 | completed; refresh is utility action only |

When configuration prevents the action, the same action remains visible but disabled and the human-readable missing requirement appears immediately beside it.

## Information hierarchy

Normal workspace may show product names, Campaign name, Iteration/Revision numbers, copy, readiness counts, measured scene duration, composition state, publication state, and human-readable errors.

Audit Information exclusively owns Campaign/Iteration/Plan/request/artifact/output UUIDs, SHA values, prompt/schema/provider/model versions, fingerprints, RPC terminology, object/storage coordinates, internal placeholders, past Revision lists, and legacy controls/history.

## Refresh behavior

```text
mount ────────────────→ refresh once
manual update ────────→ refresh once
window focus ─────────→ refresh once
visibility → visible ─→ refresh once

transient work + visible ─→ 3000 ms timer ─→ refresh ─┐
          idle or hidden ─→ no timer / clear timer ←──┘
```

Transient work includes Dashboard job `queued|running`, audio `queued|generating`, and Composition `queued|rendering`. Only one polling timer may exist.

## Layout tokens

- Sticky header: `position: sticky`, `top: 0`, `z-index: 8` inside `.revenue-shell`.
- Header surface: existing white card background, `1px` existing green-gray border, `12–16px` radius, subtle existing shadow.
- Current step accent: existing corporate green plus gold emphasis already used by Revenue Lab actions.
- Desktop workspace: selector column `minmax(220px, 300px)` plus fluid current-step column.
- Below `760px`: single column; Campaign selector collapses above current step; actions wrap without horizontal scrolling.
- Focus styles reuse the existing `.corp-dashboard :focus-visible` rule.
- Motion respects existing reduced-motion behavior; progress understanding never depends on animation.
