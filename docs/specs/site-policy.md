# Site policy minimum

## Scope
Project-scoped site name, immutable registered origin, category (unclassified default), explicit operation toggles, Search Console property, manual publish, Terra low/medium and disabled schedule. Categories are not safety overrides. The existing restricted host and its subdomains cannot become general. Legacy SEO registration determines restricted migration; other existing sites remain unclassified. No credentials enter policy files.

Server settings use a revision and explicit confirmation for any policy edit. Domain changes require a separate project to prevent memory/history mixing. WP credentials are process-memory per project+origin+revision; proposals bind these policy coordinates, and stale proposals cannot execute. Unknown category cannot write or run generative workflows. Restricted category uses sanitized technical review and neutral attested drafts only. General allows existing staff collaboration and new plain-text article/page draft proposals. No publishing, deletion, live update, scheduling, user/plugin/theme changes.

API settings integrate with existing SEO API; all AI and WP entrypoints enforce policy. WP transport pins vetted public DNS and refuses redirects, private addresses, non-HTTPS and arbitrary endpoints. Draft approval preserves the existing write-ahead journal and readback checks. Keep legacy history visible but require a new proposal after explicit policy edits. General drafts support posts/pages; restricted drafts remain pages. API mocks verify writes without contacting live sites.

Google OAuth remains read-only and account-scoped in its existing secure store; property/results remain per project. A separately authenticated Google account per project is not implemented and must be described, not claimed. AI configuration remains Terra low/medium; any Astra run requires reason and explicit approval. Site settings do not enable forbidden content or operations.

## Validation
Unclassified denied through direct API calls, restricted host downgrade denied, project credential isolation, stale revision/hash denied, known-host migration, unsafe destination denial, draft-only transport, role prompt isolation and build/UI regression. Live general WordPress save requires a user-supplied general site and connection; report mock verification separately.

## Operator flow and limits
Select a project, open the center workspace Site Settings tab, enter the registered origin and category, select allowed operations, and confirm the settings change. Every edit increments a revision and records before/after settings; a new origin requires a different project. Enter WP connection values locally in WordPress Maintenance; they remain in process memory for that project only and expire on settings edits or restart. Use AI Request for general-site article collaboration, then manually transfer the chosen plain text into the WordPress proposal form. Review title/body/reason and explicitly approve one separate draft. Inspect the readback result and WordPress preview; publication is manual. Readback is not a visual/AI quality audit.

The minimum does not automatically transfer AI output to a proposal, generate rich HTML, update existing published content, schedule jobs, create backups, or connect different Google accounts simultaneously. It never deletes content, changes users/plugins/themes, or publishes. Category selection is a permission restriction, not an override of model safety rules. The neutral content attestation for restricted drafts remains required; arbitrary restricted prose is not sent through generic article AI. Existing restricted history stays visible.

## Handoff
Implementation entrypoints: scripts/site-policy.cjs, scripts/seo-api.cjs, scripts/staff-api.cjs, scripts/wordpress-api.cjs and src/components/SiteSettingsPanel.jsx. Evidence and review receipt: .agentcortex/context/work/codex-site-policy-main.md. Original copyright/license files remain unchanged. Revert the feature commit to roll back code; retain ignored policy/history data and user backups. Do not run newly created general-site proposals through an older single-site implementation.
