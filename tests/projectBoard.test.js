import { describe, it, expect, vi } from 'vitest'
import { createProjectBoard, PROJECT_STORAGE_KEY } from '../src/systems/projectBoard.js'

function memoryStorage(raw = null) {
  let value = raw
  return { getItem: vi.fn(() => value), setItem: vi.fn((key, next) => { value = next }), raw: () => value }
}

describe('local project board', () => {
  it('starts empty and persists project edits, task completion, selection and archive restoration across reload', () => {
    const storage = memoryStorage()
    const board = createProjectBoard(() => storage)
    expect(board.getState().projects).toEqual([])
    const a = board.getState().addProject('  Personal project  ')
    const b = board.getState().addProject('Second')
    board.getState().updateProject(a, { description: 'My description', plan: 'First step\nSecond step' })
    const task = board.getState().addTask(a, 'Check result')
    board.getState().toggleTask(a, task)
    board.getState().selectProject(a)
    let reloaded = createProjectBoard(() => storage)
    expect(reloaded.getState().selectedId).toBe(a)
    expect(reloaded.getState().projects[0]).toMatchObject({ title: 'Personal project', description: 'My description', plan: 'First step\nSecond step', tasks: [{ id: task, title: 'Check result', done: true }] })
    reloaded.getState().archiveProject(a)
    expect(reloaded.getState().selectedId).toBe(b)
    reloaded.getState().restoreProject(a)
    reloaded.getState().selectProject(a)
    reloaded.getState().removeTask(a, task)
    reloaded = createProjectBoard(() => storage)
    expect(reloaded.getState().projects[0]).toMatchObject({ archived: false, tasks: [] })
    expect(reloaded.getState().selectedId).toBe(a)
  })

  it('preserves original corrupt or unsupported storage and keeps new edits exportable in memory', () => {
    for (const raw of ['broken json', '{"version":99,"projects":[]}', '{"version":1,"projects":[null]}']) {
      const storage = memoryStorage(raw)
      const board = createProjectBoard(() => storage)
      expect(board.getState().storageError).toBeTruthy()
      const id = board.getState().addProject('Recoverable new notes')
      board.getState().updateProject(id, { plan: 'Keep this' })
      expect(storage.raw()).toBe(raw)
      expect(storage.setItem).not.toHaveBeenCalled()
      expect(JSON.parse(board.getState().exportProjects()).projects[0].plan).toBe('Keep this')
      expect(board.getState().storageError).toBeTruthy()
    }
  })

  it('retains in-memory changes on quota errors and recovers after successful later save', () => {
    const storage = memoryStorage()
    const board = createProjectBoard(() => storage)
    const id = board.getState().addProject('Quota test')
    const oldRaw = storage.raw()
    storage.setItem.mockImplementationOnce(() => { throw new Error('Quota exceeded') })
    board.getState().updateProject(id, { plan: 'Unsaved but exportable' })
    expect(storage.raw()).toBe(oldRaw)
    expect(board.getState().storageError).toBeTruthy()
    expect(JSON.parse(board.getState().exportProjects()).projects[0].plan).toBe('Unsaved but exportable')
    board.getState().updateProject(id, { description: 'Retry' })
    expect(board.getState().storageError).toBeNull()
    expect(createProjectBoard(() => storage).getState().projects[0].plan).toBe('Unsaved but exportable')
  })

  it('shows denied-storage access without throwing or losing edits', () => {
    const board = createProjectBoard(() => { throw new Error('Access denied') })
    const id = board.getState().addProject('Offline notes')
    expect(id).toBeTruthy()
    expect(board.getState().storageError).toBeTruthy()
    expect(JSON.parse(board.getState().exportProjects()).projects).toHaveLength(1)
  })

  it('rejects empty/oversize fields and does not allow metadata replacement through patches', () => {
    const storage = memoryStorage()
    const board = createProjectBoard(() => storage)
    expect(board.getState().addProject('   ')).toBeNull()
    expect(board.getState().addProject('x'.repeat(121))).toBeNull()
    const id = board.getState().addProject('Valid')
    expect(board.getState().updateProject(id, { title: '', plan: 'Must not partly apply' })).toBe(false)
    expect(board.getState().updateProject(id, { description: 'x'.repeat(4001) })).toBe(false)
    expect(board.getState().updateProject(id, { plan: 'x'.repeat(20001) })).toBe(false)
    expect(board.getState().updateProject(id, { id: 'other', tasks: [], archived: true })).toBe(false)
    expect(board.getState().projects[0]).toMatchObject({ id, title: 'Valid', plan: '', archived: false })
    expect(board.getState().addTask(id, ' ')).toBeNull()
    expect(board.getState().addTask('missing', 'Task')).toBeNull()
  })

  it('rejects malformed nested and duplicate persisted records without overwriting them', () => {
    const valid = { id: 'p1', title: 'A', description: '', plan: '', archived: false, createdAt: 1, tasks: [] }
    for (const projects of [[valid, valid], [{ ...valid, tasks: [{ id: 't1', title: 'T', done: 'yes' }] }], [{ ...valid, description: null }], [{ ...valid, createdAt: -1 }]]) {
      const storage = memoryStorage(JSON.stringify({ version: 1, selectedId: 'p1', projects }))
      const board = createProjectBoard(() => storage)
      expect(board.getState().storageError).toBeTruthy()
      board.getState().addProject('New')
      expect(storage.setItem).not.toHaveBeenCalled()
    }
  })

  it('bounds project and checklist counts and exports archived content', () => {
    const board = createProjectBoard(() => memoryStorage())
    const id = board.getState().addProject('First')
    for (let i = 1; i < 100; i++) board.getState().addProject(`Project ${i}`)
    expect(board.getState().addProject('Too many')).toBeNull()
    for (let i = 0; i < 200; i++) expect(board.getState().addTask(id, `Task ${i}`)).toBeTruthy()
    expect(board.getState().addTask(id, 'Too many')).toBeNull()
    board.getState().archiveProject(id)
    expect(JSON.parse(board.getState().exportProjects()).projects[0].archived).toBe(true)
  })

  it('isolates project storage from existing office settings', () => {
    const storage = memoryStorage()
    const board = createProjectBoard(() => storage)
    board.getState().addProject('A')
    expect(storage.getItem).toHaveBeenCalledWith(PROJECT_STORAGE_KEY)
    expect(storage.setItem).toHaveBeenCalledWith(PROJECT_STORAGE_KEY, expect.any(String))
  })

  it('keeps IDs unique even if the clock and random source repeat across reloads', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100)
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    try {
      const storage = memoryStorage()
      const first = createProjectBoard(() => storage).getState().addProject('First')
      const reloaded = createProjectBoard(() => storage)
      const second = reloaded.getState().addProject('Second')
      expect(second).not.toBe(first)
      expect(createProjectBoard(() => storage).getState().storageError).toBeNull()
    } finally { clock.mockRestore(); random.mockRestore() }
  })
})
