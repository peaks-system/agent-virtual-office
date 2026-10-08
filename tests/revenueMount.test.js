import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Revenue Lab isolation mounts', () => {
  const production = readFileSync('server.mjs', 'utf8')
  const development = readFileSync('vite.config.mjs', 'utf8')
  const dashboard = readFileSync('src/components/CorporationDashboard.jsx', 'utf8')

  it('mounts only below the dedicated API namespace in both servers', () => {
    expect(production).toContain("startsWith('/api/revenue/')")
    expect(development).toContain("use('/api/revenue', revenueApi.handler)")
  })

  it('starts and closes the independently replaceable worker runtime', () => {
    for (const source of [production, development]) {
      expect(source).toContain('createRevenueRuntime()')
      expect(source).toContain('revenueRuntime.start()')
      expect(source).toContain('revenueRuntime.close()')
    }
  })

  it('keeps Revenue Lab behind an explicit department switch', () => {
    expect(dashboard).toContain("department === 'revenue'")
    expect(dashboard).toContain('<RevenueLabDashboard />')
    expect(dashboard).toContain('WordPressPanel')
    expect(dashboard).toContain('SeoPanel')
  })
})
