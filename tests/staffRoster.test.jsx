import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STAFF, isExecutableStaff, staffDisplayName } from '../src/systems/staffRegistry'
import { HOME_POSITIONS, PRESIDENT_POSITION, canRestoreLayoutPosition } from '../src/systems/officeLayout'
import CorporationDashboard, { executableReceivedStatus, rosterStatusByRole } from '../src/components/CorporationDashboard'
import WhiteOfficeScene from '../src/components/WhiteOfficeScene'
import { useOfficeStore } from '../src/systems/store'

describe('canonical staff roster and static president', () => {
  it('has eight eligible workers and one display-only president', () => {
    expect(STAFF).toHaveLength(9)
    expect(STAFF.filter(staff => isExecutableStaff(staff.id))).toHaveLength(8)
    expect(isExecutableStaff('president')).toBe(false)
    expect(isExecutableStaff('unrecognized')).toBe(false)
    expect(staffDisplayName('gate')).toBe('コピーライター')
    expect(useOfficeStore.getState().agents).not.toHaveProperty('president')
  })
  it('excludes president and unknown statuses from live worker counts', () => {
    const statuses = { president: { status: 'working' }, unknown: { status: 'working' }, pm: { status: 'working' } }
    expect(executableReceivedStatus(statuses, Date.now()).map(([id]) => id)).toEqual(['pm'])
  })
  it('shows session work on its canonical staff row without changing count entries', () => {
    const entries = executableReceivedStatus({ dev: {status:'idle'}, 'session~dev': {status:'working',task:'Build page'} }, Date.now())
    const roster = rosterStatusByRole(entries)
    expect(entries).toHaveLength(2)
    expect(staffDisplayName('dev')).toBe('Webエンジニア')
    expect(roster.dev).toEqual({status:'working',task:'Build page'})
    expect(rosterStatusByRole([...entries].reverse()).dev.status).toBe('working')
    expect(rosterStatusByRole([...entries,['other~dev',{status:'blocked'}]]).dev.status).toBe('blocked')
  })
  it('shows the president as disabled in roster and static in the president room', () => {
    const dashboard = renderToStaticMarkup(<CorporationDashboard />)
    expect(dashboard).toContain('Display only')
    expect(dashboard).toContain('disabled=""')
    for (const staff of STAFF) expect(dashboard).toContain(staff.displayName)
    const office = renderToStaticMarkup(<svg><WhiteOfficeScene hour={12} reducedMotion /></svg>)
    expect(office).toContain('data-staff-id="president"')
    expect(office).toContain(`translate(${PRESIDENT_POSITION.x},${PRESIDENT_POSITION.y})`)
    expect(HOME_POSITIONS.pm).toEqual({x:350,y:90})
  })
  it('migrates only the relocated PM while preserving unrelated version-2 positions', () => {
    expect(canRestoreLayoutPosition(2,'pm')).toBe(false)
    expect(canRestoreLayoutPosition(2,'dev')).toBe(true)
    expect(canRestoreLayoutPosition(2,'dev',{x:370,y:80})).toBe(false)
    expect(canRestoreLayoutPosition(2,'dev',{x:260,y:195})).toBe(true)
    expect(canRestoreLayoutPosition(3,'pm')).toBe(true)
    expect(canRestoreLayoutPosition(1,'dev')).toBe(false)
  })
})
