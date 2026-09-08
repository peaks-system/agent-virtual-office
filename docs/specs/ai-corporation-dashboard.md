---
status: frozen
classification: feature
primary_domain: ui-rendering
---
# AI Corporation personal dashboard

## Selected feature inventory
The user selected all four items on 2026-09-08: Windows one-click startup/shutdown, company header and live status, projects/staff left rail, and work/plan/tasks right rail. Preserve the verified white four-room office and block avatars (37017c0).

## Acceptance criteria
- AC-1: Windows launch and stop shortcuts work without entering commands, detect missing prerequisites and port conflicts safely, bind only loopback, and never stop unrelated Node processes. Beginner instructions explain manual startup and Ctrl+C, plus the new launcher. No global installs or execution-policy changes.
- AC-2: Full mode has an AI CORPORATION header with live working/attention counts, local project count and a clock. Counts derive from real status, never ambient animation. Missing status reads as waiting for connection.
- AC-3: Left rail lists editable local projects and STAFF LIST with existing role names/status; selecting a staff member opens the existing inspector. User can add/select/archive projects. No sample project presented as real work.
- AC-4: Right rail shows selected project description, editable plan, checklist tasks and current real agent work. Projects persist locally across reload with visible storage errors; project data can be exported for backup. Editing plans does not claim to dispatch AI work.
- AC-5: White/ivory/slate original presentation references screenshot structure only, retaining four requested room signs, Japanese controls, keyboard access, narrow viewport usability and unchanged panel mode.
- AC-6: Focused persistence and state tests, full regression suite, build, browser verification and local Git history; original author/license preserved.

## Scope limits
No autonomous task execution, new AI provider, cloud sync, external publication, remote deletion, credentials, or branded image copying. Manual project notes and actual AI status are labeled separately. No required user-supplied character asset.

## Rollback
Revert the dashboard commit to 37017c0. Local project storage is separate from existing office settings; export JSON before clearing browser data. Launcher shutdown targets only its verified local process identity.
