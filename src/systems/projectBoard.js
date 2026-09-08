import { create } from 'zustand'

export const PROJECT_STORAGE_KEY = 'office-project-board-v1'
const VERSION = 1
const LIMITS = { projects: 100, tasks: 200, title: 120, description: 4000, plan: 20000, raw: 3000000 }
const READ_ERROR = '保存済みのプロジェクトを読み込めません。元のデータを保護するため、変更はこの画面だけに保持します。必要な内容をエクスポートしてください。'
const WRITE_ERROR = 'プロジェクトを保存できません。変更はこの画面に保持されています。画面を閉じる前にエクスポートしてください。'
const textWithin = (value, max) => typeof value === 'string' && value.length <= max
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)

function parseSnapshot(raw) {
  if (raw.length > LIMITS.raw) throw new Error('Project storage exceeds limit')
  const value = JSON.parse(raw)
  if (!value || value.version !== VERSION || !Array.isArray(value.projects) || value.projects.length > LIMITS.projects) throw new Error('Invalid project storage')
  const ids = new Set()
  const projects = value.projects.map(p => {
    if (!p || !validId(p.id) || ids.has(p.id) || !textWithin(p.title, LIMITS.title) || !p.title.trim()
      || !textWithin(p.description, LIMITS.description) || !textWithin(p.plan, LIMITS.plan)
      || typeof p.archived !== 'boolean' || !Number.isSafeInteger(p.createdAt) || p.createdAt < 0
      || !Array.isArray(p.tasks) || p.tasks.length > LIMITS.tasks) throw new Error('Invalid project')
    ids.add(p.id)
    const taskIds = new Set()
    const tasks = p.tasks.map(t => {
      if (!t || !validId(t.id) || taskIds.has(t.id) || !textWithin(t.title, LIMITS.title) || !t.title.trim() || typeof t.done !== 'boolean') throw new Error('Invalid task')
      taskIds.add(t.id)
      return { id: t.id, title: t.title, done: t.done }
    })
    return { id: p.id, title: p.title, description: p.description, plan: p.plan, tasks, archived: p.archived, createdAt: p.createdAt }
  })
  const selectedId = projects.some(p => p.id === value.selectedId && !p.archived)
    ? value.selectedId : projects.find(p => !p.archived)?.id || null
  return { projects, selectedId }
}

// Factory keeps storage failure and reload tests independent of the application's store.
export function createProjectBoard(storageProvider = () => typeof window === 'undefined' ? null : window.localStorage) {
  let storage = null
  let blocked = false
  let initial = { projects: [], selectedId: null, storageError: null }
  try {
    storage = storageProvider()
    const raw = storage?.getItem(PROJECT_STORAGE_KEY)
    if (raw != null) initial = { ...initial, ...parseSnapshot(raw) }
  } catch {
    blocked = true
    initial.storageError = READ_ERROR
  }
  let sequence = 0
  const makeId = existing => {
    let id
    do { id = `p_${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2, 10)}` }
    while (existing.some(item => item.id === id))
    return id
  }
  const snapshot = state => JSON.stringify({ version: VERSION, projects: state.projects, selectedId: state.selectedId })

  return create((set, get) => {
    const commit = patch => {
      const next = { ...get(), ...patch }
      let storageError = blocked ? READ_ERROR : null
      if (!blocked && storage) {
        try {
          const raw = snapshot(next)
          if (raw.length > LIMITS.raw) throw new Error('Project storage exceeds limit')
          storage.setItem(PROJECT_STORAGE_KEY, raw)
        } catch { storageError = WRITE_ERROR }
      }
      set({ ...patch, storageError })
    }
    const replace = (id, transform) => {
      const state = get()
      const project = state.projects.find(p => p.id === id)
      if (!project) return false
      const next = transform(project)
      if (next === project) return false
      commit({ projects: state.projects.map(p => p.id === id ? next : p) })
      return true
    }
    return {
      ...initial,
      addProject(title) {
        if (!textWithin(title, LIMITS.title) || !title.trim() || get().projects.length >= LIMITS.projects) return null
        const id = makeId(get().projects)
        const project = { id, title: title.trim(), description: '', plan: '', tasks: [], archived: false, createdAt: Date.now() }
        commit({ projects: [...get().projects, project], selectedId: id })
        return id
      },
      selectProject(id) {
        if (get().projects.some(p => p.id === id && !p.archived)) commit({ selectedId: id })
      },
      updateProject(id, patch) {
        if (!patch || typeof patch !== 'object') return false
        const fields = {}
        for (const key of ['title', 'description', 'plan']) {
          if (!Object.hasOwn(patch, key)) continue
          if (!textWithin(patch[key], LIMITS[key]) || (key === 'title' && !patch[key].trim())) return false
          fields[key] = key === 'title' ? patch[key].trim() : patch[key]
        }
        return Object.keys(fields).length > 0 && replace(id, p => ({ ...p, ...fields }))
      },
      archiveProject(id) {
        const state = get()
        if (!state.projects.some(p => p.id === id && !p.archived)) return
        commit({ projects: state.projects.map(p => p.id === id ? { ...p, archived: true } : p),
          selectedId: state.selectedId === id ? state.projects.find(p => p.id !== id && !p.archived)?.id || null : state.selectedId })
      },
      restoreProject(id) { replace(id, p => ({ ...p, archived: false })) },
      addTask(projectId, title) {
        if (!textWithin(title, LIMITS.title) || !title.trim()) return null
        const p = get().projects.find(p => p.id === projectId)
        if (!p || p.tasks.length >= LIMITS.tasks) return null
        const id = makeId(p.tasks)
        replace(projectId, p => ({ ...p, tasks: [...p.tasks, { id, title: title.trim(), done: false }] }))
        return id
      },
      toggleTask(projectId, taskId) {
        return replace(projectId, p => p.tasks.some(t => t.id === taskId)
          ? { ...p, tasks: p.tasks.map(t => t.id === taskId ? { ...t, done: !t.done } : t) } : p)
      },
      removeTask(projectId, taskId) {
        return replace(projectId, p => p.tasks.some(t => t.id === taskId)
          ? { ...p, tasks: p.tasks.filter(t => t.id !== taskId) } : p)
      },
      exportProjects() { return snapshot(get()) },
    }
  })
}

export const useProjectBoard = createProjectBoard()
