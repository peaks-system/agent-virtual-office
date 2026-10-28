import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { YouTubeAnalyticsError } = require('../scripts/revenue-lab/youtube-analytics-client.cjs')
const { createYouTubeAnalyticsService } = require('../scripts/revenue-lab/youtube-analytics-service.cjs')
const services = []

afterEach(() => { for (const service of services.splice(0)) service.close() })

function oauthFixture() {
  let authorization
  const store = {
    getDefaultProject: vi.fn(async () => ({ id: 'project-1' })),
    getYouTubeAnalyticsConnection: vi.fn(async () => null),
    upsertYouTubeAnalyticsConnection: vi.fn(async () => ({ id: 'connection-1' })),
  }
  const credentialStore = {
    createReference: vi.fn(() => 'local-dpapi:11111111-1111-4111-8111-111111111111'),
    save: vi.fn(async () => {}), delete: vi.fn(async () => true),
  }
  const client = {
    authorizationUrl: vi.fn(input => { authorization = input; return 'https://accounts.google.test/authorize' }),
    exchangeCode: vi.fn(async () => ({ access_token: 'access-secret', refresh_token: 'refresh-secret', scope: 'https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly' })),
    ownedChannel: vi.fn(async () => ({ channelId: 'UC1234567890123456789012', channelTitle: 'Owner' })),
  }
  const service = createYouTubeAnalyticsService({ store, credentialStore, client, openBrowser: vi.fn(async () => {}) })
  services.push(service)
  return { get authorization() { return authorization }, client, credentialStore, service, store }
}

describe('YouTube Analytics OAuth and collection service', () => {
  it('accepts one state-matched callback, stores only the refresh credential, and exposes safe status', async () => {
    const fixture = oauthFixture()
    expect(await fixture.service.startAuthorization()).toMatchObject({ status: 'authorizing', errorCode: null })
    const response = await fetch(`${fixture.authorization.redirectUri}?state=${encodeURIComponent(fixture.authorization.state)}&code=code-1`)
    expect(response.status).toBe(200)
    expect(fixture.client.exchangeCode).toHaveBeenCalledWith(expect.objectContaining({ code: 'code-1', codeVerifier: expect.any(String) }))
    expect(fixture.credentialStore.save).toHaveBeenCalledWith(expect.stringMatching(/^local-dpapi:/), { refreshToken: 'refresh-secret', scopes: expect.any(Array) })
    expect(fixture.store.upsertYouTubeAnalyticsConnection).toHaveBeenCalledWith('project-1', expect.objectContaining({ channelTitle: 'Owner' }))
    expect(await fixture.service.connectionStatus()).toMatchObject({ flow: { status: 'succeeded' } })
    expect(JSON.stringify(await fixture.service.connectionStatus())).not.toContain('refresh-secret')
  })

  it('rejects a state mismatch before code exchange', async () => {
    const fixture = oauthFixture()
    await fixture.service.startAuthorization()
    const response = await fetch(`${fixture.authorization.redirectUri}?state=wrong&code=code-1`)
    expect(response.status).toBe(400)
    expect(fixture.client.exchangeCode).not.toHaveBeenCalled()
    expect(await fixture.service.connectionStatus()).toMatchObject({ flow: { status: 'failed', errorCode: 'OAUTH_STATE_MISMATCH' } })
  })

  it('records operator OAuth rejection without exchanging a code', async () => {
    const fixture = oauthFixture()
    await fixture.service.startAuthorization()
    const response = await fetch(`${fixture.authorization.redirectUri}?state=${encodeURIComponent(fixture.authorization.state)}&error=access_denied`)
    expect(response.status).toBe(400)
    expect(fixture.client.exchangeCode).not.toHaveBeenCalled()
    expect(await fixture.service.connectionStatus()).toMatchObject({ flow: { status: 'failed', errorCode: 'OAUTH_REJECTED' } })
  })

  it('persists nullable metrics and rejects a publication from another channel', async () => {
    const baseStore = {
      getYouTubeAnalyticsConnection: vi.fn(async () => ({ id: 'connection-1', connectionStatus: 'connected' })),
      startYouTubeAnalyticsRun: vi.fn(async () => ({ runId: 'run-1', credentialRef: 'local-dpapi:11111111-1111-4111-8111-111111111111', youtubeVideoId: 'video123', channelId: 'UC-owner' })),
      finishYouTubeAnalyticsRun: vi.fn(async (_id, snapshot, noData) => ({ ...snapshot, status: noData ? 'no_data' : 'succeeded' })),
      failYouTubeAnalyticsRun: vi.fn(async () => {}),
    }
    const credentialStore = { load: vi.fn(async () => ({ refreshToken: 'refresh' })) }
    const client = {
      refreshAccessToken: vi.fn(async () => ({ access_token: 'access' })),
      video: vi.fn(async () => ({ channelId: 'UC-owner' })),
      performance: vi.fn(async () => ({ noData: true, dataThroughDate: null, metrics: Object.fromEntries(['views','estimatedMinutesWatched','averageViewDuration','averageViewPercentage','subscribersGained','subscribersLost','likes','comments','shares'].map(key => [key, null])), rawMetrics: { summary: { rows: [] }, coverage: { rows: [] } } })),
    }
    const service = createYouTubeAnalyticsService({ store: baseStore, credentialStore, client })
    services.push(service)
    expect(await service.collect('publication-1', { startDate: '2026-10-01', endDate: '2026-10-09' })).toMatchObject({ status: 'no_data', views: null })
    expect(baseStore.finishYouTubeAnalyticsRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ views: null, data_through_date: null }), true)
    client.video.mockResolvedValueOnce({ channelId: 'UC-other' })
    await expect(service.collect('publication-1', { startDate: '2026-10-01', endDate: '2026-10-09' })).rejects.toMatchObject({ code: 'CHANNEL_MISMATCH' })
    expect(baseStore.failYouTubeAnalyticsRun).toHaveBeenLastCalledWith('run-1', 'CHANNEL_MISMATCH', false)
  })

  it('marks a revoked refresh token as requiring reauthorization', async () => {
    const store = {
      getYouTubeAnalyticsConnection: vi.fn(async () => ({ id: 'connection-1', connectionStatus: 'connected' })),
      startYouTubeAnalyticsRun: vi.fn(async () => ({ runId: 'run-2', credentialRef: 'local-dpapi:11111111-1111-4111-8111-111111111111' })),
      failYouTubeAnalyticsRun: vi.fn(async () => {}),
    }
    const service = createYouTubeAnalyticsService({ store, credentialStore: { load: vi.fn(async () => ({ refreshToken: 'refresh' })) }, client: { refreshAccessToken: vi.fn(async () => { throw new YouTubeAnalyticsError('REFRESH_TOKEN_REVOKED', 'revoked', { reauthRequired: true }) }) } })
    services.push(service)
    await expect(service.collect('publication-1', { startDate: '2026-10-01', endDate: '2026-10-09' })).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REVOKED' })
    expect(store.failYouTubeAnalyticsRun).toHaveBeenCalledWith('run-2', 'REFRESH_TOKEN_REVOKED', true)
  })
})
