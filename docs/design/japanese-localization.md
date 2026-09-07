# Japanese localization design

The existing rendered office at baseline 438da3b is the visual source of truth. The user authorized translation and reserved visual customization for a later discussion.

## Layout and export
Retain all baseline SVG coordinates, furniture, sprites, dimensions, colors, fonts, animation and control placement. Replace only labels via i18n. Use concise Japanese for room names, desk labels and compact status labels. Existing wrapping/truncation remains in effect.

## Component mapping
- ControlPanel: existing bottom bar, settings popover, onboarding and test buttons; translate text and expose Japanese in the existing language cycle.
- PixelOffice / TopDownFurniture: existing signs, desk labels and board columns; translate text in place.
- Existing inspector, feed, roster, notifications and errors: supplied by Japanese dictionary keys.
- Daily card: existing canvas layout, Japanese copy using existing character wrapping.

## States to verify
Initial disconnected/no-agent state; settings expanded; help; paused/resumed; inspector; compact panel; Japanese → English → Traditional Chinese language cycle; unknown locale fallback. Preserve status honesty and never fabricate live agent work for the screenshot.

## Approval
Text-only adaptation authorized by the user's request; no new visual design proposed.
