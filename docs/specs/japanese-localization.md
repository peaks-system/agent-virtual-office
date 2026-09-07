---
status: frozen
title: Japanese reader-facing localization
primary_domain: localization
created: 2026-09-07
---

# Japanese localization

## Goal
Make the existing office usable in Japanese after verifying initial startup. The user explicitly selected this first step and authorized implementation.

## Acceptance Criteria
- AC-1: Existing English locale keys have Japanese equivalents with matching value shapes and interpolation tokens.
- AC-2: Japanese browsers select Japanese; `?lang=ja` and saved preferences work, with existing precedence retained. Language switching updates visible UI and document language.
- AC-3: Development and production language persistence accept ja with existing origin/authentication controls unchanged.
- AC-4: Menus, statuses, help, app-owned errors, notifications, activity text, room/desk signs and daily cards render Japanese. Product names, user-provided task text and technical identifiers remain intact.
- AC-5: Existing layout, assets, behavior and character identity remain unchanged. English/Traditional Chinese remain available.
- AC-6: Build, focused localization checks, regression tests and browser startup/rendering evidence are recorded. Git history preserves a reversible localization commit; LICENSE and author metadata are preserved.

## Non-goals
Employee redesign, roles/behavior changes, furniture/layout/palette customization, translation of internal filenames, developer diagnostics or third-party errors. Those visual choices require future user input.

## Constraints
Use existing i18n and English fallback, without new runtime dependencies. Translate role labels without inventing personal names. Preserve placeholders, dialogue triggers and pool cardinality.

## File Relationship
Independent new-language extension. Does not edit or implement the frozen dialogue-interaction-layer spec, its S2 voice redesign or emission mechanics.

## Design
docs/design/japanese-localization.md

## Domain Decisions
- [DECISION] Extend existing locale dictionaries and detection instead of introducing a second i18n library.
- [CONSTRAINT] User input and internal identifiers remain verbatim.
- [CONSTRAINT] Appearance customization is a later user-directed task.
- [TRADEOFF] External runtime errors and development diagnostics may remain in their original language for diagnosis.
