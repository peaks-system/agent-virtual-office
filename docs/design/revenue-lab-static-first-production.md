# Revenue Lab Static-first Production DSoT

## Information hierarchy

```text
Creative Production Plan v2
└─ Revision N · v2 Static-first
   ├─ objective / duration / CTA
   ├─ narration / subtitles
   └─ Scene
      ├─ rendering strategy
      ├─ AI required / abstract model class / preserve identity
      ├─ Product Asset and motion instruction
      ├─ prompt when applicable
      └─ current Pollo control only for stylized_scene or ai_generated_scene
```

## Scene presentation

The strategy label is primary. Three compact badges show whether AI generation is required, the abstract model class, and whether product identity must be preserved. Motion instructions appear separately from generation prompts so composition-time movement is not confused with provider generation.

`static_product_scene` and `image_motion_scene` show the Product Asset as the source of truth. Neither displays the current Pollo T2V control. `stylized_scene` and `ai_generated_scene` may retain the existing Pollo control through their compatibility mapping to `visual_source_type = ai_generated_scene`. v1 revisions continue to render with their original labels and controls.

## User-facing safety cues

The panel states that new revisions use Static-first v2 and stored v1 revisions remain unchanged. The revision summary identifies v1 versus v2. Product-preservation badges explain why an asset scene is not a generic generation scene.
