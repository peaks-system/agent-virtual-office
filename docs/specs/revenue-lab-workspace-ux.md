---
status: frozen
version: 1.0
date: 2026-10-19
classification: architecture-change
primary_domain: revenue-lab
secondary_domains: []
---

# Revenue Lab Workspace UX v2

## Goal

Make Revenue Lab a resumable workspace where the active Campaign, latest Iteration and Creative Revision, current production step, and single next action are visible without scanning historical or technical records. A browser refresh and browser history navigation must restore the workspace from the URL.

## File relationship

This specification **EXTENDS** the existing Revenue Lab specifications. It changes presentation, client-side route state, and refresh behavior only. It does not replace or modify Campaign, Iteration, Product Set, Three Picks v2, audio, composition, publication, analytics, or provider contracts.

## Route contract

- The canonical Revenue Lab route is `/revenue-lab`.
- The selected Campaign is stored as the optional `campaign` query parameter.
- Existing query parameters, including `lang`, are preserved when switching between AI Office and Revenue Lab and when normalizing Campaign selection.
- AI Office uses `/` while preserving unrelated query parameters and removing `campaign`.
- Initial mount, browser refresh, and `popstate` restore the department from `window.location` rather than a fixed component default.
- The implementation uses the browser History API and the existing SPA fallback. No router dependency is added.

## Campaign selection

- Only `status === "active"` Campaigns are eligible for the normal workspace.
- A requested Campaign ID is selected only when it identifies an active Campaign.
- A missing, unknown, malformed, or voided Campaign ID falls back to the latest active Campaign and normalizes the URL with `history.replaceState`.
- Latest Campaign selection is deterministic: descending `createdAt`, then descending stable Campaign ID as the tie-breaker. Source array order is never a selection signal.
- Within the Campaign, the current Iteration is selected by descending `iterationNumber`, then descending stable Iteration ID.
- Within the Iteration, the current Creative Revision is selected by descending `revisionNumber`, then generated timestamp, then request ID.
- When no active Campaign exists, no `campaign` parameter is emitted and the workspace shows an empty state.

## Workspace presentation

- Revenue Lab has a sticky workspace header containing only human-operational information: Campaign name, current Iteration number, latest Creative Revision number, five-step progress, next action, and refresh.
- The normal workspace renders one selected active Campaign, one current Iteration, and one latest `three_picks_v2` Revision.
- The five normal steps are Product, Creative Plan, Audio, Video, and Publish & Analyze.
- Completed steps are compact summaries. Only the current step is expanded.
- Earlier Iterations, earlier Revisions, lineage identifiers, UUIDs, hashes, prompt/schema/provider versions, internal placeholders, and technical receipts appear only inside Audit Information details.

## Step and next-action derivation

The workspace derives presentation from the existing Dashboard snapshot without persisting new state.

1. **Product** is complete when the current Iteration has a Product or Product Set.
2. **Creative Plan** is complete when the latest v2 request has a persisted successful plan.
3. **Audio** is complete when the current plan has at least one artifact and every artifact is `ready` with a positive measured duration.
4. **Video** is complete when the current plan has a completed Composition output.
5. **Publish & Analyze** is complete when a Publication has a performance snapshot; publication without a snapshot is the current analytics state.

The primary action is selected in this order:

- no v2 plan: `Generate Creative Plan`;
- plan with planned audio: `Generate Narration`;
- all audio ready and timing fits: `Generate Shorts MP4`;
- completed MP4: `Open Preview`;
- published without current analytics: `Collect Analytics`.

Queued/running states replace the primary mutation with a disabled progress action. Failed, submission-uncertain, missing-configuration, missing-duration, or timing-overflow states show a local reason beside the action. Timing overflow uses the compiler-equivalent scene preflight and includes the measured `required / max` values. Segment-level generation and live-validation controls remain available only under development details.

## Legacy and Archive

- `three_picks_v1` is excluded from the normal production flow and rendered under `Legacy · Read only` in Audit Information.
- v1 exposes no new-plan, audio-generation, or MP4-composition action.
- Voided, duplicate, rejected, and otherwise non-active Campaigns are excluded from the normal selector and workspace.
- Archived Campaigns are viewable only in a collapsed Archive area and cannot become the normal selected Campaign.

## Refresh behavior

- The manual Revenue Lab refresh action lives in the sticky workspace header.
- Poll approximately every three seconds only while a relevant Dashboard job, TTS artifact, or Composition is queued/running/generating/rendering.
- Do not start or continue polling while `document.hidden` is true.
- Refresh once when the browser regains focus or the document becomes visible.
- Idle workspaces do not poll continuously.
- Mutation completion still refreshes the Dashboard snapshot through the existing service call.

## Acceptance Criteria

- **AC-1:** Opening `/revenue-lab` mounts Revenue Lab, including after a fresh mount equivalent to F5.
- **AC-2:** Department switches update the URL with History API and preserve unrelated query parameters such as `lang=ja`.
- **AC-3:** Browser back and forward restore AI Office or Revenue Lab from the URL.
- **AC-4:** A valid active `campaign` ID restores that Campaign.
- **AC-5:** Missing, invalid, unknown, or voided Campaign selection deterministically falls back to the newest active Campaign and uses `replaceState` to canonicalize the URL.
- **AC-6:** Campaign fallback sorting uses `createdAt` plus stable ID and is independent of source array order.
- **AC-7:** The sticky header shows Campaign, current Iteration, latest Creative Revision, progress, next action, and refresh without technical identifiers.
- **AC-8:** Exactly five operational steps are derived; completed steps are compact and only the current step is expanded.
- **AC-9:** Normal display contains only the selected Campaign's current Iteration and latest v2 Revision.
- **AC-10:** Primary action transitions through plan, narration, composition, preview, and analytics states from the existing snapshot.
- **AC-11:** Timing overflow disables composition and displays the scene-specific `required / max` reason next to the action.
- **AC-12:** `three_picks_v1` is read-only under Legacy and exposes no production mutations.
- **AC-13:** Non-active Campaigns are absent from normal selection and visible only under Archive.
- **AC-14:** UUID, SHA, prompt/schema/provider versions, RPC/internal details, placeholders, past Iterations, and past Revisions appear only under Audit Information.
- **AC-15:** Polling runs only for queued/running production work, pauses while hidden, and focus/visibility restoration triggers one refresh.
- **AC-16:** No migration, API contract, RPC, Store hydration, dependency, or persisted lineage change is introduced.

## Non-goals

- No DB schema, migration, RPC, API response, Store hydration, or server routing change.
- No Campaign, Iteration, Product Set, planner, ElevenLabs, Final Composer, Publication, Analytics, Pollo, Wan, or I2V behavior change.
- No v1 data conversion or deletion.
- No automatic Campaign mutation from route selection.
- No new router, data-fetching, or state-management dependency.
- No commit, push, live provider call, live generation, or migration application.

## Constraints

- Preserve unrelated dirty working-tree changes and isolate mixed-file edits by hunk.
- Route and workspace derivation must be pure and directly unit-testable.
- URL state may contain only selection/navigation data, never credentials or private provider data.
- All write actions continue through the existing service functions and authorization boundary.

## Domain Decisions

- [DECISION] Browser URL state is the source of truth for department and Campaign selection so refresh and browser history have identical behavior.
- [DECISION] Campaign, Iteration, Revision, progress, and next action are derived client-side from the existing Dashboard snapshot; no persisted workflow state is added.
- [DECISION] The route implementation uses the native History API because the application has two workspace routes and already provides SPA fallback.
- [DECISION] Normal production is v2-only; v1 remains readable as historical evidence without operational controls.
- [TRADEOFF] Polling is limited to transient work and focus restoration instead of introducing SSE or a client caching dependency.
- [CONSTRAINT] Technical identity and provenance fields remain available for audit but never compete with the operational next action.
- [CONSTRAINT] Existing lineage and provider boundaries are immutable for this UX work.
