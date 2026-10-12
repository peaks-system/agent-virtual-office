# Revenue Lab Creative Production Plan v2

Status: Frozen after release

## Scope and version boundary

Creative Production Plan v2 is a new immutable Static-first contract. It uses `prompt_version = creative-production-planner-v2`, `schema_version = creative-production-plan-v2`, and `export_version = provider-neutral-shorts-v2`. Stored v1 requests, outputs, validation, and exports are never rewritten.

## Rendering strategies

The ordered preference is real static product media, product-preserving image motion, stylized generation, realistic full generation, and text-only composition.

- `static_product_scene`: references an eligible Product Asset and delegates pan, zoom, fade, and overlays to final composition. It never calls a generation provider.
- `image_motion_scene`: references an asset explicitly eligible for I2V and requires product identity preservation. It is not eligible for the current Pollo T2V control.
- `stylized_scene`: generates illustration, animation, or CG atmosphere only when accurate product depiction is unnecessary.
- `ai_generated_scene`: generates realistic generic context only when accurate product depiction is unnecessary.
- `text_only`: contains typography and composition instructions only.

Each scene stores the rendering strategy, Product Asset ID, on-screen text, motion instruction, AI-generation requirement, abstract recommended model class, product identity preservation requirement, generation prompt, and fact references.

## Abstract model classes

`recommended_model_class` is limited to `none`, `stylized_t2v`, `realistic_t2v`, or `product_preserving_i2v`. It never names a provider or concrete model.

## Asset eligibility

Static use accepts an asset whose recorded permission permits creative use. I2V is stricter: only `owned` assets or assets with frozen `registered_facts.i2v_allowed = true` are eligible. Licensed or reference status alone never implies I2V permission. The input snapshot records `i2v_eligible` and its permission source without exposing an asset URL to the model.

## Validation invariants

- If a static-eligible asset exists, the plan must include a `static_product_scene`.
- The first scene requiring accurate product identity must be `static_product_scene`.
- `image_motion_scene` cannot be the first or only accurate product display.
- Stylized and realistic T2V scenes cannot require product identity preservation or reference a Product Asset.
- Product-preserving I2V prompts and generic T2V prompts use distinct mandatory safety prefixes.
- Product facts, numeric claims, timing, fact IDs, asset IDs, and subtitle references retain the v1 safety checks.

## Compatibility

The client selects its schema, prompt, and validator from the frozen request contract. Requests without the v2 contract continue through v1. Database tables and RPCs are unchanged; new revisions store v2 identities in existing version columns.
