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
| TODAY'S TOP 3                                                     |
| #1  title                                  Opportunity 88.42       |
|     theme · channel · views · age          Breakout 84.21          |
|     velocity mode · score version                                  |
| #2 ...                                                             |
| #3 ...                                                             |
+--------------------------------------------------------------------+
```

## Visual Tokens

- Reuse the existing calm white-office background, card radius, border, typography, and focus ring.
- Department accent: muted amber (`#9a6a2f`) to distinguish revenue experiments without altering existing green AI Office semantics.
- Opportunity score is the primary number; Breakout is secondary.
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
