---
status: frozen
title: Personal white four-room office
primary_domain: office-runtime
secondary_domains: [ui-rendering]
created: 2026-09-07
---

# Personal white four-room office

## Goal
Replace the current visual office with an original white/ivory four-room layout and original block-bodied characters. User explicitly authorized proceeding without supplying character assets.

## Acceptance Criteria
- AC-1: Four visually distinct rooms: OFFICE upper left, PRESIDENT'S OFFICE upper right, MEETING ROOM lower right, LOUNGE lower left. Room signage uses the exact requested English names; other UI retains Japanese.
- AC-2: Predominantly white/ivory/pale gray floors, walls and furniture with restrained neutral accents and readable status colors.
- AC-3: Original block-style character heads, torsos and limbs, with existing role differentiation, expression, facing, animation and status indicators preserved.
- AC-4: Furniture, home locations, destinations, doors and routes agree on the new geometry. Agents can travel between every room without crossing walls or desks; door-claim lifecycle remains intact.
- AC-5: Existing real status integration, controls, inspector, keyboard access, reduced motion and responsive full/panel rendering continue working.
- AC-6: Tests/build/browser verification and reversible local Git history. Preserve LICENSE and upstream attribution.

## Non-goals
Roblox assets/logo/API integration, employee identity/role logic changes, multiplayer, third-party accounts, external publication.

## Design and Contract
See docs/design/white-four-room-office.md. Shared layout source is src/systems/officeLayout.js; render and movement use the same coordinates. Preserve existing exported movement API and internal door identifiers when possible.

## Domain Decisions
- [DECISION] Share geometric constants between rendering and pathfinding to prevent visual/collision drift.
- [DECISION] Keep SVG and existing React/store architecture; no new dependencies or user-created assets.
- [CONSTRAINT] Status must reflect real input; visual style does not invent completed work or change user permissions.
- [TRADEOFF] Historical coordinate-specific tests must be updated to the new intentional layout while preserving behavioral assertions.

## File Relationship
Supersedes the previous localization design's visual baseline for this new user-requested customization only. Japanese localization functionality remains. Does not modify frozen dialogue mechanics.
