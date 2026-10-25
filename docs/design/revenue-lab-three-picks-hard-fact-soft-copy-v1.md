# Revenue Lab Three Picks Hard Fact / Soft Copy v1 DSoT

Status: approved
Approved: 2026-10-25

```text
frozen product title + verified facts
  -> Evidence Compiler
       fact_candidates[]
       typed facts[] { fact_id, canonical_value, display_text }
       selectable_facts[] { fact_id, source_candidate_id, type, display_text }
       identity_candidates[] { identity_id, display_name }
  -> Planner v4
       selects exact identity_candidates[].identity_id
       selects exact selectable_facts[].fact_id
       selects fact_candidates[].id only for soft-copy grounding
       writes Hook / short_appeal / product TTS / CTA only
  -> schema-v5 validator
       verifies selected lineage and soft-copy claim constraints
  -> Deterministic Formatter
       identity_id -> display_name
       fact_id     -> fact_badge
  -> formatted Plan
       existing renderer-facing text shape + lineage metadata
  -> manifest-v3 -> hero-product-layout-v2
```

Hard facts never depend on reverse semantic matching of model-written badge text. Ambiguous evidence is available only to soft copy. A missing safe identity candidate or unknown selected ID fails before plan persistence.

The formatter preserves the current product-card hierarchy and layout contract. No new visual layer, coordinate, or renderer behavior is introduced. Existing stored plans and manifests remain immutable and version-dispatched.

Future consideration: a later version may allow `fact_badge` to be omitted when evidence contains no safely compilable typed fact. v1 deliberately keeps the badge required and fails before request creation.
