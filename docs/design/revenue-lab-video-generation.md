# Revenue Lab Video Generation DSoT

## Placement

Video generation is nested inside each successful Creative Production revision. Existing plan content remains unchanged.

```text
Creative Production v1
└─ Revision 2 · succeeded
   ├─ Scene 1 · real_product_asset
   │  └─ no provider controls
   ├─ Scene 2 · ai_generated_scene
   │  ├─ Pollo 2.0 · 480p · 9:16 · audio off
   │  ├─ [Polloで生成] or [再生成]
   │  ├─ status badge · provider task state
   │  ├─ cost + provenance · safe error
   │  └─ <video controls preview> when succeeded
   └─ Scene 3 · text_only
      └─ no provider controls
```

## States

- Not generated: compact provider row and enabled generation button when configured.
- Queued/submitting/polling: disabled action, progress badge, no synthetic percent.
- Succeeded: preview, model, actual/unavailable cost, completed time, regeneration button.
- Failed: safe code only, regeneration button.
- Provider not configured: disabled action and `POLLO_API_KEY` server-setting notice; never expose its value.

## Tokens

Reuse Revenue Lab card, status badge, warning, primary button, and details styling. Add only a compact generation panel and responsive video preview. Do not change the surrounding Campaign or Creative Production hierarchy.
