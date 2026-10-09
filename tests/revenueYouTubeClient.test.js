import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createYouTubeClient, YouTubeProviderError } = require('../scripts/revenue-lab/youtube-client.cjs')

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body }
}

describe('Revenue Lab YouTube client', () => {
  it('uses the fixed JP/ja seven-day request and hydrates video/channel metrics', async () => {
    const calls = []
    const fetchImpl = vi.fn(async input => {
      const url = new URL(input)
      calls.push(url)
      if (url.pathname.endsWith('/search')) return response({ items: [
        { id: { videoId: 'v1' }, snippet: { title: '動画1', channelId: 'c1', channelTitle: '小規模', publishedAt: '2026-10-06T00:00:00Z', thumbnails: { medium: { url: 'https://img.youtube.com/v1.jpg' } } } },
        { id: { videoId: 'v2' }, snippet: { title: '動画2', channelId: 'c2', channelTitle: '非公開', publishedAt: '2026-10-05T00:00:00Z', thumbnails: {} } },
      ] })
      if (url.pathname.endsWith('/videos')) return response({ items: [
        { id: 'v1', snippet: { title: '動画1', channelId: 'c1', channelTitle: '小規模', publishedAt: '2026-10-06T00:00:00Z', thumbnails: { medium: { url: 'https://img.youtube.com/v1.jpg' } } }, statistics: { viewCount: '1200', likeCount: '30', commentCount: '4' } },
        { id: 'v2', snippet: { title: '動画2', channelId: 'c2', channelTitle: '非公開', publishedAt: '2026-10-05T00:00:00Z', thumbnails: {} }, statistics: { viewCount: '80' } },
      ] })
      return response({ items: [
        { id: 'c1', statistics: { subscriberCount: '200', hiddenSubscriberCount: false } },
        { id: 'c2', statistics: { hiddenSubscriberCount: true } },
      ] })
    })
    const client = createYouTubeClient({ apiKey: 'test-key-never-log', fetchImpl })
    const capturedAt = '2026-10-07T12:00:00.000Z'
    const videos = await client.collect({ queryText: 'デスク ガジェット', maxResults: 25, capturedAt })

    expect(calls).toHaveLength(3)
    expect(calls[0].searchParams.get('q')).toBe('デスク ガジェット')
    expect(calls[0].searchParams.get('regionCode')).toBe('JP')
    expect(calls[0].searchParams.get('relevanceLanguage')).toBe('ja')
    expect(calls[0].searchParams.get('maxResults')).toBe('25')
    expect(calls[0].searchParams.get('publishedAfter')).toBe('2026-09-30T12:00:00.000Z')
    expect(videos).toEqual([
      expect.objectContaining({ youtubeVideoId: 'v1', viewCount: 1200, likeCount: 30, commentCount: 4, subscriberCount: 200, capturedAt }),
      expect.objectContaining({ youtubeVideoId: 'v2', viewCount: 80, likeCount: null, commentCount: null, subscriberCount: null, capturedAt }),
    ])
  })

  it('rejects quota-expanding or non-Phase-1 query options before a request', async () => {
    const fetchImpl = vi.fn()
    const client = createYouTubeClient({ apiKey: 'test-key', fetchImpl })
    for (const options of [
      { queryText: '', maxResults: 25 },
      { queryText: 'x', maxResults: 26 },
      { queryText: 'x', maxResults: 0 },
      { queryText: 'x', maxResults: 25, regionCode: 'US' },
      { queryText: 'x', maxResults: 25, relevanceLanguage: 'en' },
      { queryText: 'x', maxResults: 25, lookbackDays: 30 },
    ]) await expect(client.collect({ capturedAt: '2026-10-07T12:00:00Z', ...options })).rejects.toThrow(/invalid|must|Phase 1/i)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns a sealed provider error without leaking the API key or upstream body', async () => {
    const fetchImpl = vi.fn(async () => response({ error: { message: 'body-with-secret test-key' } }, false, 403))
    const client = createYouTubeClient({ apiKey: 'test-key', fetchImpl })
    let caught
    try { await client.collect({ queryText: 'x', maxResults: 1, capturedAt: '2026-10-07T12:00:00Z' }) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(YouTubeProviderError)
    expect(caught.code).toBe('YOUTUBE_HTTP_ERROR')
    expect(caught.message).not.toContain('test-key')
    expect(JSON.stringify(caught)).not.toContain('body-with-secret')
  })

  it('requires a server-side API key at construction', () => {
    expect(() => createYouTubeClient({ apiKey: '' })).toThrow(/YOUTUBE_API_KEY/)
  })

  it('tracks saved IDs in batches without search.list and reports unavailable videos', async () => {
    const calls = []
    const fetchImpl = vi.fn(async input => {
      const url = new URL(input)
      calls.push(url)
      if (url.pathname.endsWith('/videos')) return response({ items: url.searchParams.get('id').split(',')
        .filter(id => id !== 'missing')
        .map(id => ({ id, snippet: { title: id, channelId: `c-${id}`, publishedAt: '2026-10-01T00:00:00Z' }, statistics: { viewCount: '100' } })) })
      return response({ items: [] })
    })
    const client = createYouTubeClient({ apiKey: 'test-key', fetchImpl })
    const ids = Array.from({ length: 50 }, (_, index) => `v${index}`).concat('missing')
    const tracked = await client.track(ids, '2026-10-09T00:00:00Z')
    expect(calls.filter(url => url.pathname.endsWith('/search'))).toHaveLength(0)
    expect(calls.filter(url => url.pathname.endsWith('/videos'))).toHaveLength(2)
    expect(calls.every(url => (url.searchParams.get('id') || '').split(',').length <= 50)).toBe(true)
    expect(tracked.missingVideoIds).toEqual(['missing'])
    expect(tracked.videos).toHaveLength(50)
  })
})
