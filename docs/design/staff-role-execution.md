# Staff role execution design

User approved explicit roster and workflow. Preserve white office and dashboard layout. President is a static original block avatar at650,135 with president desk650,111. Move PM to main-office free top aisle; retain legacy worker IDs as compatibility aliases: pm=PM,arch=marketing,res=research,ops=SNS,gate=copywriter,designer=design,dev=engineering,qa=QA. President never enters moving agent store.

STAFF LIST shows9 profiles, president marked display-only. Working metrics count eligible workers only. Project right panel gains Japanese request/run/progress/result controls, visibly separate from manual notes. A click initiates a real run with existing Codex login. No automatic run on page load. Errors and waiting-for-human state are explicit.

Config schema: {version:1, commonRules:[string], workflow:{planning, draft, review, revise, quality, final}, staff:[{id,displayName,executionEnabled,conversationEnabled,rolePrompt:[string]}]}. Keys stable; editable prompt strings grouped in one file. President executionEnabled=false, conversationEnabled=false reserved for future feature.

Runtime module loads validated config; provider accepts {staffId,instructions,input,cwd}. Orchestrator uses project/staff-specific data paths, serial bounded calls, a draft barrier, peer review/revision, QA, final PM. Inputs and outputs persist separately from authentication. CLI is ephemeral with no app task creation. HTTP run API is shared by Vite and production server.
