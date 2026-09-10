# Staff model policy

Classification: feature. Approved scope: user's 2026-09-10 request.

- AC1: Every actual staff call explicitly selects gpt-5.6-terra and medium by default, independent of CLI defaults.
- AC2: Only low/medium effort is accepted; no automatic model fallback.
- AC3: gpt-6-astra requires explicit human approval for one submitted collaboration run. Approval resets after submission or any request/project change; never persisted as a preference.
- AC4: Server validates selections before queuing; each stage receives the immutable run selection and saved run includes that selection.
- AC5: UI exposes low/medium and an unchecked Astra exception with scope warning; existing launcher, isolation and external-action restrictions stay intact.

Design: retain the current AI request form. Add an effort select and explicit approval checkbox before the submit button; show actual run model/effort in results. No new page.
Verification: defaults/invalid selections/unapproved Astra rejected before spawn, all-stage propagation, UI approval reset, full regression/build. No live Astra call without separate user approval.
Rollback: revert the feature commit; preserve ignored runtime data and existing credentials.
