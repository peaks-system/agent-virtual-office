import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { METRICS, REQUIRED_SCOPES, createYouTubeAnalyticsClient, pkceChallenge } = require('../scripts/revenue-lab/youtube-analytics-client.cjs')

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('YouTube Analytics Google client', () => {
  it('builds a minimal offline Desktop OAuth URL with state and S256 PKCE', () => {
    const client = createYouTubeAnalyticsClient({ clientId: 'desktop-id', clientSecret: 'secret', fetchImpl: vi.fn() })
    const url = new URL(client.authorizationUrl({ redirectUri: 'http://127.0.0.1:4567/oauth2/callback', state: 'state-1', codeChallenge: pkceChallenge('verifier') }))
    expect(url.origin).toBe('https://accounts.google.com')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4567/oauth2/callback')
    expect(url.searchParams.get('state')).toBe('state-1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope').split(' ')).toEqual(REQUIRED_SCOPES)
    expect(url.toString()).not.toContain('secret')
  })

  it('verifies the owned channel and preserves missing Analytics values as null', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ items: [{ id: 'UC1234567890123456789012', snippet: { title: 'Owner Channel' } }] }))
      .mockResolvedValueOnce(response({ items: [{ id: 'video123', snippet: { channelId: 'UC1234567890123456789012' }, status: { privacyStatus: 'public' } }] }))
      .mockResolvedValueOnce(response({ columnHeaders: METRICS.map(name => ({ name })), rows: [[100, 50, 30, 25, 2, 1, 10, null, 3]] }))
      .mockResolvedValueOnce(response({ columnHeaders: [{ name: 'day' }, { name: 'views' }], rows: [['2026-10-08', 40], ['2026-10-09', 60]] }))
    const client = createYouTubeAnalyticsClient({ clientId: 'id', clientSecret: 'secret', fetchImpl })
    expect(await client.ownedChannel('access')).toEqual({ channelId: 'UC1234567890123456789012', channelTitle: 'Owner Channel' })
    expect(await client.video('access', 'video123')).toMatchObject({ channelId: 'UC1234567890123456789012' })
    const result = await client.performance('access', { videoId: 'video123', startDate: '2026-10-08', endDate: '2026-10-09' })
    expect(result).toMatchObject({ noData: false, dataThroughDate: '2026-10-09', metrics: { views: 100, comments: null, shares: 3 } })
  })

  it('normalizes a revoked refresh token without leaking the provider body', async () => {
    const client = createYouTubeAnalyticsClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: vi.fn(async () => response({ error: 'invalid_grant', error_description: 'sensitive text' }, 400)) })
    await expect(client.refreshAccessToken('refresh-secret')).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REVOKED', reauthRequired: true, message: 'Google API request was rejected' })
  })

  it('normalizes code or PKCE rejection, unavailable video, and rate limits', async () => {
    const exchangeClient = createYouTubeAnalyticsClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: vi.fn(async () => response({ error: 'invalid_grant' }, 400)) })
    await expect(exchangeClient.exchangeCode({ code: 'bad', codeVerifier: 'wrong', redirectUri: 'http://127.0.0.1:1/oauth2/callback' })).rejects.toMatchObject({ code: 'OAUTH_CODE_OR_PKCE_INVALID' })
    const videoClient = createYouTubeAnalyticsClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: vi.fn(async () => response({ items: [] })) })
    await expect(videoClient.video('access', 'missing')).rejects.toMatchObject({ code: 'VIDEO_NOT_FOUND_OR_DENIED' })
    const rateClient = createYouTubeAnalyticsClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: vi.fn(async () => response({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429)) })
    await expect(rateClient.ownedChannel('access')).rejects.toMatchObject({ code: 'GOOGLE_RATE_LIMIT' })
  })
})
