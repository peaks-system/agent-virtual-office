// spec_ref: docs/specs/japanese-localization.md (AC-1, AC-2, AC-4, AC-5)
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import en from '../src/locales/en.json'
import ja from '../src/locales/ja.json'
import staffConfig from '../config/staff.json'

function compareTree(base, translated, path = '') {
  expect(typeof translated, path).toBe(typeof base)
  if (typeof base === 'string') {
    expect(translated.trim().length, path).toBeGreaterThan(0)
    expect(translated.match(/\{[^}]+\}/g) || [], path).toEqual(base.match(/\{[^}]+\}/g) || [])
  } else if (Array.isArray(base)) {
    expect(Array.isArray(translated), path).toBe(true)
    expect(translated.length, path).toBe(base.length)
    base.forEach((value, index) => compareTree(value, translated[index], `${path}[${index}]`))
  } else {
    expect(Object.keys(translated).sort(), path).toEqual(Object.keys(base).sort())
    for (const key of Object.keys(base)) compareTree(base[key], translated[key], `${path}.${key}`)
  }
}

async function loadLocale({ search = '', saved = null, language = 'en-US' } = {}) {
  vi.resetModules()
  vi.stubGlobal('window', { location: { search } })
  vi.stubGlobal('navigator', { language })
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => saved), setItem: vi.fn() })
  vi.stubGlobal('document', { documentElement: { lang: '' } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  return import('../src/i18n.js')
}

afterEach(() => vi.unstubAllGlobals())

describe('Japanese localization', () => {
  it('covers the full English dictionary with matching shapes and placeholders', () => {
    compareTree(en, ja)
    expect(ja.dailyCard.filename).toBe(en.dailyCard.filename)
  })

  it.each(['ja', 'ja-JP'])('detects browser language %s', async language => {
    const i18n = await loadLocale({ language })
    expect(i18n.locale()).toBe('ja')
    expect(i18n.t('settings.language')).toBe('言語')
  })

  it('keeps query > saved preference > browser precedence', async () => {
    expect((await loadLocale({ search: '?lang=ja', saved: 'en' })).locale()).toBe('ja')
    expect((await loadLocale({ search: '?lang=en', saved: 'ja', language: 'ja-JP' })).locale()).toBe('en')
    expect((await loadLocale({ saved: 'ja', language: 'en-US' })).locale()).toBe('ja')
    expect((await loadLocale({ saved: 'en', language: 'ja-JP' })).locale()).toBe('en')
  })

  it('ignores unsupported preferences and preserves existing locale fallback', async () => {
    expect((await loadLocale({ search: '?lang=xx', saved: 'xx', language: 'ja-JP' })).locale()).toBe('ja')
    expect((await loadLocale({ language: 'zh-Hant-TW' })).locale()).toBe('zh-TW')
    expect((await loadLocale({ language: 'fr-FR' })).locale()).toBe('en')
  })

  it('switches, notifies listeners, persists ja, and rejects unknown languages', async () => {
    const i18n = await loadLocale()
    const listener = vi.fn()
    const unsubscribe = i18n.onLocaleChange(listener)
    i18n.setLocale('ja')
    expect(i18n.availableLocales()).toEqual(['en', 'zh-TW', 'ja'])
    expect(document.documentElement.lang).toBe('ja')
    expect(document.title).toBe(ja.ui.documentTitle)
    expect(localStorage.setItem).toHaveBeenCalledWith('office-lang', 'ja')
    expect(fetch).toHaveBeenCalledWith('/api/lang', expect.objectContaining({ method: 'POST', body: 'ja' }))
    expect(listener).toHaveBeenCalledWith('ja')
    expect(i18n.behaviorLabel('typing')).toBe(ja.behaviorLabels.typing)
    expect(i18n.charName('session~dev')).toBe(staffConfig.staff.find(staff => staff.id === 'dev').displayName)
    expect(i18n.t('missing.key', 'fallback')).toBe('fallback')
    i18n.setLocale('unknown')
    expect(i18n.locale()).toBe('ja')
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('renders furniture signs from the active locale', async () => {
    await loadLocale({ search: '?lang=ja' })
    const { CoffeeMachine, GateBooth } = await import('../src/components/TopDownFurniture.jsx')
    const html = renderToStaticMarkup(<svg><CoffeeMachine x={0} y={0} /><GateBooth x={0} y={0} /></svg>)
    expect(html).toContain(ja.office.cafe)
    expect(html).toContain(ja.office.gate)
    expect(html).not.toMatch(/>CAFE<|>GATE</)
  })

  it('builds Japanese daily cards including empty, completed and blocked days', async () => {
    const { buildCardModel } = await import('../src/systems/dailyCard.js')
    const empty = buildCardModel({ locale: 'ja' })
    expect(empty.caption).toBe(ja.dailyCard.caption.empty)
    const card = buildCardModel({ locale: 'ja', doneTotal: 4, blockedTotal: 3, mood: 'smooth', weather: 'clear' })
    expect(card.caption).toBe(ja.dailyCard.caption.smooth.replace('{done}', '4'))
    expect(card.blockedTail).toBe(ja.dailyCard.blocked.snagsMany)
    expect(card.moodWord).toBe(ja.dailyCard.moodWord.clear)
    expect(card.numericTokenCount).toBe(1)
  })

  it('localizes compact durations including zero, minute and hour boundaries', async () => {
    await loadLocale({ search: '?lang=ja' })
    const { formatTimeAgo } = await import('../src/utils/formatTime.js')
    const now = Date.now()
    expect(formatTimeAgo(null, { compact: true })).toBe('0秒')
    expect(formatTimeAgo(now + 60000, { compact: true })).toBe('0秒')
    expect(formatTimeAgo(now - 30000, { compact: true })).toBe('30秒')
    expect(formatTimeAgo(now - 60000, { compact: true })).toBe('1分')
    expect(formatTimeAgo(now - 3600000, { compact: true })).toBe('1時間')
  })
})
