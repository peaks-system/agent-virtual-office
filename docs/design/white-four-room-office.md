# White four-room office design

User-approved direction: predominantly white, a changed four-room floor plan, original block-bodied characters. Existing canvas is 800 x 560. This plan implements that direction without requiring external artwork.

## Floor plan / export coordinates
| Room | Bounds | Internal zone | Door |
|---|---|---|---|
| OFFICE | x10–500, y10–345 | mainOffice | central hub |
| PRESIDENT'S OFFICE | x520–790, y10–215 | entrance (compatibility ID) | x500–520, y105–150 |
| MEETING ROOM | x520–790, y235–550 | meetingRoom | x500–520, y270–315 |
| LOUNGE | x10–500, y365–550 | lounge | x225–280, y345–365 |

The former separate research room becomes a reading/library corner inside LOUNGE. No fifth enclosed room. Keep internal mainToResearch only as a compatibility alias if needed, never as a distinct physical passage.

## Furnishing / agent anchors
- OFFICE desk centers: arch (130,171), dev (260,171), qa (390,171), res (130,286), ops (260,286), designer (390,286). Homes are 24 px below each desk. Gate home (70,90) near the entry/reception niche.
- PRESIDENT'S OFFICE: PM home (650,135), executive desk center (650,111); minimal seating and plant.
- MEETING ROOM: table center (660,385), width100 height60; chairs around it: (610,428),(650,428),(695,428),(610,345),(650,345),(695,345),(595,385),(725,385).
- LOUNGE: coffee counter near (40,400), lounge seats near (180,480), reading corner toward (380,480). Utility functions (water/snacks/phone/printing/restroom) remain small furniture stations, not additional rooms.
- Keep all obstacles within rooms and safe clear routes from doors to destinations. Pathfinding owner defines exact padding and shared destination coordinates in officeLayout.js; renderer follows this source.

## Visual tokens
- Walls #D8DEE3 with bright white caps; canvas #EEF1F3.
- Floors OFFICE #F8F9FA, PRESIDENT #F5F3EE, MEETING #F2F5F7, LOUNGE #F6F5F0.
- Desks white #FDFDFB, edges #D8DDE1, chairs slate #73818C, upholstery #E1E7E8, subtle light wood #D9CDBB only as accent.
- Room titles slate #53636F. Use exact English room names with small Japanese subtitles if space permits. Eliminate duplicate legacy zone titles and dark wood grid.
- Green plants, small blue glass windows, restrained role accents. Preserve status-ring semantics and contrast.

## Characters
Original chunky cuboid head, rectangular torso, articulated block arms/legs, small facial features; subtle side faces for depth. Existing hair/clothes colors and accessories distinguish employees. Preserve original sprite footprint (~32 x 44), anchor, facing and walk cadence so labels and route clearances remain valid. No copied meshes/textures, logos or external assets.

## Verification states
Full office and compact panel; paused and moving; inspector; real waiting/working states; all-room journey and obstacle checks. Localized UI stays Japanese; room names match the user's chosen signage.
