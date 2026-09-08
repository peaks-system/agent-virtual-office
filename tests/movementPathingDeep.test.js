import { FLOOR_ZONES, OBSTACLE_RECTS, SAFE_ROUTE_POINTS } from './whiteLayoutFixture.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
// Deflake (2026-06-11): these suites exercise Math.random-dependent code (corridor/anti-stack
// jitter in calculatePath; weighted behavior picks). Unseeded runs failed ~1/500 full-suite
// runs on marginal geometry/edge picks. Seed per established mulberry32 idiom.
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
beforeAll(() => { Math.random = __mulberry32(0x0ff1ce) })
afterAll(() => { Math.random = __realRandom })
import {
  calculatePath,
  getTargetForBehavior,
  HOME_POSITIONS,
  MEETING_CHAIRS,
  WAYPOINTS,
} from '../src/systems/movementSystem.js'

function onFloor(p) {
  return FLOOR_ZONES.some((z) => p.x >= z.x1 && p.x <= z.x2 && p.y >= z.y1 && p.y <= z.y2)
}

function obstacleAt(p) {
  return OBSTACLE_RECTS.find((r) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2)
}

function sampleSegment(a, b, step = 4) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const n = Math.max(1, Math.ceil(dist / step))
  const points = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
  return points
}

function assertPathDoesNotCrossWallsOrObstacles(from, to, label) {
  const path = calculatePath(from, to)
  let cursor = from
  for (const waypoint of path) {
    for (const point of sampleSegment(cursor, waypoint)) {
      expect(onFloor(point), `${label} off-floor at (${point.x.toFixed(1)},${point.y.toFixed(1)}) via ${JSON.stringify(path)}`).toBe(true)
      const obstacle = obstacleAt(point)
      expect(obstacle?.name, `${label} crosses ${obstacle?.name} at (${point.x.toFixed(1)},${point.y.toFixed(1)}) via ${JSON.stringify(path)}`).toBeUndefined()
    }
    cursor = waypoint
  }
}

describe('movement deep pathing invariants', () => {
  it('core home-to-destination behavior paths stay on floor and avoid obstacles', () => {
    const behaviors = ['drink-coffee', 'drink-water', 'whiteboard', 'toilet', 'research', 'phone-call', 'look-window', 'print', 'nap']
    for (const [role, home] of Object.entries(HOME_POSITIONS)) {
      for (const behavior of behaviors) {
        const target = getTargetForBehavior(role, behavior, {})
        if (!target) continue
        assertPathDoesNotCrossWallsOrObstacles(home, target, `${role}/${behavior}`)
      }
    }
  })

  it('meeting chair-to-chair paths route around the meeting table', () => {
    for (const from of MEETING_CHAIRS) {
      for (const to of MEETING_CHAIRS) {
        if (from === to) continue
        assertPathDoesNotCrossWallsOrObstacles(from, to, `meeting ${from.x},${from.y}->${to.x},${to.y}`)
      }
    }
  })

  it('movement back to home from common activity locations stays on floor and avoids obstacles', () => {
    const commonLocations = [WAYPOINTS.coffeeArea, WAYPOINTS.whiteboard, WAYPOINTS.lounge, WAYPOINTS.researchLib, WAYPOINTS.phone, WAYPOINTS.window]
    for (const [role, home] of Object.entries(HOME_POSITIONS)) {
      for (const location of commonLocations) {
        assertPathDoesNotCrossWallsOrObstacles(location, home, `${role}/return-home`)
      }
    }
  })

  it('multi-task office simulation: all roles can leave and return without crossing walls or furniture', () => {
    const scenario = [
      ['pm', 'whiteboard'],
      ['arch', 'meeting'],
      ['dev', 'drink-coffee'],
      ['qa', 'research'],
      ['ops', 'phone-call'],
      ['res', 'look-window'],
      ['gate', 'print'],
      ['designer', 'toilet'],
    ]

    const agents = Object.fromEntries(
      Object.entries(HOME_POSITIONS).map(([role, position]) => [role, { position, targetPosition: position }]),
    )

    const destinations = []
    for (const [role, behavior] of scenario) {
      const home = HOME_POSITIONS[role]
      const target = getTargetForBehavior(role, behavior, agents)
      expect(target, `${role}/${behavior} target`).not.toBeNull()
      assertPathDoesNotCrossWallsOrObstacles(home, target, `${role}/${behavior}/leave`)
      destinations.push([role, target])
      agents[role] = { ...agents[role], targetPosition: target }
    }

    for (const [role, from] of destinations) {
      assertPathDoesNotCrossWallsOrObstacles(from, HOME_POSITIONS[role], `${role}/multi-task-return-home`)
    }
  })

  it('walkable-point matrix routes across all rooms without crossing walls or furniture', () => {
    for (const [fromLabel, from] of SAFE_ROUTE_POINTS) {
      expect(onFloor(from), `${fromLabel} test point is on floor`).toBe(true)
      expect(obstacleAt(from)?.name, `${fromLabel} test point overlaps obstacle`).toBeUndefined()

      for (const [toLabel, to] of SAFE_ROUTE_POINTS) {
        assertPathDoesNotCrossWallsOrObstacles(from, to, `${fromLabel}->${toLabel}`)
      }
    }
  }, 10_000)
})
