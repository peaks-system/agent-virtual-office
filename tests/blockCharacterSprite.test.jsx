import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CharacterPixelSprite } from '../src/components/BlockCharacterSprite'

const render = (props = {}) => renderToStaticMarkup(<svg><CharacterPixelSprite charId="dev" {...props} /></svg>)

describe('original block character compatibility', () => {
  it('retains session role appearance and provides a fallback for helper IDs', () => {
    expect(render({ charId: 'feature~dev' })).toBe(render({ charId: 'dev' }))
    expect(render({ charId: 'unmapped-helper' })).toBe(render({ charId: 'pm' }))
    expect(render({ charId: 'ops' })).not.toBe(render({ charId: 'dev' }))
  })

  it('alternates the articulated walk and returns to the same idle silhouette', () => {
    expect(render({ isMoving: true, walkFrame: 0 })).not.toBe(render({ isMoving: true, walkFrame: 1 }))
    expect(render({ isMoving: false, walkFrame: 0 })).toBe(render({ isMoving: false, walkFrame: 1 }))
  })

  it('mirrors leftward and hides facial features when facing away', () => {
    expect(render({ facing: 'left' })).toContain('scale(-1 1)')
    expect(render({ facing: 'up' })).not.toContain('data-expression')
    expect(render({ facing: 'down' })).toContain('data-expression="normal"')
  })

  it('renders each existing expression without malformed geometry or external assets', () => {
    for (const expression of ['normal', 'happy', 'sleepy', 'focused', 'surprised', 'tired', 'confused']) {
      const markup = render({ expression })
      expect(markup).toContain(`data-expression="${expression}"`)
      expect(markup).not.toMatch(/NaN|undefined|<image|href=/)
    }
  })
})
