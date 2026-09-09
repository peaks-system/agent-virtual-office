---
status: frozen
classification: architecture-change
primary_domain: office-runtime
---
# Staff-specific AI execution

Continue existing application, baseline9a49d96; no new user-owned Codex task or setup reset. Single cohesive feature: staff roster connected to differentiated execution.

## Acceptance criteria
- AC1: Nine staff: president (display only), PM, marketing strategy, market research, SNS operations, copywriter, UI/Web designer, web engineer, QA. President in president room, excluded from task dispatch and working counts; future conversation capability metadata remains separate.
- AC2: Editable config/staff.json is the canonical staff registry, with independent role instructions covering expertise, responsibility, judgment/quality, scope boundaries, assumptions/evidence/unknowns, handoff format, constructive dissent, and required human approval for external-impact actions.
- AC3: Existing authenticated Codex CLI receives each actual role instruction, via isolated ephemeral invocations. Per-project/staff history, memory and workspace paths are separated. Initial drafts cannot see other current drafts. No global shared conversation or reused provider session.
- AC4: PM structures request and chooses relevant eligible specialists; all initial drafts finish before review. Related workers review and revise; QA checks omissions/facts/UI/text/links; PM integrates and asks human for final approval. President assignment is rejected at runtime, not only hidden.
- AC5: Existing dashboard can initiate a local AI work run, display real progress/results/errors, and await human review. Execution endpoints are local-only, origin-checked and input-bounded; concurrency/output/time limits apply. No posting/publishing/purchasing/deleting endpoint. Provider uses read-only sandbox, shell/apps/web tools disabled, no unrestricted flags or credentials files.
- AC6: Distinct prompt delivery and isolation verified at provider boundary, president rejected, workflow ordering covered, real authenticated smoke execution verified, start/stop regression preserved, existing tests/build and local Git history retained.

## Boundaries
Generated text/code is a proposal artifact. No deployment, SNS publishing, payments or destructive tools are enabled. Human approval is a terminal review state, not automatic authorization to execute arbitrary actions. Truthful limitations: fact/link verification may remain unverified without supplied evidence; record unknowns rather than invent checks.

## Rollback
Revert this change to9a49d96. Preserve separate ignored staff working data and existing browser projects. No account reconfiguration or new dependency.
