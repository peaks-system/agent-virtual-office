# Staff follow-up decisions

Project-scoped human decisions on completed staff reports. PM emits JSON with report and up to five confirmation items (question, options, recommended option ID, reason, risk). Invalid/legacy output remains visible with an explicit generic request to restructure, never an invented extracted recommendation.

Server accepts approve/revise/reject once per parent run; records local operator label (self-declared, not authenticated identity), server timestamp, selected option texts, feedback, parent/child execution IDs. Approval is read-only follow-up reasoning, never WordPress authorization. New runs default to Terra; no inherited Astra consent. Policy is checked again server-side. Reject records a decision without provider execution. Failed dispatch remains recorded and is not silently retried. Saved runs are reloadable only through validated project/run paths; interrupted runs are reported as cancelled after restart.

UI: confirmation cards above the long report, no preselected approvals, recommended option marked, reason/risk shown. Operator label and revision comment precede three explicit action buttons. Explain what each button does, usage consumption and lack of external writes. Link to existing WordPress workspace for a separate target/diff/approval; no automatic draft creation. History shows parent decision and linked child status/result.

Verification: schema boundaries, project isolation, duplicate decisions, reject/no execution, revise/selection carryover, persistence, Terra reset, policy denial, UI render, build. Existing role isolation and single-active-run enforcement retained. Existing provider has no browsing tools: follow-up is reasoning on supplied evidence, not a new crawl.
