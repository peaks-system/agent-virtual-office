import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CorporationDashboard, { receivedStatus } from '../src/components/CorporationDashboard'

describe('corporation dashboard honest status', () => {
  it('excludes expired received statuses without reading animated agent state', () => {
    expect(receivedStatus({ expired: {status:'working',expiresAt:99}, current: {status:'blocked',expiresAt:101}, unknown:null },100))
      .toEqual([['current',{status:'blocked',expiresAt:101}]])
  })
  it('renders empty manual projects and the provided office, without seeded project claims', () => {
    const markup=renderToStaticMarkup(<CorporationDashboard><div data-office="existing">Office controls</div></CorporationDashboard>)
    expect(markup).toContain('AI CORPORATION')
    expect(markup).toContain('STAFF LIST')
    expect(markup).toContain('No projects yet')
    expect(markup).toContain('Waiting for connection')
    expect(markup).toContain('data-office="existing"')
    expect(markup).toContain('Start-Office.cmd')
    expect(markup).not.toContain('corp-project is-selected')
  })
})
