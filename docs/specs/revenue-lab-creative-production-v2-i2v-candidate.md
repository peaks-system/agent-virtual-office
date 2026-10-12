# Revenue Lab Creative Production v2 I2V Candidate Policy

Status: Frozen

## Scope

This policy extends new Creative Production Plan v2 revisions without changing stored revisions or the v2 output schema. New requests use `prompt_version = creative-production-planner-v2.2`; `schema_version = creative-production-plan-v2` remains unchanged.

## Selection contract

- Static-first remains mandatory: the first accurate product display is `static_product_scene`.
- A plan may contain zero or one `image_motion_scene`; more than one is invalid.
- An `image_motion_scene` may use only an asset whose frozen planner input marks both accurate product use and I2V use as eligible.
- The scene must primarily show the product accurately. The product remains stationary and only a very small camera push-in or background-only motion is requested.
- When an owned, I2V-eligible asset exists and the plan contains a later accurate product scene in addition to the first static display, the planner must select the strongest one as the sole restrained I2V candidate. A plan with no such later scene may contain no I2V candidate.
- All remaining accurate product scenes use `static_product_scene`.

## Compatibility

Stored Creative Production v1 and v2 revisions are immutable. This policy creates a new revision through the existing request/RPC flow and does not submit a video-generation task.
