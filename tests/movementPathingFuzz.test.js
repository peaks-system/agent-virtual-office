import { FLOOR_ZONES, OBSTACLE_RECTS, ROOMS } from './whiteLayoutFixture.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { calculatePath } from '../src/systems/movementSystem.js'

// Seed Math.random (established mulberry32 idiom, cf. movementPathingDeep): calculatePath
// consumes GLOBAL randomness (corridor/door/polyline jitter), so point pairs were seeded
// but routes were not — a failure could never be reproduced. One unlucky unseeded jitter
// burst (2026-06-10) produced "crosses opsDesk/whiteboard" via the then-unvalidated
// findBestCorridor jitter; with both RNGs deterministic, any future failure replays.
function __mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const __realRandom = Math.random
beforeAll(() => { Math.random = __mulberry32(0xf02baa11) })
afterAll(() => { Math.random = __realRandom })

// Property-style fuzz over hundreds of randomly generated room points (seeded, so any
// failure reproduces). The deep test only checks 22 hand-picked anchors; this probes the
// gaps between them — especially destinations near furniture edges where findSafePolyline
// can return null and the corridor fallback might emit a wall-crossing segment.

// Real waypoints are clamped to stay OBSTACLE_PUSH_PX (6) off furniture, so we sample
// clean points with a slightly larger margin — points wedged against furniture have no
// safe route by construction and would be a meaningless failure.
const MARGIN = 8

function onFloor(p) {
  return FLOOR_ZONES.some((z) => p.x >= z.x1 && p.x <= z.x2 && p.y >= z.y1 && p.y <= z.y2)
}

function obstacleAt(p) {
  return OBSTACLE_RECTS.find((r) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2)
}

function nearObstacle(p) {
  return OBSTACLE_RECTS.some(
    (r) => p.x >= r.x1 - MARGIN && p.x <= r.x2 + MARGIN && p.y >= r.y1 - MARGIN && p.y <= r.y2 + MARGIN,
  )
}

// mulberry32 — tiny deterministic PRNG so a failing pair is always reproducible.
function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function cleanPoint(rng) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const room = ROOMS[Math.floor(rng() * ROOMS.length)]
    const p = {
      x: Math.round(room.x1 + 6 + rng() * (room.x2 - room.x1 - 12)),
      y: Math.round(room.y1 + 6 + rng() * (room.y2 - room.y1 - 12)),
    }
    if (onFloor(p) && !nearObstacle(p)) return p
  }
  return null
}

function firstViolation(from, to, step = 4) {
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

describe('movement pathing fuzz — random room-to-room routes stay walkable', () => {
  it('1000 seeded random point pairs never cross a wall or furniture', () => {
    const rng = makeRng(0x5eed1234)
    const failures = []
    let checked = 0

    for (let i = 0; i < 1000; i++) {
      const from = cleanPoint(rng)
      const to = cleanPoint(rng)
      if (!from || !to) continue
      checked++
      const violation = firstViolation(from, to)
      if (violation) {
        failures.push(
          `(${from.x},${from.y})->(${to.x},${to.y}) ${violation.kind} at ` +
            `(${violation.at.x.toFixed(1)},${violation.at.y.toFixed(1)}) via ${JSON.stringify(violation.path)}`,
        )
        if (failures.length >= 5) break
      }
    }

    expect(checked, 'generated enough clean sample points').toBeGreaterThan(500)
    expect(failures, `pathing violations:\n${failures.join('\n')}`).toEqual([])
  }, 15_000)

  it('corner-hugging pairs (the corridor-fallback clip class) never cross furniture', () => {
    // The one observed wild failure clipped desk/whiteboard CORNERS via the then-
    // unvalidated findBestCorridor jitter. Stress exactly that class: endpoints parked
    // just outside the safety margin of every main-office furniture corner, all pairs
    // crossing the room (forcing relay routing), full-segment sampling via firstViolation.
    const D = MARGIN + 2 // just outside the clean-point margin
    const corners = []
    for (const r of OBSTACLE_RECTS.slice(0, 9)) { // the 7 desks + meeting table + whiteboard
      for (const p of [
        { x: r.x1 - D, y: r.y1 - D }, { x: r.x2 + D, y: r.y1 - D },
        { x: r.x1 - D, y: r.y2 + D }, { x: r.x2 + D, y: r.y2 + D },
      ]) {
        if (onFloor(p) && !obstacleAt(p)) corners.push(p)
      }
    }
    expect(corners.length).toBeGreaterThan(15)
    const failures = []
    for (let i = 0; i < corners.length; i++) {
      for (let j = 0; j < corners.length; j++) {
        if (i === j) continue
        const violation = firstViolation(corners[i], corners[j])
        if (violation) {
          failures.push(`(${corners[i].x},${corners[i].y})->(${corners[j].x},${corners[j].y}) ${violation.kind} at (${violation.at.x.toFixed(1)},${violation.at.y.toFixed(1)})`)
          if (failures.length >= 5) break
        }
      }
      if (failures.length >= 5) break
    }
    expect(failures, `corner-pair violations:\n${failures.join('\n')}`).toEqual([])
  }, 15_000)
})
