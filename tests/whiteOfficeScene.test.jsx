import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import WhiteOfficeScene from '../src/components/WhiteOfficeScene'
import PixelOffice from '../src/components/PixelOffice'
import { ROOM_RECTS, MEETING_CHAIRS } from '../src/systems/officeLayout'

describe('white four-room scene', () => {
  it('includes the president and all four rooms in the initial panel viewport', () => {
    const panel = renderToStaticMarkup(<PixelOffice mode="panel" animationQuality="low" />)
    expect(panel).toContain('viewBox="0 0 800 560"')
    expect(panel).toContain('data-agent-id="pm"')
  })
  const markup = renderToStaticMarkup(<svg><WhiteOfficeScene hour={12} weather="clear" reducedMotion /></svg>)
  it('renders exactly the requested four signs and no separate research room', () => {
    for (const name of ['OFFICE', 'PRESIDENT&#x27;S OFFICE', 'MEETING ROOM', 'LOUNGE']) {
      expect(markup.split(`>${name}</text>`)).toHaveLength(2)
    }
    expect(markup).not.toContain('>RESEARCH<')
  })
  it('draws floor bounds and meeting seats from the movement contract', () => {
    for (const r of Object.values(ROOM_RECTS)) {
      expect(markup).toContain(`x="${r.x1}" y="${r.y1}" width="${r.x2-r.x1}" height="${r.y2-r.y1}"`)
    }
    for (const p of MEETING_CHAIRS) {
      expect(markup).toContain(`x="${p.x-10}" y="${p.y-8}" width="20" height="17"`)
    }
  })
})
