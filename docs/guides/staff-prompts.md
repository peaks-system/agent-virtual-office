# Staff prompts

`config/staff.json` is the canonical registry for all nine visible staff profiles and the instructions used by real local execution. Edit Japanese text directly in a text editor, preserving JSON quotation marks, commas and brackets. Save a backup or a Git checkpoint first. The next run loads the file again; an already running job retains its configuration snapshot.

## Editable fields

- `displayName`: the visible employee name.
- `commonRules`: shared evidence, uncertainty, constructive feedback, handoff and human-approval rules.
- `rolePrompt`: each employee's expertise, responsibilities, quality criteria and scope boundaries.
- `workflow`: canonical instructions for planning, independent draft, peer review, revision, QA and final integration.
- `executionEnabled`: whether a worker may execute. The president must remain `false`.
- `conversationEnabled`: reserved metadata. Keep `false`; changing it does not create a conversation feature. The president cannot enable it.

Keep `version: 1`, all nine IDs and the six workflow keys unchanged. Invalid files fail with a Japanese explanation before instructions are used. Do not place credentials or private authentication data in this file.

| ID | Responsibility |
| --- | --- |
| president | Display-only president; never dispatched |
| pm | Request decomposition, allocation and final integration |
| arch | Marketing strategy |
| res | Market research and evidence assessment |
| ops | SNS planning and operations proposals |
| gate | Copywriting |
| designer | UI and Web design |
| dev | Web engineering proposals |
| qa | Independent final quality checks |

The legacy IDs remain stable for compatibility with the office. They do not change the actual role instructions: `arch` now receives marketing instructions, for example.

## Execution contract

`scripts/staff-config.cjs` validates the registry and builds provider instructions from shared rules, the selected role and the selected workflow stage. The president is rejected by the instruction builder even when requested directly. PM planning returns a JSON object with `assignments: [{staffId, task}]`; only relevant enabled specialists from `arch`, `res`, `ops`, `gate`, `designer`, and `dev` may be assigned. QA runs in its dedicated final quality stage, and PM performs the final integration.

Drafts are independent; peer material becomes available during review. Each role should preserve uncertainty and constructive disagreement. Final output is a proposal awaiting human review. The prompts do not grant publishing, posting, payment, deletion or deployment capabilities. Without supplied evidence or execution tools, factual claims, URLs, rendered screens and tests must remain explicitly unverified.

To change staff behavior, edit the relevant role paragraphs rather than duplicating instructions in UI components or provider adapters. Keep handoff expectations concrete: conclusions, artifact, reasons/evidence, uncertainties, next-owner requests and approval requirements.

## Start a request

### Model and reasoning policy

The default is GPT-5.6 Terra with medium reasoning. The request form permits only low or medium. `config/model-policy.json` holds the default; restart the office after changing its reasoning default. Every CLI call explicitly passes `--model` and `model_reasoning_effort`; model failure stops the run without automatic fallback.

To request GPT-6 Astra, a human must check the explicit approval box for the current request before submitting. Approval covers all stages of that one collaboration run, including PM and QA. It is cleared when submitting, editing the request, changing effort or switching project, and is never saved as a preference. Saved run records show the selected model, reasoning and approval. Prompts and AI-generated plans cannot select the model. External-action restrictions remain unchanged. This setting affects AI OFFICE executions, not the model of the Codex app conversation used to edit this project.

Open `Start-Office.cmd`, select a project, and enter a request in the right-hand AI request panel. The installed Codex CLI uses the existing normal Windows user's login and consumes that account's usage allowance. No setup rerun is required. `Stop-Office.cmd` stops the office; active staff execution is cancelled on server shutdown.

Private output is stored under `.office-work/staff/<project ID>/<staff ID>/`: `history.json` contains the latest four outputs, `memory.md` holds the latest bounded output and is loaded into that employee's next request, and `workspace` holds stage artifacts. Runs are also saved under the project's `runs` directory. These files are excluded from Git. After a server restart, inspect these saved files; the current UI does not reload old runs from disk.

This first version generates proposals and code as text. It cannot browse live sites, render pages, run generated code, post, publish, purchase or delete external data. QA explicitly identifies checks that remain unverified. The default local launcher is supported; installations that additionally configure `OFFICE_API_TOKEN` require an authenticated API client because the current UI has no token-entry feature. The authentication check remains enforced.
