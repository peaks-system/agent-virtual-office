'use strict'

const { createHash } = require('node:crypto')

const REQUIRED_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/youtube.readonly',
])
const METRICS = Object.freeze([
  'views', 'estimatedMinutesWatched', 'averageViewDuration', 'averageViewPercentage',
  'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares',
])
const QUERY_VERSION = 'youtube-analytics-v1'

class YouTubeAnalyticsError extends Error {
  constructor(code, message, { status = null, reauthRequired = false } = {}) {
    super(message); this.name = 'YouTubeAnalyticsError'; this.code = code; this.status = status; this.reauthRequired = reauthRequired
  }
}

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function pkceChallenge(verifier) { return base64url(createHash('sha256').update(verifier).digest()) }

function safeProviderCode(status, operation, parsed) {
  const reason = parsed?.error === 'invalid_grant' ? 'invalid_grant'
    : parsed?.error?.errors?.[0]?.reason || parsed?.error?.status || parsed?.error || null
  if (operation === 'refresh' && (status === 400 || status === 401) && reason === 'invalid_grant') return ['REFRESH_TOKEN_REVOKED', true]
  if (operation === 'exchange' && status === 400 && reason === 'invalid_grant') return ['OAUTH_CODE_OR_PKCE_INVALID', false]
  if (status === 401) return ['GOOGLE_AUTH_REQUIRED', true]
  if (status === 403) return [reason === 'quotaExceeded' ? 'GOOGLE_RATE_LIMIT' : 'GOOGLE_ACCESS_DENIED', false]
  if (status === 404) return ['VIDEO_NOT_FOUND_OR_DENIED', false]
  if (status === 429) return ['GOOGLE_RATE_LIMIT', false]
  if (status >= 500) return ['GOOGLE_API_UNAVAILABLE', false]
  return ['GOOGLE_API_ERROR', false]
}

function createYouTubeAnalyticsClient({ clientId, clientSecret, fetchImpl = globalThis.fetch } = {}) {
  if (!clientId || !clientSecret) throw new TypeError('YouTube Analytics OAuth client configuration is required')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')

  async function request(url, { method = 'GET', body, accessToken, operation = 'api' } = {}) {
    let response
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          accept: 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
        ...(body ? { body: new URLSearchParams(body).toString() } : {}),
      })
    } catch {
      throw new YouTubeAnalyticsError('GOOGLE_TRANSPORT_ERROR', 'Google API transport failed')
    }
    const parsed = await response.json().catch(() => null)
    if (!response.ok) {
      const [code, reauthRequired] = safeProviderCode(response.status, operation, parsed)
      throw new YouTubeAnalyticsError(code, 'Google API request was rejected', { status: response.status, reauthRequired })
    }
    if (!parsed || typeof parsed !== 'object') throw new YouTubeAnalyticsError('GOOGLE_INVALID_RESPONSE', 'Google API returned invalid JSON')
    return parsed
  }

  function authorizationUrl({ redirectUri, state, codeChallenge }) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: REQUIRED_SCOPES.join(' '), state, code_challenge: codeChallenge,
      code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
    }).toString()
    return url.toString()
  }

  async function exchangeCode({ code, codeVerifier, redirectUri }) {
    return request('https://oauth2.googleapis.com/token', { method: 'POST', operation: 'exchange', body: {
      client_id: clientId, client_secret: clientSecret, code, code_verifier: codeVerifier,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    } })
  }

  async function refreshAccessToken(refreshToken) {
    return request('https://oauth2.googleapis.com/token', { method: 'POST', operation: 'refresh', body: {
      client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token',
    } })
  }

  async function ownedChannel(accessToken) {
    const url = new URL('https://www.googleapis.com/youtube/v3/channels')
    url.search = new URLSearchParams({ part: 'id,snippet', mine: 'true', maxResults: '2' }).toString()
    const data = await request(url, { accessToken, operation: 'channels' })
    if (!Array.isArray(data.items) || data.items.length === 0) throw new YouTubeAnalyticsError('YOUTUBE_CHANNEL_NOT_FOUND', 'No owned YouTube channel was found')
    if (data.items.length !== 1) throw new YouTubeAnalyticsError('YOUTUBE_CHANNEL_AMBIGUOUS', 'More than one owned YouTube channel was returned')
    const channel = data.items[0]
    if (typeof channel.id !== 'string' || typeof channel.snippet?.title !== 'string') throw new YouTubeAnalyticsError('GOOGLE_INVALID_RESPONSE', 'Owned channel response was incomplete')
    return { channelId: channel.id, channelTitle: channel.snippet.title }
  }

  async function video(accessToken, videoId) {
    const url = new URL('https://www.googleapis.com/youtube/v3/videos')
    url.search = new URLSearchParams({ part: 'id,snippet,status', id: videoId, maxResults: '1' }).toString()
    const data = await request(url, { accessToken, operation: 'video' })
    const item = Array.isArray(data.items) ? data.items[0] : null
    if (!item) throw new YouTubeAnalyticsError('VIDEO_NOT_FOUND_OR_DENIED', 'The YouTube video is unavailable')
    return { videoId: item.id, channelId: item.snippet?.channelId || null, privacyStatus: item.status?.privacyStatus || null }
  }

  async function performance(accessToken, { videoId, startDate, endDate }) {
    const base = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    base.search = new URLSearchParams({
      ids: 'channel==MINE', startDate, endDate, metrics: METRICS.join(','), filters: `video==${videoId}`,
    }).toString()
    const summary = await request(base, { accessToken, operation: 'analytics' })
    const coverageUrl = new URL('https://youtubeanalytics.googleapis.com/v2/reports')
    coverageUrl.search = new URLSearchParams({
      ids: 'channel==MINE', startDate, endDate, metrics: 'views', dimensions: 'day', filters: `video==${videoId}`, sort: 'day',
    }).toString()
    const coverage = await request(coverageUrl, { accessToken, operation: 'analytics' })
    const row = Array.isArray(summary.rows) ? summary.rows[0] : null
    const values = Object.fromEntries(METRICS.map(name => [name, null]))
    if (row) {
      for (const [index, header] of (summary.columnHeaders || []).entries()) {
        if (METRICS.includes(header?.name) && row[index] != null && Number.isFinite(Number(row[index]))) values[header.name] = Number(row[index])
      }
    }
    const days = (coverage.rows || []).map(value => value?.[0]).filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value || ''))
    return {
      metrics: values,
      noData: !row,
      dataThroughDate: days.length ? days.sort().at(-1) : null,
      rawMetrics: { summary, coverage },
    }
  }

  return { authorizationUrl, exchangeCode, refreshAccessToken, ownedChannel, performance, video }
}

module.exports = {
  METRICS, QUERY_VERSION, REQUIRED_SCOPES, YouTubeAnalyticsError,
  base64url, createYouTubeAnalyticsClient, pkceChallenge, safeProviderCode,
}
