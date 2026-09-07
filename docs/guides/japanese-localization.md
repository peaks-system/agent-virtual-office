# Japanese localization and personal customization

## Open the office in Japanese

Start the development server with `npm run dev`, then open `http://localhost:5173/?lang=ja` (use the port printed by Vite). Japanese browsers select Japanese automatically when there is no explicit URL or saved preference. The precedence remains URL language, saved language, browser language, English.

The settings language button and the `L` keyboard shortcut cycle English, Traditional Chinese and Japanese. Selecting a language saves the preference in the browser. The existing local language endpoint also accepts Japanese. A URL such as `?lang=en` intentionally overrides a saved Japanese preference; remove that query parameter to use the saved preference on the next visit.

For the built app, run `npm run build`, then `node server.mjs --lang=ja --no-open` and open the URL printed by the server. Installation from this source checkout requires Node 22 or later and `npm ci`.

## Translation boundary

Japanese covers menus, buttons, status and behavior labels, help, app-owned error headings and retry actions, notifications, activity descriptions, role descriptions, dialogue pools, signs, desk labels, compact durations, the browser title and daily-card captions.

Product names, code, filenames, workflow identifiers, user-provided task text and external error details remain verbatim. Hook-generated labels may retain their original language; preserving diagnostic text avoids silently changing its meaning. Technical command examples and the downloaded image filename remain runnable and stable.

Already-generated speech bubbles and historical activity text retain their original language until replaced; new text uses the selected language. Reloading starts the scene in the selected language.

This change preserves the existing employee identities, movement, furniture, layout, palette and assets. Personal names, role assignments, character design, backgrounds, furniture and colors are future customization work: ask the user for preferences before choosing a design.

## History and rollback

The initial source baseline is Git commit `438da3b`. Localization is saved as a separate local commit named `feat(i18n): add Japanese user-facing localization`. Locate it with `git log --oneline --grep="Japanese user-facing localization"`.

To undo localization while preserving history, first inspect `git status` and save any later uncommitted work, then run `git revert <localization-commit>` with the commit ID from that log. This reverses the localization commit instead of deleting files or rewriting history. Do not use hard reset or clean. A Git revert does not erase browser preferences or local agent data; choose English in settings if the old version is restored.

After reverting, run `npm test` and `npm run build`, then verify that the original English/Traditional Chinese UI starts. The MIT license, original copyright holder and package author metadata remain in their original files. No remote publication is required for this personal customization.

## Verification

- `node node_modules/vitest/vitest.mjs run tests/japaneseLocalization.test.jsx tests/languagePersistence.test.js`
- `npm test`
- `npm run build`
- Browser: inspect Japanese onboarding, settings, room signs, character inspector and compact panel; cycle languages and confirm memoized signs update without a reload.

See `.agentcortex/context/work/main.md` for recorded results and remaining limitations.

Verified on 2026-09-07: 121 test files / 2,381 tests passed; production build passed. Live browser checks covered Japanese onboarding, settings, inspector, saved preference, three-language cycling and the production compact panel. Original license and package metadata had no diff. Build warnings about Vite configuration/deprecation and bundle size are advisory.
