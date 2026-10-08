import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { RevenueLabView, queryNeedsScores, scoreLabel } from '../src/components/RevenueLabDashboard'

const handlers = { onReload: vi.fn(), onRun: vi.fn(), onSave: vi.fn() }

describe('Revenue Lab dashboard', () => {
  it('formats saved scores and detects incomplete human inputs', () => {
    expect(scoreLabel(72.5)).toBe('72.50')
    expect(queryNeedsScores({ buyerIntent: null, commerceFit: 80 })).toBe(true)
    expect(queryNeedsScores({ buyerIntent: 0, commerceFit: 100 })).toBe(false)
  })

  it('renders loading and server-only configuration states', () => {
    expect(renderToStaticMarkup(<RevenueLabView state={null} {...handlers} />)).toContain('読み込んでいます')
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: false, missing: ['YOUTUBE_API_KEY'] }, queries: [], opportunities: [], latestJob: null }} {...handlers} />)
    expect(markup).toContain('接続設定が必要です')
    expect(markup).toContain('YOUTUBE_API_KEY')
  })

  it('renders deterministic TOP3 order supplied by the backend', () => {
    const opportunities = [
      { id: 'a', youtubeVideoId: 'a', title: 'First', opportunityScore: 90.12, breakoutScore: 88.1, velocityMode: 'observed_delta', percentilePopulationSize: 25 },
      { id: 'b', youtubeVideoId: 'b', title: 'Second', opportunityScore: 80, breakoutScore: 78, velocityMode: 'estimated_lifetime', percentilePopulationSize: 25 },
      { id: 'c', youtubeVideoId: 'c', title: 'Third', opportunityScore: 70, breakoutScore: 68, velocityMode: 'observed_delta', percentilePopulationSize: 25 },
    ]
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: true, missing: [] }, queries: [], opportunities, latestJob: null }} {...handlers} />)
    expect(markup).toContain('#1')
    expect(markup).toContain('90.12')
    expect(markup.indexOf('First')).toBeLessThan(markup.indexOf('Second'))
    expect(markup.indexOf('Second')).toBeLessThan(markup.indexOf('Third'))
  })

  it('shows incomplete query settings and disables manual run', () => {
    const query = { id: 'q', label: 'Theme', queryText: 'query', buyerIntent: null, commerceFit: null, enabled: true }
    const markup = renderToStaticMarkup(<RevenueLabView state={{ config: { configured: true, missing: [] }, queries: [query], opportunities: [], latestJob: null }} {...handlers} />)
    expect(markup).toContain('ランキング対象外')
    expect(markup).toMatch(/disabled=""[^>]*>今すぐ収集/)
  })
})
