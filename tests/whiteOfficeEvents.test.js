import { describe, it, expect } from 'vitest'
import { COFFEE_SPOTS, STANDUP_SPOTS, ROOM_RECTS } from '../src/systems/officeLayout.js'
import { isOnFloor, isOnObstacle } from '../src/systems/movementSystem.js'

describe('white office gathering destinations', () => {
  for (const [name, spots, room, jitter] of [
    ['coffee break', COFFEE_SPOTS, ROOM_RECTS.lounge, 6],
    ['standup', STANDUP_SPOTS, ROOM_RECTS.meetingRoom, 3.5],
  ]) {
    it(`${name} stays in its room and clear of furniture across event jitter`, () => {
      for (const spot of spots) for (const dx of [-jitter, 0, jitter]) for (const dy of [-jitter, 0, jitter]) {
        const x = spot.x + dx, y = spot.y + dy
        expect(x).toBeGreaterThan(room.x1)
        expect(x).toBeLessThan(room.x2)
        expect(y).toBeGreaterThan(room.y1)
        expect(y).toBeLessThan(room.y2)
        expect(isOnFloor(x, y)).toBe(true)
        expect(isOnObstacle(x, y)).toBe(false)
      }
    })
  }
})
