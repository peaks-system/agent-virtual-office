// ═══════════════════════════════════════════════════════════════════════
// Movement System — with proper walkable area constraints
//
// Architecture:
//   FLOOR_ZONES   = where characters CAN walk (rooms, door passages)
//   OBSTACLE_RECTS = furniture characters must NOT stand on
//   clampToFloor() = enforces both constraints on every generated position
//   Every function that produces a position runs through clampToFloor().
// ═══════════════════════════════════════════════════════════════════════

import { FLOOR_ZONES, ROOM_RECTS, OBSTACLE_RECTS, WAYPOINTS, HOME_POSITIONS, MEETING_CHAIRS, DOOR_SIDES } from './officeLayout.js'
export { WAYPOINTS, HOME_POSITIONS, MEETING_CHAIRS, DOOR_SIDES } from './officeLayout.js'
const ZONE_OBSTACLES = Object.fromEntries(Object.entries(ROOM_RECTS).map(([id, z]) => [id,
  OBSTACLE_RECTS.filter(r => r.x1 >= z.x1 && r.x2 <= z.x2 && r.y1 >= z.y1 && r.y2 <= z.y2),
]))

// ─── Walkability functions ──────────────────────────────────────────

export function isOnFloor(x, y) {
  return FLOOR_ZONES.some(z => x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2)
}

export function isOnObstacle(x, y) {
  return OBSTACLE_RECTS.some(r => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2)
}

// Push position out of an obstacle by moving to the nearest edge
function pushOutOfObstacle(x, y) {
  for (const r of OBSTACLE_RECTS) {
    if (x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2) {
      // Find nearest edge and push 6px past it
      const toLeft = x - r.x1, toRight = r.x2 - x
      const toTop = y - r.y1, toBottom = r.y2 - y
      const min = Math.min(toLeft, toRight, toTop, toBottom)
      if (min === toLeft) x = r.x1 - OBSTACLE_PUSH_PX
      else if (min === toRight) x = r.x2 + OBSTACLE_PUSH_PX
      else if (min === toTop) y = r.y1 - OBSTACLE_PUSH_PX
      else y = r.y2 + OBSTACLE_PUSH_PX
    }
  }
  return { x, y }
}

// Master clamping function: snap to nearest floor, push off obstacles
export function clampToFloor(pos) {
  let { x, y } = pos

  // Step 1: If not on any floor zone, snap to nearest one
  if (!isOnFloor(x, y)) {
    let bestDist = Infinity
    const originalX = x, originalY = y
    for (const z of FLOOR_ZONES) {
      if (z.id.startsWith('door-')) continue // skip door passages for snapping
      const cx = Math.max(z.x1 + 5, Math.min(z.x2 - 5, originalX))
      const cy = Math.max(z.y1 + 5, Math.min(z.y2 - 5, originalY))
      const d = Math.hypot(originalX - cx, originalY - cy)
      if (d < bestDist) { bestDist = d; x = cx; y = cy }
    }
  }

  // Step 2: Push out of any obstacle
  const pushed = pushOutOfObstacle(x, y)
  x = pushed.x; y = pushed.y

  // Step 3: Final bounds safety
  x = Math.max(15, Math.min(785, x))
  y = Math.max(15, Math.min(545, y))

  return { x, y }
}

// Overflow positions for dynamically spawned worktree agents (entrance hallway)
// Agents from other sessions appear here — feels like a "visiting team"
export const OVERFLOW_POSITIONS = [
  { x: 200, y: 80 },
  { x: 425, y: 90 },
  { x: 490, y: 80 },
  { x: 150, y: 55 },
  { x: 540, y: 60 },
  { x: 300, y: 50 },
]

// "x,y" → slot index, built once. applyExternalStatus's overflow bookkeeping needs to
// know which slot an existing dynamic agent occupies; a per-agent OVERFLOW_POSITIONS
// .findIndex() is an O(slots) scan, so resolve it to an O(1) lookup instead.
export const OVERFLOW_SLOT_BY_XY = (() => {
  const map = new Map()
  OVERFLOW_POSITIONS.forEach((p, i) => map.set(`${p.x},${p.y}`, i))
  return map
})()

// ─── Subagent helper-huddle placement ───────────────────────────────
// Small downward fan around the parent's chair. HARD-CAP at 3 visible + a tight ±15px clamp,
// so helpers never overlap an adjacent desk (desks are ≥80px apart) or pile on each other;
// any surplus collapses into a single "+N" glyph. Heavy fan-out (Claude firing 10+ subagents)
// renders 3 sprites + "+N", never N bodies.
export const HELPER_MAX_VISIBLE = 3
export const HELPER_OFFSETS = [
  { dx: -15, dy: 16 },
  { dx: 15, dy: 16 },
  { dx: 0, dy: 27 },
]
export const HELPER_BADGE_OFFSET = { dx: 25, dy: 25 }
// Lightweight roster colors (planner / worker / checker), cycled across helper figures.
export const HELPER_COLORS = ['#378ADD', '#1D9E75', '#BA7517']
// A parent with this many active helpers shows a "swamped / heavy load" cue.
export const HELPER_HEAVY_THRESHOLD = 4

// Pure resolver: up to HELPER_MAX_VISIBLE helper screen positions for a parent role + the
// overflow count + whether the load is "heavy". Easy to unit-test; the render is a thin shell.
export function resolveHelperLayout(parentRole, count, anchor = HOME_POSITIONS[parentRole]) {
  const n = Math.max(0, count | 0)
  if (!anchor || n === 0) return { sprites: [], overflow: 0, heavy: false, anchor: null }
  const visible = Math.min(n, HELPER_MAX_VISIBLE)
  const sprites = []
  for (let i = 0; i < visible; i++) {
    const off = HELPER_OFFSETS[i]
    sprites.push({ x: anchor.x + off.dx, y: anchor.y + off.dy })
  }
  return { sprites, overflow: Math.max(0, n - HELPER_MAX_VISIBLE), heavy: n >= HELPER_HEAVY_THRESHOLD, anchor }
}

// ─── Zones (for pathfinding — which room is a point in?) ────────────
const ZONES = Object.entries(ROOM_RECTS).map(([id, r]) => ({ id, ...r }))
export function getZone(x, y) {
  for (const z of ZONES) if (x >= z.x1 && x <= z.x2 && y >= z.y1 && y <= z.y2) return z.id
  if (x >= 500 && y < 215) return x < 510 ? 'mainOffice' : 'entrance'
  if (x >= 500 && y >= 235) return x < 510 ? 'mainOffice' : 'meetingRoom'
  if (y >= 345 && x <= 500) return y < 355 ? 'mainOffice' : 'lounge'
  return 'mainOffice'
}
const DOORS = Object.fromEntries(Object.entries(DOOR_SIDES).map(([id, sides]) => {
  const [a, b] = Object.values(sides)
  return [id, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]
}))
const ROUTE = {
 entrance: { mainOffice:'entranceToMain', lounge:'entranceToMain', meetingRoom:'entranceToMain' },
 mainOffice: { entrance:'entranceToMain', lounge:'mainToLounge', meetingRoom:'mainToMeeting' },
 meetingRoom: { mainOffice:'mainToMeeting', entrance:'mainToMeeting', lounge:'mainToMeeting' },
 lounge: { mainOffice:'mainToLounge', entrance:'mainToLounge', meetingRoom:'mainToLounge' },
}
// Room-local corners feed the existing visibility graph; no per-frame rerouting.
const ZONE_ROUTE_NODES = Object.fromEntries(Object.entries(ROOM_RECTS).map(([id,z]) => [id,
 ZONE_OBSTACLES[id].flatMap(r => [
 {x:r.x1-10,y:r.y1-10},{x:r.x2+10,y:r.y1-10},{x:r.x1-10,y:r.y2+10},{x:r.x2+10,y:r.y2+10},
 ]).filter(p => p.x>=z.x1+5 && p.x<=z.x2-5 && p.y>=z.y1+5 && p.y<=z.y2-5 && !isOnObstacle(p.x,p.y)),
]))
export const MAIN_ROUTE_NODES = ZONE_ROUTE_NODES.mainOffice

// ─── Path calculation ───────────────────────────────────────────────

export function lineHitsRect(ax, ay, bx, by, r) {
  const dx = bx - ax, dy = by - ay
  let tMin = 0, tMax = 1
  // Order the slab intersection bounds with a scalar temp instead of a destructuring
  // swap `[t1, t2] = [t2, t1]` — the latter allocates a 2-element array literal each
  // time the line runs backward through a slab. lineHitsRect is called per desk per
  // line-segment inside calculatePath's corridor routing.
  // Near-axis branches test the segment's coordinate RANGE, not just the start point:
  // a start-only check missed near-vertical segments drifting <0.1px across an edge
  // plane (jittered Dijkstra nodes produced real 0.005–0.3px furniture grazes at ~0.3%
  // of pairs — chip task_4be9264a). Range check is conservative: it never misses a real
  // hit and may over-flag by ≤0.1px, which only makes a jitter candidate fall back to
  // its exact node.
  if (Math.abs(dx) > 0.1) {
    let t1 = (r.x1 - ax) / dx, t2 = (r.x2 - ax) / dx
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
    tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2)
    if (tMin > tMax) return false
  } else if (Math.max(ax, bx) < r.x1 || Math.min(ax, bx) > r.x2) return false
  if (Math.abs(dy) > 0.1) {
    let t1 = (r.y1 - ay) / dy, t2 = (r.y2 - ay) / dy
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp }
    tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2)
    if (tMin > tMax) return false
  } else if (Math.max(ay, by) < r.y1 || Math.min(ay, by) > r.y2) return false
  return true
}

function lineHitsAnyRect(ax, ay, bx, by, rects) {
  return rects.some(r => lineHitsRect(ax, ay, bx, by, r))
}

// Wedge-escape candidates (issue #27): an endpoint parked in the 1–7px band off a
// furniture rect (clampToFloor's 6px standoff lives in this band) can be unreachable
// from the FIXED node set — desk "canyons" (e.g. the 50px pm/arch gap) open along one
// axis only, so every fixed-node segment crosses a desk, findSafePolyline returns null,
// and the caller's last-resort relay emits a crossing segment (fuzz suite never saw it:
// its clean points keep an 8px margin by design). For each rect hugging the endpoint,
// project just past each of the rect's four edges through the endpoint's own coordinate
// — a surviving candidate is, by construction, connectable to the endpoint along the
// open axis. Pure ADDITION to the Dijkstra node set: every edge still passes the same
// validation, so a found path is never worse — only previously-null routes gain an exit.
const WEDGE_NEAR_PX = 12   // covers the sub-MARGIN band incl. OBSTACLE_PUSH_PX + jitter slack
const WEDGE_ESCAPE_PX = 10 // lands the candidate just outside the wedge band
function wedgeEscapeNodes(p, obstacles) {
  const out = []
  for (const r of obstacles) {
    if (p.x < r.x1 - WEDGE_NEAR_PX || p.x > r.x2 + WEDGE_NEAR_PX) continue
    if (p.y < r.y1 - WEDGE_NEAR_PX || p.y > r.y2 + WEDGE_NEAR_PX) continue
    for (const c of [
      { x: p.x, y: r.y1 - WEDGE_ESCAPE_PX },
      { x: p.x, y: r.y2 + WEDGE_ESCAPE_PX },
      { x: r.x1 - WEDGE_ESCAPE_PX, y: p.y },
      { x: r.x2 + WEDGE_ESCAPE_PX, y: p.y },
    ]) {
      if (isOnFloor(c.x, c.y) && !isOnObstacle(c.x, c.y)) out.push(c)
    }
  }
  return out
}

function findSafePolyline(from, to, nodes, obstacles) {
  const room = ROOM_RECTS[getZone(from.x, from.y)]
  const inside = p => p.x >= room.x1 + 5 && p.x <= room.x2 - 5 && p.y >= room.y1 + 5 && p.y <= room.y2 - 5
  const candidates = [...nodes, ...wedgeEscapeNodes(from, obstacles), ...wedgeEscapeNodes(to, obstacles)].filter(inside)
  const pts = [from, to, ...candidates]
  const n = pts.length
  const dist = Array(n).fill(Infinity)
  const prev = Array(n).fill(-1)
  const visited = Array(n).fill(false)
  dist[0] = 0

  for (let iter = 0; iter < n; iter++) {
    let u = -1, best = Infinity
    for (let i = 0; i < n; i++) {
      if (!visited[i] && dist[i] < best) { u = i; best = dist[i] }
    }
    if (u === -1 || u === 1) break
    visited[u] = true

    for (let v = 1; v < n; v++) {
      if (visited[v] || v === u) continue
      if (lineHitsAnyRect(pts[u].x, pts[u].y, pts[v].x, pts[v].y, obstacles)) continue
      const edge = Math.hypot(pts[u].x - pts[v].x, pts[u].y - pts[v].y)
      if (dist[u] + edge < dist[v]) {
        dist[v] = dist[u] + edge
        prev[v] = u
      }
    }
  }

  if (!Number.isFinite(dist[1])) return null
  const idxRoute = []
  for (let cur = 1; cur !== 0 && cur !== -1; cur = prev[cur]) idxRoute.push(cur)
  idxRoute.reverse()
  // Anti-stacking jitter (owner bug 2026-06-11: "研究員跟不知道誰疊在一起"): the Dijkstra
  // nodes are EXACT shared coordinates — two agents traversing the same aisle at the same
  // moment landed on the SAME pixel (live-captured: pm and dev both at (300,180), dist 0).
  // findBestCorridor already jitters (validated, see above); this graph path did not. Offset each
  // INTERMEDIATE node (never the destination), accepting a candidate only when it stays on
  // the floor, off furniture, AND both adjacent segments stay obstacle-free — otherwise
  // fall back to the exact node, so a path is NEVER worse than today's. Chain validation:
  // segment (out[i] → out[i+1]) is checked when processing i+1 with both FINAL positions
  // (prev = already-jittered output; next = exact node now, re-checked at its own turn).
  // Also stop pushing the SHARED node objects into paths (latent aliasing) — copies only.
  const out = []
  for (let i = 0; i < idxRoute.length; i++) {
    const idx = idxRoute[i]
    const node = pts[idx]
    if (idx === 1) { out.push({ x: node.x, y: node.y }); continue }  // destination — exact
    const prevPt = out.length > 0 ? out[out.length - 1] : pts[0]
    const nextPt = pts[idxRoute[i + 1]]  // exact next (or the destination)
    let placed = null
    for (let attempt = 0; attempt < 4 && !placed; attempt++) {
      const cand = {
        x: node.x + (Math.random() - 0.5) * CORRIDOR_JITTER,
        y: node.y + (Math.random() - 0.5) * 12,
      }
      if (!inside(cand) || isOnObstacle(cand.x, cand.y)) continue
      if (lineHitsAnyRect(prevPt.x, prevPt.y, cand.x, cand.y, obstacles)) continue
      if (nextPt && lineHitsAnyRect(cand.x, cand.y, nextPt.x, nextPt.y, obstacles)) continue
      placed = cand
    }
    out.push(placed || { x: node.x, y: node.y })
  }
  return out
}

function pushPoint(path, pt) {
  const last = path[path.length - 1]
  if (!last || Math.hypot(last.x - pt.x, last.y - pt.y) > 2) path.push(pt)
}

// Per-transit door-anchor jitter (forensic capture 2026-06-10: 10/12 standing-stack events
// sat at the LITERAL coordinate (240,386) = mainToLounge's raw anchor — every cross-zone
// walk funneled through the same pixel, so any pause/freeze there stacked agents at 0px).
// One shared offset is applied to BOTH sides of a crossing, PERPENDICULAR to the travel
// axis (i.e. along the wall opening), keeping the crossing segment parallel to the raw one
// — it cannot clip the door frame as long as the offset stays inside the passage, which the
// per-endpoint floor/obstacle validation guarantees (door passages are FLOOR_ZONES). Falls
// back to the raw anchors when a jittered endpoint would leave the floor.
// SPATIAL LIMIT (measured 2026-07-16 — characterized by tests/doorCrossingSeparation.test.js):
// the offset below is PERPENDICULAR to travel only, so the TRAVEL axis gets EXACTLY ZERO spread
// and two agents at one door side are always <= DOOR_JITTER (20px) apart — inside the soak's
// STACK_DIST_PX (30) alarm AND inside the 32x44 sprite ellipse. The ±10px only turned a 0px
// point-stack into a 20px segment (a clean-CI soak once put 4/4 stacks at x=585, mainToMeeting).
// RAISING DOOR_JITTER CANNOT FIX THIS — the opening is ~50px and the isOnFloor/isOnObstacle check
// rejects anything outside it, so the geometry cannot hold two agents 30px apart. The stack is
// prevented TEMPORALLY instead: AVO-187 (ADR-010) grants each physical door to one journey at a
// time (src/systems/doorClaims.js), and a denied agent waits where it stands rather than meeting
// the first one at the door.
function jitterDoorCrossing(fromSide, toSide) {
  const travelX = Math.abs(toSide.x - fromSide.x) >= Math.abs(toSide.y - fromSide.y)
  for (let attempt = 0; attempt < 4; attempt++) {
    const off = (Math.random() - 0.5) * DOOR_JITTER // ±10px along the opening
    const a = travelX ? { x: fromSide.x, y: fromSide.y + off } : { x: fromSide.x + off, y: fromSide.y }
    const b = travelX ? { x: toSide.x, y: toSide.y + off } : { x: toSide.x + off, y: toSide.y }
    if (isOnFloor(a.x, a.y) && !isOnObstacle(a.x, a.y) && isOnFloor(b.x, b.y) && !isOnObstacle(b.x, b.y)) {
      return [a, b]
    }
  }
  return [fromSide, toSide]
}

const ZONE_FLOOR_RECTS = Object.fromEntries(FLOOR_ZONES.filter(z => !z.id.startsWith('door-')).map(z => [z.id,z]))

// Zone-mouth stub (issue-#27 review Finding 2): every zone router validates segments
// against furniture rects only — floor membership of segment INTERIORS is implied by
// both endpoints sitting inside the zone's convex floor rect. getZone, however, also
// assigns the door strips to a zone (e.g. door-lounge passage y 418–424 → lounge), so a
// strip endpoint admitted a furniture-free diagonal straight through the wall band
// (measured 130/720 door-strip pairs off-floor). For an ON-FLOOR endpoint outside the
// convex rect (⇒ it is on door-passage floor), route via its "mouth": the projection
// onto the rect. The endpoint→mouth stub runs along the passage axis, on passage floor
// by construction; past the mouth the routers' convexity assumption holds again.
// Off-floor (bogus) inputs and in-rect inputs keep pre-fix behavior byte-identical.
function zoneMouth(p, zone) {
  const r = ZONE_FLOOR_RECTS[zone]
  if (!r) return null
  if (p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2) return null
  if (!isOnFloor(p.x, p.y)) return null
  return {
    x: Math.max(r.x1, Math.min(r.x2, p.x)),
    y: Math.max(r.y1, Math.min(r.y2, p.y)),
  }
}

function routeWithinZone(from, to, zone) {
  const inner = (a, b) => {
    const obstacles = ZONE_OBSTACLES[zone] || []
    if (!lineHitsAnyRect(a.x, a.y, b.x, b.y, obstacles)) return [b]
    return findSafePolyline(a, b, ZONE_ROUTE_NODES[zone] || [], obstacles) || [a]
  }
  const fromMouth = zoneMouth(from, zone)
  const toMouth = zoneMouth(to, zone)
  if (!fromMouth && !toMouth) return inner(from, to)
  const pts = []
  if (fromMouth) pts.push(fromMouth)
  for (const pt of inner(fromMouth || from, toMouth || to)) pts.push(pt)
  if (toMouth) pts.push(to)
  return pts
}

function appendZoneRoute(path, from, to, zone) {
  for (const pt of routeWithinZone(from, to, zone)) pushPoint(path, pt)
}

export function calculateJourney(from, to) {
  const fromZone = getZone(from.x, from.y)
  const toZone = getZone(to.x, to.y)

  if (fromZone === toZone) {
    return { waypoints: routeWithinZone(from, to, fromZone), doorIds: [] }
  }

  const path = []
  const doorIds = []
  const exitDoor = ROUTE[fromZone]?.[toZone]

  if (exitDoor) {
    doorIds.push(exitDoor)
    const sides = DOOR_SIDES[exitDoor]
    const rawFromSide = sides?.[fromZone] || DOORS[exitDoor]
    const exitToZone = toZone === 'mainOffice' || fromZone === 'mainOffice' ? toZone : 'mainOffice'
    const rawToSide = sides?.[exitToZone] || DOORS[exitDoor]
    const [fromSide, toSide] = jitterDoorCrossing(rawFromSide, rawToSide)
    appendZoneRoute(path, from, fromSide, fromZone)
    pushPoint(path, toSide)
  }

  // Multi-room transit (e.g., lounge → research goes through mainOffice)
  if (fromZone !== 'mainOffice' && toZone !== 'mainOffice') {
    const entryDoor = ROUTE.mainOffice?.[toZone]
    if (entryDoor && entryDoor !== exitDoor) {
      doorIds.push(entryDoor)
      const sides = DOOR_SIDES[entryDoor]
      const rawMainSide = sides?.mainOffice || DOORS[entryDoor]
      const rawToSide = sides?.[toZone] || DOORS[entryDoor]
      const [mainSide, toSide] = jitterDoorCrossing(rawMainSide, rawToSide)
      const prevPt = path[path.length - 1] || from
      appendZoneRoute(path, prevPt, mainSide, 'mainOffice')
      pushPoint(path, toSide)
    }
  }

  const last = path[path.length - 1] || from
  appendZoneRoute(path, last, to, toZone)
  return { waypoints: path, doorIds }
}

export function calculatePath(from, to) {
  return calculateJourney(from, to).waypoints
}

// ─── Behavior → destination mapping ─────────────────────────────────
const BEHAVIOR_LOCATIONS = {
  'goto-coffee-machine': 'coffeeArea',
  'drink-coffee':        'coffeeArea',
  'drink-water':         'waterCooler',
  'whiteboard':          'whiteboard',
  'nap':                 'lounge',
  'phone-call':          'phone',
  'toilet':              'toilet',
  'research':            'researchLib',
  'meeting':             null,  // handled specially with MEETING_CHAIRS
  'print':               'printer',
  'look-window':         'window',
  'eat-snack':           'snackArea',
  'stretch':             'lounge',
  'check-phone':         'lounge',
}

export const SOCIAL_BEHAVIORS = new Set(['chat', 'thumbs-up', 'pass-document'])

// Returns true if this behavior requires the character to walk to a specific location
// (not their desk). Used to defer behavior labels until arrival.
export function needsLocationChange(behaviorId) {
  if (SOCIAL_BEHAVIORS.has(behaviorId)) return true
  const key = BEHAVIOR_LOCATIONS[behaviorId]
  return key !== undefined  // has an entry (even null for meeting)
}

// ─── Anti-overlap system ──────────────────────────────────────────────
// (the separation contract is the visual ellipse below, not a circular MIN_AGENT_DIST — that
// constant was removed in AVO-184 as it had no remaining consumers.)
import { OBSTACLE_PUSH_PX, CORRIDOR_JITTER, DOOR_JITTER } from './constants.js'

// Get all other agents' claimed standing spots. Resolution order matters (forensic
// capture 2026-06-10, RC-3 "leg-target blindness"): `targetPosition` is only the CURRENT
// LEG of a multi-waypoint walk (a corridor/door node) — while A crosses the office, a
// picker that read targetPosition saw A "at the corridor" and happily claimed A's actual
// landing spot. `journeyTarget` (published by AgentCharacter at walk start, cleared on
// arrival/abort) is the walk's END — the spot A will actually occupy.
function getOccupiedPositions(agentId, allAgents) {
  const positions = []
  if (!allAgents) return positions
  // Iterate keys directly — Object.entries() allocates an array of [id,agent]
  // pair arrays; only the value is needed and the id is read in place.
  for (const id of Object.keys(allAgents)) {
    if (id === agentId) continue
    const agent = allAgents[id]
    const pos = agent.journeyTarget || agent.targetPosition || agent.position
    if (pos) positions.push(pos)
  }
  return positions
}

// Visual-footprint overlap predicate. Sprites are ANISOTROPIC in the 3/4 view — ~32px wide
// but ~44px tall (body + head + label) — so the old circular MIN_AGENT_DIST=35 check let two
// agents stand 35px apart VERTICALLY and still read as a full stack (the PR #103 gate-stack
// geometry lesson, previously applied only to the social branch). Elliptical metric: overlap
// iff (dx/rx)² + (dy/ry)² < 1 with rx=32, ry=44. Pure → unit-testable.
export const SPRITE_CLEAR_RX = 32
export const SPRITE_CLEAR_RY = 44
export function visuallyOverlapping(a, b, rx = SPRITE_CLEAR_RX, ry = SPRITE_CLEAR_RY) {
  const nx = (a.x - b.x) / rx
  const ny = (a.y - b.y) / ry
  return nx * nx + ny * ny < 1
}

// Push a position away from all occupied positions until it clears the visual ellipse of
// every one of them. The push is RADIAL and CUMULATIVE — the current offset from the
// pusher is SCALED out to the ellipse boundary (+5-9px margin), preserving its direction,
// so pushes from multiple occupants COMPOSE the way the old circular code did. (A first
// draft SET x relative to whichever pusher it overlapped; with two standers in the same
// horizontal band — coffee machine + water cooler — it oscillated between them and
// returned a still-overlapping spot 12.4% of the time. Fresh review 2026-06-10, HIGH.)
export function avoidOverlap(pos, occupied, maxAttempts = 8) {
  let { x, y } = pos
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let pushed = false
    for (const other of occupied) {
      if (!visuallyOverlapping({ x, y }, other)) continue
      pushed = true
      let dx = x - other.x, dy = y - other.y
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        // Nearly identical — pick a random escape direction, horizontally weighted
        // (sideways needs less distance AND reads naturally, 並肩).
        dx = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random())
        dy = (Math.random() - 0.5)
      }
      // Current elliptical radius (<1 means inside); scale the offset to land on the
      // boundary plus margin. One step fully escapes THIS pusher along the existing
      // direction — cumulative across pushers, no teleport-oscillation.
      const k = Math.hypot(dx / SPRITE_CLEAR_RX, dy / SPRITE_CLEAR_RY)
      const grow = (1 + (5 + Math.random() * 4) / SPRITE_CLEAR_RX) / Math.max(k, 0.05)
      x = other.x + dx * grow
      y = other.y + dy * grow
    }
    const clamped = clampToFloor({ x, y })
    x = clamped.x; y = clamped.y
    if (!pushed && !occupied.some(o => visuallyOverlapping({ x, y }, o))) return { x, y }
  }
  // Iterations exhausted (dense cluster / clamp keeps re-entering an ellipse): ring search
  // around the SEED for the nearest spot clear of EVERYONE — horizontal directions first.
  const ANGLES = [0, Math.PI, Math.PI / 6, Math.PI - Math.PI / 6, -Math.PI / 6, Math.PI + Math.PI / 6, Math.PI / 2, -Math.PI / 2]
  for (const r of [SPRITE_CLEAR_RX + 8, SPRITE_CLEAR_RX + 22, SPRITE_CLEAR_RX + 38]) {
    for (const a of ANGLES) {
      const cand = clampToFloor({ x: pos.x + Math.cos(a) * r, y: pos.y + Math.sin(a) * r * 0.8 })
      if (!occupied.some(o => visuallyOverlapping(cand, o))) return cand
    }
  }
  return clampToFloor({ x, y })  // degraded fallback (matches the old code's last-resort behavior)
}

export function resolveClaimAwareHomePosition(agentId, allAgents) {
  const home = HOME_POSITIONS[agentId] || null
  if (!home) return null
  const occupied = getOccupiedPositions(agentId, allAgents)
  if (!occupied.some(o => visuallyOverlapping(home, o))) return home
  return avoidOverlap(home, occupied)
}

// Add jitter then clamp to walkable floor
function jitter(pos, amount = 16) {
  return clampToFloor({
    x: pos.x + (Math.random() - 0.5) * amount,
    y: pos.y + (Math.random() - 0.5) * amount,
  })
}

// Exported helper: picks a social walk target for agentId from allAgents.
// Returns { targetId, position } or null when no valid target exists.
// Separated from getTargetForBehavior so callers (e.g. doSchedule in AgentCharacter)
// can capture the chosen targetId for facing-on-arrival without a second random pick.
export function pickSocialTarget(agentId, allAgents) {
  if (!allAgents) return null
  const others = Object.keys(allAgents).filter(id => id !== agentId)
  if (others.length === 0) return null
  const targetId = others[Math.floor(Math.random() * others.length)]
  const position = allAgents[targetId]?.position
  if (!position) return null
  return { targetId, position }
}

export function getTargetForBehavior(agentId, behaviorId, allAgents, socialTargetOverride = null) {
  // Lazily resolve the occupied-positions list — getOccupiedPositions scans every
  // agent and allocates an array. The MOST common case is a desk/work behavior
  // (the `work` category carries 65% of the weight in behaviorEngine, and all of
  // its behaviors map to HOME_POSITIONS via the `waypointKey === undefined`
  // early-return below), which never reads `occupied`. Building it unconditionally
  // meant an all-agents scan + array allocation per agent per behavior cycle that
  // was discarded for the majority path. Compute it only when a branch needs it.
  let _occupied = null
  const occupiedPositions = () => {
    if (_occupied === null) _occupied = getOccupiedPositions(agentId, allAgents)
    return _occupied
  }

  // Meeting: pick a random chair around the table
  if (behaviorId === 'meeting') {
    const occupied = occupiedPositions()
    // Pick a chair that's not already occupied
    const shuffled = [...MEETING_CHAIRS].sort(() => Math.random() - 0.5)
    for (const chair of shuffled) {
      const isFree = !occupied.some(o => Math.hypot(o.x - chair.x, o.y - chair.y) < 30)
      if (isFree) return clampToFloor(jitter(chair, 8))
    }
    return clampToFloor(jitter(shuffled[0], 8))
  }

  // Social behaviors: walk toward a random other agent (near them, not on them).
  // `socialTargetOverride` (optional 4th param) lets the caller pre-pick the peer and
  // pass it in, so the WALK destination and the FACE-toward-on-arrival peer are the
  // SAME agent — two independent random picks would walk to B while facing A.
  if (SOCIAL_BEHAVIORS.has(behaviorId) && allAgents) {
    const picked = socialTargetOverride || pickSocialTarget(agentId, allAgents)
    if (picked) {
      // Lateral-bias (owner screenshot 2026-06-11: THREE sprites stacked at the gate —
      // gate + two social visitors): sprites are ~40px TALL in the 3/4 view, so a visitor
      // landing directly above/below the peer overlaps visually even at the full 70px ring.
      // Sample the approach angle from two ±45° cones around horizontal (stand BESIDE the
      // peer — 並肩聊天) instead of uniform 0–2π; the horizontal offset always ≥ the
      // vertical one by construction, so the tall sprites can never stack into a vertical
      // column while the distance ring stays 50–70px.
      const side = Math.random() < 0.5 ? 0 : Math.PI
      const angle = side + (Math.random() - 0.5) * (Math.PI / 2)
      // Owner-approved 2026-06-10: dist widened 30–45 → 50–70px.
      // Sprite effective width ~35-40px → 1.4–1.8 sprite-widths = "walked up to you"
      // rather than "standing on you". Addresses measured 40–70% rate of pairs under
      // 30px in the organic proximity audit (anyUnder30 408/705, 495/705 across runs).
      const dist = 50 + Math.random() * 20  // stay 50-70px away
      const raw = clampToFloor({
        x: picked.position.x + Math.cos(angle) * dist,
        y: picked.position.y + Math.sin(angle) * dist,
      })
      return avoidOverlap(raw, occupiedPositions())
    }
  }

  // Home position — keep the exact seat when clear, but side-step if another
  // agent currently claims it. Soak caught owners walking back into occupied
  // desks and visibly stacking beside the stander for several seconds.
  const waypointKey = BEHAVIOR_LOCATIONS[behaviorId]
  if (waypointKey === undefined) return resolveClaimAwareHomePosition(agentId, allAgents)

  const base = WAYPOINTS[waypointKey] || HOME_POSITIONS[agentId]
  if (!base) return null
  const jittered = jitter(base, 24)
  return avoidOverlap(jittered, occupiedPositions())
}

export function calcFacing(fromX, fromY, toX, toY) {
  const dx = toX - fromX, dy = toY - fromY
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return 'down'
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
}

// living-office L2 (focusAnchor): the facing an UNTRACKED, stationary agent should adopt to orient
// toward the hottest live desk — or null if it must NOT orient. Pure + exported so AC-4 is testable
// without the doSchedule component loop. Honesty guards baked in:
//   - tracked agent (has a live externalStatus entry) → null (R1: never modulate a real desk)
//   - no anchor / self / stale anchor (missing or idle) → null (stale-pointer bail)
//   - slug~role worktree anchor falls back to its base-role rendered agent
export function resolveFocusFacing(state, id, fromX, fromY) {
  if (!state || !id) return null
  if (state.externalStatus && state.externalStatus[id]) return null // tracked → never (R1)
  const anchorId = state.focusAnchor
  if (!anchorId || anchorId === id) return null
  const agents = state.agents || {}
  let anchor = agents[anchorId]
  if (!anchor && anchorId.includes('~')) anchor = agents[anchorId.slice(anchorId.lastIndexOf('~') + 1)]
  if (!anchor || !anchor.position || anchor.status === 'idle') return null // stale/missing/idle bail
  return calcFacing(fromX, fromY, anchor.position.x, anchor.position.y)
}

