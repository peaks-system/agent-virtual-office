import { FLOOR_ZONES, OBSTACLE_RECTS, ROOMS } from './whiteLayoutFixture.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { calculatePath } from '../src/systems/movementSystem.js'

// Issue #27 — wedged-endpoint hardening. The pathing fuzz deliberately samples clean
// points ≥8px off furniture; this suite covers exactly the excluded band (1–7px),
// which includes OBSTACLE_PUSH_PX = 6 — the standoff clampToFloor emits every day.
// Pre-fix characterization (2026-06-11 probe, seeded): wedge distances 1–7px produced
// ~5% desk-crossing routes (e.g. 52/880 at d=1), all via routeWithinMainOffice's
// last-resort relay or the lounge lane's descent column. The fix (wedge-escape Dijkstra
// candidates + lounge clear-column) must keep this matrix at zero violations.

// Seed BOTH RNG consumers (cf. movementPathingFuzz): calculatePath consumes global
// randomness (corridor/door/polyline jitter) — unseeded failures would not replay.
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const realRandom = Math.random
beforeAll(() => { Math.random = mulberry32(0x27aabbcc) })
afterAll(() => { Math.random = realRandom })

// Independent oracle (re-declared, not imported). Superset of the fuzz list: adds the
// research furniture. The entrance gate booth is deliberately ABSENT — sprites clipping
// its right edge is an accepted trade-off (see movementSystem OBSTACLE_RECTS comment:
// a full-width rect would wall the gate behind its own counter).

const onFloor = (p) => FLOOR_ZONES.some((z) => p.x >= z.x1 && p.x <= z.x2 && p.y >= z.y1 && p.y <= z.y2)
const obstacleAt = (p) => OBSTACLE_RECTS.find((r) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2)

function firstViolation(from, to, step = 2) {
  const path = calculatePath(from, to)
  const last = path[path.length - 1]
  if (!last || last.x !== to.x || last.y !== to.y) return { kind: 'unreachable destination', at: last || from, path }
  let cursor = from
  for (const waypoint of path) {
    const dist = Math.hypot(waypoint.x - cursor.x, waypoint.y - cursor.y)
    const n = Math.max(1, Math.ceil(dist / step))
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const p = { x: cursor.x + (waypoint.x - cursor.x) * t, y: cursor.y + (waypoint.y - cursor.y) * t }
      if (!onFloor(p)) return { kind: 'off-floor', at: p, path }
      const hit = obstacleAt(p)
      if (hit) return { kind: `crosses ${hit.name}`, at: p, path }
    }
    cursor = waypoint
  }
  return null
}

// Wedge generator: points at exact gap d off each rect's edge midpoints and corners,
// on the floor and outside ALL furniture (a candidate inside an overlapping rect — the
// lounge wc/bookshelves rects overlap — is filtered, not a sample).
function wedgedPoints(d) {
  const pts = []
  for (const r of OBSTACLE_RECTS) {
    const midX = Math.round((r.x1 + r.x2) / 2)
    const midY = Math.round((r.y1 + r.y2) / 2)
    const cands = [
      { x: r.x1 - d, y: midY }, { x: r.x2 + d, y: midY },
      { x: midX, y: r.y1 - d }, { x: midX, y: r.y2 + d },
      { x: r.x1 - d, y: r.y1 - d }, { x: r.x2 + d, y: r.y1 - d },
      { x: r.x1 - d, y: r.y2 + d }, { x: r.x2 + d, y: r.y2 + d },
    ]
    for (const p of cands) {
      if (onFloor(p) && !obstacleAt(p)) pts.push({ ...p, rect: r.name, d })
    }
  }
  return pts
}

const CLEAN_ORIGINS = [
  { x: 60, y: 300 },   // mainOffice west aisle
  { x: 700, y: 300 },  // meetingRoom south of table
  { x: 120, y: 520 },  // lounge lane
]

// Fresh-review HIGH (2026-06-11): lounge graph routing must NOT engage for endpoints in
// the door-lounge strip (y 418–424 — getZone calls it lounge, but the floor there is only
// the door passage x 215–266). An ungated Dijkstra emitted a diagonal through the south
// wall for exactly these inputs (measured 104/720 pairs); the gate falls back to the
// pre-fix lane path, which is fully on-floor.
describe('door-strip endpoints keep an on-floor route (lounge graph gate)', () => {
  it('the reviewed counterexample (228,358.5)→(430,470) never leaves the floor', () => {
    for (let i = 0; i < 25; i++) {
      const v = firstViolation({ x: 228, y: 358.5 }, { x: 430, y: 470 })
      expect(v, v && `${v.kind} at (${v.at.x.toFixed(1)},${v.at.y.toFixed(1)}) via ${JSON.stringify(v.path)}`).toBeNull()
    }
  })

  it('a grid of door-strip → lounge pairs stays on-floor both directions', () => {
    // FULL grid — furniture-free pairs included. The early-return direct path used to
    // cut the wall band for these (review Finding 2: 130/720 pairs); the zone-mouth
    // stub in routeWithinZone now walks the passage axis onto the convex floor rect
    // before any straight-line shortcut is taken.
    const failures = []
    for (const sx of [226, 235, 250, 265, 279]) {
      for (const sy of [345, 351, 359, 368]) {
        for (const t of [{ x: 430, y: 470 }, { x: 300, y: 535 }, { x: 80, y: 480 }]) {
          for (const [from, to] of [[{ x: sx, y: sy }, t], [t, { x: sx, y: sy }]]) {
            const v = firstViolation(from, to)
            if (v) failures.push(`(${from.x},${from.y})->(${to.x},${to.y}) ${v.kind} at (${v.at.x.toFixed(1)},${v.at.y.toFixed(1)})`)
            if (failures.length >= 5) break
          }
        }
      }
    }
    expect(failures, `door-strip violations:\n${failures.join('\n')}`).toEqual([])
  })

  it('door-strip endpoints in EVERY zone route on-floor (same-zone journeys)', () => {
    // One on-passage-floor endpoint per zone strip (getZone classifies it into the zone,
    // but it sits outside the zone's convex floor rect), paired with in-room targets.
    const cases = [
      [{ x: 252, y: 350 }, { x: 60, y: 300 }],
      [{ x: 505, y: 127 }, { x: 60, y: 300 }],
      [{ x: 505, y: 292 }, { x: 60, y: 300 }],
      [{ x: 515, y: 127 }, { x: 700, y: 160 }],
      [{ x: 515, y: 292 }, { x: 700, y: 300 }],
      [{ x: 252, y: 360 }, { x: 440, y: 520 }],
    ]
    const failures = []
    for (const [a, b] of cases) {
      for (const [from, to] of [[a, b], [b, a]]) {
        for (let i = 0; i < 10; i++) {
          const v = firstViolation(from, to)
          if (v) {
            failures.push(`(${from.x},${from.y})->(${to.x},${to.y}) ${v.kind} at (${v.at.x.toFixed(1)},${v.at.y.toFixed(1)}) via ${JSON.stringify(v.path)}`)
            break
          }
        }
        if (failures.length >= 5) break
      }
    }
    expect(failures, `zone-strip violations:\n${failures.join('\n')}`).toEqual([])
  })
})

describe('wedged endpoints (1–7px off furniture) route without crossing furniture', () => {
  for (const d of [1, 2, 4, 6, 7]) {
    it(`wedge distance ${d}px — every origin↔wedge pair stays clean`, () => {
      const failures = []
      let checked = 0
      for (const w of wedgedPoints(d)) {
        for (const o of CLEAN_ORIGINS) {
          for (const [from, to] of [[o, w], [w, o]]) {
            checked++
            const v = firstViolation(from, to)
            if (v) {
              failures.push(
                `(${from.x},${from.y})->(${to.x},${to.y}) [wedge ${w.rect} d=${d}] ${v.kind} at ` +
                  `(${v.at.x.toFixed(1)},${v.at.y.toFixed(1)}) via ${JSON.stringify(v.path)}`,
              )
              if (failures.length >= 5) break
            }
          }
          if (failures.length >= 5) break
        }
        if (failures.length >= 5) break
      }
      expect(checked, 'matrix generated enough wedge pairs').toBeGreaterThan(200)
      expect(failures, `wedged-endpoint violations (d=${d}):\n${failures.join('\n')}`).toEqual([])
    }, 30_000)
  }
})
