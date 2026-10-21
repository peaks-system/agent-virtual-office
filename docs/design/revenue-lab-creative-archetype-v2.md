# Revenue Lab Creative Archetype v2 DSoT

Status: approved
Approved: 2026-10-14

```text
Product → Three Picks production → MP4 → Publish & Analyze

Three Picks production · three_picks_v2
├─ Human selection: 3 products in presentation order
│  └─ each product: primary/hero asset + up to 3 supporting assets
├─ Generate plan
│  ├─ Hook 4 s
│  ├─ Product 1 10 s
│  ├─ Product 2 10 s
│  ├─ Product 3 10 s
│  └─ CTA 5 s
├─ Narration preparation
│  ├─ Hook: one short narration segment, target 3–4.5 s
│  └─ deterministic segments → TTS artifact status / measured duration
├─ Composition timing preflight
│  ├─ Hook / Product 1–3 / CTA: required duration / maximum duration
│  └─ overflow reason beside the disabled Compose action
└─ Compose MP4 (enabled only when all narration segments are ready and every scene fits)
```

```text
hero-carousel-v2 / hero-product-layout-v2 (new revisions)
┌──────────────────────── 1080 ────────────────────────┐
│ quiet deterministic background                       │
│                                                      │
│        REAL PRODUCT IMAGE · dominant hero layer      │
│        supporting images enter as bounded carousel   │
│                                                      │
│  display_name                                        │
│  short_appeal                                        │
│  [fact_badge]                                        │
│                                                      │
│  subtitle cue from measured segment audio duration   │
└──────────────────────── 1920 ────────────────────────┘
```

Product imagery occupies the visual hierarchy. Text never becomes a slide-style description. The normal view shows `display_name`, `short_appeal`, `fact_badge`, concise narration segments, audio readiness, and the fixed template. Asset Revision identifiers, SHA-256 values, prompt/schema/provider versions, object keys, and fingerprints stay in History/Audit Information.

Layer order is background → product card → product image → PICK label → short Creative copy → fact badge → dedicated subtitle band. The template owns all coordinates, font sizes, entrance/exit animation, transition, SE event timing, BGM level, and narration ducking. The model supplies no coordinates, durations, template choice, or effect commands.

```text
Planner evidence boundary
commerce snapshot
  ├─ source_product_name (normalized, not character-sliced)
  └─ fact_candidates[] (complete bounded semantic units)
       ↓ planner-v3 translation
display_name / short_appeal / fact_badge / tts + evidence anchors
       ↓ plan-v4 validation
identity + grounding + completeness + copy bounds
       ↓ manifest-v3
layout-v2 physical fit preflight using actual font metrics
```

The 1080×1920 v2 grid uses a 96 px minimum horizontal safe margin. The display name, appeal, and one-line badge occupy separate regions above and below an 840 px neutral product card; the subtitle owns the bottom band and cannot overlap those regions. Old `three-picks-composition-manifest-v2` / `hero-product-layout-v1` payloads remain accepted by a separate legacy dispatch and are rendered from the stored manifest without recompilation.
