'use strict'

const http = require('node:http')
const { randomBytes } = require('node:crypto')
const { spawn } = require('node:child_process')
const {
  METRICS, QUERY_VERSION, REQUIRED_SCOPES, YouTubeAnalyticsError, pkceChallenge,
} = require('./youtube-analytics-client.cjs')

const FLOW_TIMEOUT_MS = 5 * 60 * 1000

function randomToken(bytes = 32) { return randomBytes(bytes).toString('base64url') }

function openSystemBrowser(url, { spawnImpl = spawn } = {}) {
  if (process.platform !== 'win32') return Promise.reject(new YouTubeAnalyticsError('SYSTEM_BROWSER_UNAVAILABLE', 'Windows system browser is required'))
  return new Promise((resolve, reject) => {
    const child = spawnImpl('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, windowsHide: true, stdio: 'ignore' })
    child.once('error', () => reject(new YouTubeAnalyticsError('SYSTEM_BROWSER_UNAVAILABLE', 'System browser could not be opened')))
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

function html(res, status, title, message) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><main><h1>${title}</h1><p>${message}</p></main>`)
}

function createYouTubeAnalyticsService({ store, credentialStore, client, openBrowser = openSystemBrowser, now = () => new Date() } = {}) {
  if (!store || !credentialStore || !client) throw new TypeError('Analytics store, credential store, and client are required')
  let flow = { status: 'idle', errorCode: null, startedAt: null }
  let listener = null
  let timeout = null

  function safeFlow() { return { status: flow.status, errorCode: flow.errorCode, startedAt: flow.startedAt } }

  async function connectionStatus() {
    const connection = await store.getYouTubeAnalyticsConnection()
    return { flow: safeFlow(), connection: connection ? {
      id: connection.id, channelId: connection.channelId, channelTitle: connection.channelTitle,
      scopes: connection.scopes, connectionStatus: connection.connectionStatus,
      connectedAt: connection.connectedAt, lastVerifiedAt: connection.lastVerifiedAt,
      reauthRequiredAt: connection.reauthRequiredAt, safeErrorCode: connection.safeErrorCode,
    } : null }
  }

  function stopListener() {
    if (timeout) clearTimeout(timeout)
    timeout = null
    if (listener) listener.close()
    listener = null
  }

  async function startAuthorization() {
    if (flow.status === 'authorizing') return safeFlow()
    const project = await store.getDefaultProject()
    if (!project?.id) throw new YouTubeAnalyticsError('PROJECT_NOT_FOUND', 'Revenue Lab project was not found')
    const state = randomToken(32)
    const codeVerifier = randomToken(48)
    listener = http.createServer()
    await new Promise((resolve, reject) => {
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', resolve)
    })
    const redirectUri = `http://127.0.0.1:${listener.address().port}/oauth2/callback`
    flow = { status: 'authorizing', errorCode: null, startedAt: now().toISOString() }
    const fail = code => { flow = { ...flow, status: 'failed', errorCode: code }; stopListener() }
    listener.on('request', async (req, res) => {
      let url
      try { url = new URL(req.url, redirectUri) } catch { return html(res, 400, '接続できませんでした', 'AI Officeへ戻って再試行してください。') }
      if (url.pathname !== '/oauth2/callback') return html(res, 404, 'Not found', 'このページは利用できません。')
      if (url.searchParams.get('state') !== state) {
        html(res, 400, '接続できませんでした', 'OAuth stateが一致しません。AI Officeへ戻って再試行してください。')
        return fail('OAUTH_STATE_MISMATCH')
      }
      if (url.searchParams.get('error')) {
        html(res, 400, '接続はキャンセルされました', 'AI Officeへ戻ることができます。')
        return fail('OAUTH_REJECTED')
      }
      const code = url.searchParams.get('code')
      if (!code) { html(res, 400, '接続できませんでした', '認可コードがありません。'); return fail('OAUTH_CODE_MISSING') }
      try {
        const tokens = await client.exchangeCode({ code, codeVerifier, redirectUri })
        const grantedScopes = tokens.scope ? String(tokens.scope).split(/\s+/).filter(Boolean) : [...REQUIRED_SCOPES]
        if (grantedScopes.length !== REQUIRED_SCOPES.length || !REQUIRED_SCOPES.every(scope => grantedScopes.includes(scope))) {
          throw new YouTubeAnalyticsError('OAUTH_SCOPE_MISMATCH', 'OAuth scopes did not match the minimal required set')
        }
        if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw new YouTubeAnalyticsError('OAUTH_REFRESH_TOKEN_MISSING', 'Google did not return a refresh token')
        const channel = await client.ownedChannel(tokens.access_token)
        const previous = await store.getYouTubeAnalyticsConnection(project.id)
        const credentialRef = credentialStore.createReference()
        await credentialStore.save(credentialRef, { refreshToken: tokens.refresh_token, scopes: grantedScopes })
        try {
          await store.upsertYouTubeAnalyticsConnection(project.id, { ...channel, scopes: grantedScopes, credentialRef })
        } catch (error) {
          await credentialStore.delete(credentialRef).catch(() => {})
          throw error
        }
        if (previous?.credentialRef && previous.credentialRef !== credentialRef) await credentialStore.delete(previous.credentialRef).catch(() => {})
        flow = { ...flow, status: 'succeeded', errorCode: null }
        html(res, 200, 'YouTube Analyticsを接続しました', 'このタブを閉じてAI Officeへ戻ってください。')
        stopListener()
      } catch (error) {
        console.error('[revenue-lab] YouTube Analytics OAuth failed', { code: error?.code || 'OAUTH_FAILED' })
        html(res, 502, '接続できませんでした', 'AI Officeへ戻って接続状態を確認してください。')
        fail(error?.code || 'OAUTH_FAILED')
      }
    })
    timeout = setTimeout(() => fail('OAUTH_TIMEOUT'), FLOW_TIMEOUT_MS)
    const authorizationUrl = client.authorizationUrl({ redirectUri, state, codeChallenge: pkceChallenge(codeVerifier) })
    try { await openBrowser(authorizationUrl) }
    catch (error) { fail(error?.code || 'SYSTEM_BROWSER_UNAVAILABLE'); throw error }
    return safeFlow()
  }

  async function collect(publicationId, { startDate, endDate }) {
    const connection = await store.getYouTubeAnalyticsConnection()
    if (!connection) throw new YouTubeAnalyticsError('YOUTUBE_ANALYTICS_NOT_CONNECTED', 'YouTube Analytics is not connected')
    if (connection.connectionStatus !== 'connected') throw new YouTubeAnalyticsError('REAUTH_REQUIRED', 'YouTube Analytics requires authorization', { reauthRequired: true })
    const run = await store.startYouTubeAnalyticsRun(publicationId, connection.id, { startDate, endDate, metrics: METRICS, queryVersion: QUERY_VERSION })
    try {
      const stored = await credentialStore.load(run.credentialRef)
      const refreshed = await client.refreshAccessToken(stored.refreshToken)
      const video = await client.video(refreshed.access_token, run.youtubeVideoId)
      if (!video.channelId || video.channelId !== run.channelId) throw new YouTubeAnalyticsError('CHANNEL_MISMATCH', 'Publication does not belong to the connected channel')
      const result = await client.performance(refreshed.access_token, { videoId: run.youtubeVideoId, startDate, endDate })
      return store.finishYouTubeAnalyticsRun(run.runId, {
        data_through_date: result.dataThroughDate,
        views: result.metrics.views,
        estimated_minutes_watched: result.metrics.estimatedMinutesWatched,
        average_view_duration: result.metrics.averageViewDuration,
        average_view_percentage: result.metrics.averageViewPercentage,
        subscribers_gained: result.metrics.subscribersGained,
        subscribers_lost: result.metrics.subscribersLost,
        likes: result.metrics.likes, comments: result.metrics.comments, shares: result.metrics.shares,
        raw_metrics: result.rawMetrics,
      }, result.noData)
    } catch (error) {
      const code = error?.code || 'YOUTUBE_ANALYTICS_COLLECTION_FAILED'
      const reauthRequired = Boolean(error?.reauthRequired || ['CREDENTIAL_NOT_FOUND', 'CREDENTIAL_DECRYPT_FAILED'].includes(code))
      await store.failYouTubeAnalyticsRun(run.runId, code, reauthRequired).catch(() => {})
      console.error('[revenue-lab] YouTube Analytics collection failed', { runId: run.runId, code })
      throw error
    }
  }

  function close() { stopListener() }
  return { close, collect, connectionStatus, startAuthorization }
}

module.exports = { FLOW_TIMEOUT_MS, createYouTubeAnalyticsService, openSystemBrowser, randomToken }
