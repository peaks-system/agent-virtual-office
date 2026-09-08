import { describe, it, expect, vi, afterEach } from 'vitest'
import { HOME_POSITIONS, LAYOUT_VERSION } from '../src/systems/officeLayout.js'

async function boot(snapshot) {
  vi.resetModules()
  const storage = new Map([['office-state', JSON.stringify(snapshot)], ['office-lang', 'ja']])
  vi.stubGlobal('localStorage', { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) })
  vi.stubGlobal('window', {
    location: { search: '?mode=agentcortex&lang=ja' }, addEventListener() {}, removeEventListener() {},
    __office_config__: { agents: { dev: { name: 'Personal developer', color: '#abcdef' } } },
  })
  return import('../src/systems/store.js')
}
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('white layout persisted position migration', () => {
  it('resets old coordinates on reload while retaining personal and desk preferences', async () => {
    const { useOfficeStore, createPersistedState } = await boot({
      _savedAt: Date.now(), agents: { dev: { position: { x: 340, y: 364 }, expression: 'focused', facing: 'left', deskItemCount: { coffee: 2, sticky: 1, books: 3 } } },
    })
    const agent = useOfficeStore.getState().agents.dev
    expect(agent.position).toEqual(HOME_POSITIONS.dev)
    expect(agent.targetPosition).toEqual(HOME_POSITIONS.dev)
    expect(agent).toMatchObject({ name: 'Personal developer', color: '#abcdef', expression: 'focused', facing: 'left', deskItemCount: { coffee: 2, sticky: 1, books: 3 } })
    const saved = createPersistedState(useOfficeStore.getState())
    expect(saved.layoutVersion).toBe(LAYOUT_VERSION)
    const reloaded = await boot(saved)
    expect(reloaded.useOfficeStore.getState().agents.dev.position).toEqual(HOME_POSITIONS.dev)
  })
  it('keeps a valid current-layout position across reload', async () => {
    const position = { x: 180, y: 480 }
    const { useOfficeStore } = await boot({ _savedAt: Date.now(), layoutVersion: LAYOUT_VERSION, agents: { dev: { position } } })
    expect(useOfficeStore.getState().agents.dev.position).toEqual(position)
    expect(useOfficeStore.getState().agents.dev.targetPosition).toEqual(position)
  })
  it('clamps a corrupt current-layout position away from walls and furniture', async () => {
    const { useOfficeStore } = await boot({ _savedAt: Date.now(), layoutVersion: LAYOUT_VERSION, agents: { dev: { position: { x: 510, y: 220 } } } })
    const { isOnFloor, isOnObstacle } = await import('../src/systems/movementSystem.js')
    const p = useOfficeStore.getState().agents.dev.position
    expect(isOnFloor(p.x,p.y)).toBe(true)
    expect(isOnObstacle(p.x,p.y)).toBe(false)
  })
})
