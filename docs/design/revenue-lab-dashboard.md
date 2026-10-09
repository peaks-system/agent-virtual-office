# Revenue Lab Dashboard Design

Status: Approved for Phase 1

## Entry

Add a department switch to the AI Corporation header:

`[ AI OFFICE ] [ REVENUE LAB ]`

AI Office remains the default and retains its existing layout without behavioral changes. Revenue Lab replaces only the body beneath the shared header.

## Desktop Wireframe

```text
+--------------------------------------------------------------------+
| REVENUE LAB / YouTube Commerce                Last run / Job state  |
| Deterministic discovery for JP commerce videos          [Run now]  |
+--------------------------------------------------------------------+
| SEARCH THEMES                                                      |
| [Theme label] [Search query] [Buyer 0-100] [Fit 0-100] [Enabled]  |
| [Theme label] [Search query] [Buyer 0-100] [Fit 0-100] [Enabled]  |
| [Theme label] [Search query] [Buyer 0-100] [Fit 0-100] [Enabled]  |
|                                              [Save theme settings] |
+--------------------------------------------------------------------+
| RESEARCH OVERVIEW                                                  |
| Theme / last collection JST / 7-day window / fetched / scored     |
| score version / latest job / next run at 05:15 JST                |
+--------------------------------------------------------------------+
| TODAY'S DISCOVERY TOP 3                                            |
| #1  title                       Opportunity 88.42 [strong]          |
|     channel · views · subs · views/sub · Views/hour                |
|     [observed | estimated] explanation · deterministic reasons     |
|     [Show details: percentiles / raw components / human inputs]    |
| #2 ...                                                             |
| #3 ...                                                             |
+--------------------------------------------------------------------+
| CONTINUOUS TRACKING / BREAKOUT TOP 3                               |
| #1 title · observed badge · previous/current/delta · elapsed       |
|    Views/hour · growth ratio (display-only) · tracking score       |
+--------------------------------------------------------------------+
| [About scores: concise definitions for six ranking terms]          |
+--------------------------------------------------------------------+
```

## Visual Tokens

- Reuse the existing calm white-office background, card radius, border, typography, and focus ring.
- Department accent: muted amber (`#9a6a2f`) to distinguish revenue experiments without altering existing green AI Office semantics.
- Opportunity score is the primary number; Breakout is secondary.
- Observed velocity uses a green badge; estimated lifetime velocity uses an amber badge.
- Summary and decision metrics remain visible; diagnostic components are disclosed on demand.
- Discovery is titled `本日の発掘TOP3`; it does not claim database-level novelty.
- Tracking is titled `継続観測・急伸TOP3` and always represents a six-hour-or-longer observed interval.
- No charts in Phase 1.

## Responsive Behavior

Below 700px, theme fields stack vertically and opportunity metadata wraps. Actions remain keyboard reachable and cards remain in ranked order.

## States

- Loading: short Japanese loading message and disabled actions.
- Error: user-safe message, retry button, no raw upstream error.
- Configuration missing: identify each query missing buyer intent or commerce fit.
- Empty: explain that a run must be enqueued and processed by the local worker.
- Success: show up to three ranked opportunity cards.
- Manual run pending: disable button and show that the job is queued, not synchronously executing.

## Accessibility

- Department controls use buttons with `aria-pressed`.
- Forms use explicit labels and numeric min/max constraints.
- Async messages use `role=status`; failures use `role=alert`.
- Rank is visible text, not color-only.
