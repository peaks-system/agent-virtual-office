# Revenue Lab Three Picks Hard Fact / Soft Copy v1 DSoT

Status: approved
Approved: 2026-10-26

```text
frozen product title + verified facts
  -> Evidence Compiler
       fact_candidates[]
       typed facts[] { fact_id, canonical_value, conditions[], qualifiers, display_text }
       selectable_facts[] { fact_id, source_candidate_id, type, display_text }
       identity_candidates[] { identity_id, display_name }
  -> Planner v4
       selects exact identity_candidates[].identity_id
       selects exact selectable_facts[].fact_id
       selects fact_candidates[].id only for soft-copy grounding
       writes Hook / short_appeal / product TTS / CTA only
  -> schema-v5 validator
       hard contract: exact product / identity_id / fact_id
       soft contract: collect independent field failures
  -> Progressive Soft Copy
       Level 1: keep every valid AI field unchanged
       Level 2: one request containing rejected fields only
       Level 3: deterministic safe copy for remaining failures
  -> Deterministic Formatter
       identity_id -> display_name
       fact_id     -> fact_badge
  -> formatted Plan
       existing renderer-facing text shape
       soft_copy_fields[] { field, generation_mode, repair_count, lineage }
  -> manifest-v3 -> hero-product-layout-v2
```

Hard facts never depend on reverse semantic matching of model-written badge text. Ambiguous evidence is available only to soft copy. A missing safe identity candidate or unknown selected ID fails before plan persistence.

For duration facts, `canonical_value` retains item amount/unit, duration value/unit, approximation, maximum/minimum bound, estimate status, and structured material conditions. Planner input exposes those fields unchanged. The validator treats a quantitative short appeal or product TTS as grounded only when it preserves the typed value, units, and all material qualifiers. The deterministic badge formatter uses the same data; it never removes a condition to satisfy layout length. A duration option whose complete canonical badge exceeds the one-line limit is excluded from `selectable_facts`.

The formatter preserves the current product-card hierarchy and layout contract. No new visual layer, coordinate, or renderer behavior is introduced. Existing stored plans and manifests remain immutable and version-dispatched.

The repair request is dynamically constrained to the initially rejected field keys. It receives only the rejected value, safe validation reason, selected evidence, canonical identity, selected typed fact and qualifiers, and field length limits. Successful fields are absent from the repair response schema and therefore cannot be rewritten. The client performs zero or one repair request, then deterministically completes every remaining soft field. Hard-contract validation runs before repair and remains fail-fast.

Canonical product fallback derives its wording from the exact selected fact and identity. Duration copy is rendered from structured quantity, duration, approximation, bound, estimate, and conditions. Hook and CTA use fixed generic Japanese templates. The final validator either validates AI copy against evidence or checks canonical fallback for exact deterministic equality; it never accepts a weakened semantic match.

`soft_copy_fields[]` lives only in the existing Plan `output_json`. The Dashboard maps it into small pre-TTS review badges without duplicating server state. The stable `field` value and retained lineage are the seam for a later partial-edit API, but no editing endpoint or persistence mutation is introduced in this phase.

Future consideration: a later version may allow `fact_badge` to be omitted when evidence contains no safely compilable typed fact. v1 deliberately keeps the badge required and fails before request creation.
