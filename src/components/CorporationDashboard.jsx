import React, { useEffect, useState } from 'react'
import { STAFF, isExecutableStaff, staffRoleId } from '../systems/staffRegistry'
import { useStaffRunState } from '../systems/staffRunState'
import { useOfficeStore } from '../systems/store'
import { useProjectBoard } from '../systems/projectBoard'
import { CharacterPixelSprite } from './BlockCharacterSprite'
import { charName, locale, t, useLocale } from '../i18n'
import { d } from '../locales/dashboard'
import './corporationDashboard.css'
import StaffWorkPanel from './StaffWorkPanel'
import SeoPanel from './SeoPanel'

export function receivedStatus(externalStatus, now) {
  return Object.entries(externalStatus).filter(([,value]) => value && (!value.expiresAt || value.expiresAt > now))
}

export function executableReceivedStatus(externalStatus, now) {
  return receivedStatus(externalStatus, now).filter(([id]) => isExecutableStaff(id))
}

// A staff row summarizes its concurrent sessions. Keep attention and active work
// visible even when another session for the same role is idle or completed.
export function rosterStatusByRole(entries) {
  const priority = { blocked: 6, 'awaiting-approval': 5, working: 4, planning: 3, done: 2, idle: 1 }
  return entries.reduce((roles, [id, status]) => {
    const role = staffRoleId(id)
    if (!roles[role] || (priority[status.status] || 0) > (priority[roles[role].status] || 0)) roles[role] = status
    return roles
  }, {})
}

function ProjectEditor({ project, board }) {
  const [title, setTitle] = useState(project.title)
  const [description, setDescription] = useState(project.description)
  const [plan, setPlan] = useState(project.plan)
  const [task, setTask] = useState('')
  const [saved, setSaved] = useState(false)
  const [editError, setEditError] = useState('')
  return <>
    <form className="corp-editor" onChange={() => setSaved(false)} onSubmit={event => {
      event.preventDefault()
      const ok = board.updateProject(project.id, { title: title.trim(), description, plan })
      setEditError(ok === false ? d('limitError') : '')
      setSaved(ok !== false && !useProjectBoard.getState().storageError)
    }}>
      <label>{d('title')}<input value={title} required maxLength={120} onChange={e => setTitle(e.target.value)} /></label>
      <label>{d('description')}<textarea rows={2} value={description} maxLength={4000} onChange={e => setDescription(e.target.value)} /></label>
      <label>{d('plan')}<textarea rows={5} value={plan} maxLength={12000} onChange={e => setPlan(e.target.value)} /></label>
      <p className="corp-muted">{d('note')}</p>
      {editError && <p role="alert">{editError}</p>}
      <div className="corp-action-row"><button className="corp-primary" type="submit" disabled={!title.trim()}>{d('save')}</button><span role="status">{saved ? d('saved') : ''}</span></div>
    </form>
    <div className="corp-section-title"><h3>{d('tasks')}</h3><span>{project.tasks.filter(task => task.done).length} / {project.tasks.length}</span></div>
    <ul className="corp-tasks">{project.tasks.map(task => <li key={task.id}>
      <label><input type="checkbox" checked={task.done} onChange={() => board.toggleTask(project.id, task.id)} /><span className={task.done ? 'corp-done' : ''}>{task.title}</span></label>
      <button className="corp-icon-button" aria-label={`${d('remove')}: ${task.title}`} onClick={() => board.removeTask(project.id, task.id)}>×</button>
    </li>)}</ul>
    <form className="corp-add-task" onSubmit={event => { event.preventDefault(); if (task.trim()) { const id = board.addTask(project.id, task.trim()); if(id) { setTask(''); setEditError('') } else setEditError(d('limitError')) } }}>
      <input aria-label={d('taskTitle')} placeholder={d('taskTitle')} value={task} maxLength={120} onChange={e => setTask(e.target.value)} />
      <button type="submit" disabled={!task.trim()}>{d('add')}</button>
    </form>
    <button className="corp-text-button" onClick={() => board.archiveProject(project.id)}>{d('archive')}</button>
  </>
}

export default function CorporationDashboard({ children }) {
  useLocale()
  const board = useProjectBoard()
  const externalStatus = useOfficeStore(s => s.externalStatus)
  const staff = STAFF
  const runStatuses = useStaffRunState(s => s.statuses)
  const selectedAgent = useOfficeStore(s => s.selectedAgent)
  const [now, setNow] = useState(Date.now())
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [exportError, setExportError] = useState('')
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const actual = executableReceivedStatus({ ...externalStatus, ...runStatuses }, now)
  const live = rosterStatusByRole(actual)
  const active = board.projects.filter(project => !project.archived)
  const archived = board.projects.filter(project => project.archived)
  const selected = active.find(project => project.id === board.selectedId)
  function exportBackup() {
    try {
      const url = URL.createObjectURL(new Blob([board.exportProjects()], { type: 'application/json' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'ai-corporation-projects.json'; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000); setExportError('')
    } catch { setExportError(d('backupError')) }
  }
  return <div className="corp-dashboard">
    <header className="corp-header">
      <div className="corp-brand"><span className="corp-monogram" aria-hidden="true">AI</span><div><h1>AI CORPORATION</h1><p>{d('subtitle')}</p></div></div>
      <div className="corp-metrics">
        <div><strong>{actual.filter(([,s]) => s.status === 'working').length}</strong><span>{d('working')}</span></div>
        <div><strong>{actual.filter(([,s]) => ['blocked','awaiting-approval'].includes(s.status)).length}</strong><span>{d('attention')}</span></div>
        <div><strong>{active.length}</strong><span>{d('projects')}</span></div>
      </div>
      <div className="corp-clock"><time aria-label={d('date')}>{new Date(now).toLocaleTimeString(locale(), {hour:'2-digit',minute:'2-digit'})}</time><span>{actual.length ? d('online') : d('waiting')}</span></div>
    </header>
    {(board.storageError || exportError) && <div className="corp-error" role="alert">{board.storageError || exportError}</div>}
    <div className="corp-layout">
      <aside className="corp-left corp-card">
        <div className="corp-section-title"><h2>{d('projects')}</h2><button onClick={() => setAdding(!adding)} aria-expanded={adding}>{adding ? d('cancel') : `＋ ${d('add')}`}</button></div>
        {adding && <form className="corp-project-form" onSubmit={event => { event.preventDefault(); if(newTitle.trim()) { const id = board.addProject(newTitle.trim()); if(id) { setNewTitle(''); setAdding(false); setExportError('') } else setExportError(d('limitError')) } }}>
          <label>{d('title')}<input autoFocus required value={newTitle} maxLength={120} onChange={e => setNewTitle(e.target.value)} /></label><button className="corp-primary" type="submit">{d('addProject')}</button>
        </form>}
        <p className="corp-eyebrow">{d('manual')}</p>
        {!active.length && <div className="corp-empty"><h3>{d('empty')}</h3><p>{d('emptyHelp')}</p><button onClick={() => setAdding(true)}>{d('addProject')}</button></div>}
        <div className="corp-projects">{active.map(project => {
          const done = project.tasks.filter(task => task.done).length
          return <button key={project.id} className={`corp-project ${selected?.id === project.id ? 'is-selected' : ''}`} aria-pressed={selected?.id === project.id} onClick={() => board.selectProject(project.id)}>
            <span className="corp-project-title">{project.title}</span><span>{done} / {project.tasks.length} {d('tasks')}</span><progress value={done} max={project.tasks.length || 1} aria-label={`${project.title}: ${d('tasks')}`} />
          </button>
        })}</div>
        {!!archived.length && <details className="corp-archived"><summary>{d('archived')} ({archived.length})</summary>{archived.map(project => <div key={project.id}><span>{project.title}</span><button onClick={() => board.restoreProject(project.id)}>{d('restore')}</button></div>)}</details>}
        <button className="corp-text-button" onClick={exportBackup}>{d('backup')}</button>
        <details className="corp-archived"><summary>{d('help')}</summary><p>{d('startHelp')}</p><p>{d('stopHelp')}</p></details>
        <div className="corp-section-title corp-staff-heading"><h2>STAFF LIST</h2><span>{staff.length}</span></div>
        <p className="corp-eyebrow">{d('staff')}</p>
        <div className="corp-staff">{staff.map(profile => {
          const id = profile.id
          const state = live[id]
          return <button key={id} disabled={!profile.executionEnabled} className={selectedAgent === id ? 'is-selected' : ''} onClick={() => useOfficeStore.getState().setSelectedAgent(id)} aria-pressed={selectedAgent === id}>
            <svg viewBox="-21 -47 44 52" aria-hidden="true"><CharacterPixelSprite charId={id === 'president' ? 'pm' : id} /></svg>
            <span><strong>{charName(id)}</strong><small><i className={state ? `corp-status ${state.status}` : 'corp-status'} />{!profile.executionEnabled ? d('displayOnly') : state ? t(`statusLabels.${state.status}`, state.status) : d('waiting')}</small></span>
          </button>
        })}</div>
      </aside>
      <main className="corp-office corp-card" aria-label={d('office')}>{children}</main>
      <aside className="corp-right corp-card">
        <p className="corp-eyebrow">{d('manual')}</p><h2>{d('overview')}</h2>
        {selected ? <ProjectEditor key={selected.id} project={selected} board={board} /> : <div className="corp-empty"><p>{d('emptyHelp')}</p><button onClick={() => setAdding(true)}>{d('addProject')}</button></div>}
        {selected && <SeoPanel key={`seo-${selected.id}`} project={selected} />}
        <StaffWorkPanel project={selected} />
        <section className="corp-real-work"><h2>{d('realWork')}</h2><p className="corp-eyebrow">{d('online')}</p>
          {!actual.length ? <p className="corp-muted">{d('noWork')}</p> : actual.map(([id,status]) => <article key={id}><strong>{charName(id)}</strong><span>{t(`statusLabels.${status.status}`, status.status)}</span><p>{status.task || status.label || d('noTask')}</p></article>)}
        </section>
      </aside>
    </div>
  </div>
}
