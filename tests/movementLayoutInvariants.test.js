import { FLOOR_ZONES, OBSTACLE_RECTS } from './whiteLayoutFixture.js'
import { describe, it, expect } from 'vitest'
import {
  MAIN_ROUTE_NODES,
  DOOR_SIDES,
  getZone,
} from '../src/systems/movementSystem.js'

// These mirror the visual layout (PixelOffice.jsx / movementSystem internals) and act
// as the independent SPEC the hardcoded route graph must satisfy. If the office layout
// shifts and a waypoint or door anchor drifts into a wall or a piece of furniture, these
// invariants fail loudly instead of the pathing silently dropping a now-unreachable node
// (as happened when the whiteboard was added to the line-crossing obstacle set and the
// right-aisle corridor ended up buried inside it).

function onFloor(p) {
  return FLOOR_ZONES.some((z) => p.x >= z.x1 && p.x <= z.x2 && p.y >= z.y1 && p.y <= z.y2)
}

function obstacleAt(p) {
  return OBSTACLE_RECTS.find((r) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2)
}

function segmentStaysOnFloor(a, b, step = 4) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  const n = Math.max(1, Math.ceil(dist / step))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    if (!onFloor(p)) return p
  }
  return null
}

describe('movement layout invariants — hardcoded route graph must match the floor', () => {
  it('every main-office route node sits on the floor and clear of furniture', () => {
    for (const node of MAIN_ROUTE_NODES) {
      expect(onFloor(node), `route node (${node.x},${node.y}) is off-floor`).toBe(true)
      const obstacle = obstacleAt(node)
      expect(
        obstacle?.name,
        `route node (${node.x},${node.y}) is buried inside ${obstacle?.name}`,
      ).toBeUndefined()
    }
  })

  it('every door anchor sits on the floor and clear of furniture', () => {
    for (const [door, sides] of Object.entries(DOOR_SIDES)) {
      for (const [side, pt] of Object.entries(sides)) {
        expect(onFloor(pt), `${door}.${side} (${pt.x},${pt.y}) is off-floor`).toBe(true)
        const obstacle = obstacleAt(pt)
        expect(
          obstacle?.name,
          `${door}.${side} (${pt.x},${pt.y}) is inside ${obstacle?.name}`,
        ).toBeUndefined()
      }
    }
  })

  it('each door anchor is classified into the zone it claims to belong to', () => {
    for (const [door, sides] of Object.entries(DOOR_SIDES)) {
      for (const [side, pt] of Object.entries(sides)) {
        expect(getZone(pt.x, pt.y), `${door}.${side} should be in zone "${side}"`).toBe(side)
      }
    }
  })

  it('the two anchors of every door are connected by an on-floor straight segment', () => {
    for (const [door, sides] of Object.entries(DOOR_SIDES)) {
      const [a, b] = Object.values(sides)
      const offFloor = segmentStaysOnFloor(a, b)
      expect(
        offFloor,
        `${door} anchors are not connected on-floor (gap at ${offFloor ? `${offFloor.x.toFixed(1)},${offFloor.y.toFixed(1)}` : ''})`,
      ).toBeNull()
    }
  })
})
