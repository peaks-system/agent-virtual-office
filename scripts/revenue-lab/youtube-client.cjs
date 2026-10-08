'use strict'

const API_ROOT = 'https://www.googleapis.com/youtube/v3'

class YouTubeProviderError extends Error {
  constructor(code, message, status = null) {
    super(message)
    this.name = 'YouTubeProviderError'
    this.code = code
    this.status = status
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, status: this.status }
  }
}

function count(value) {
  if (value == null || value === '') return null
  if (!/^\d+$/.test(String(value))) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

function validateCollection(input) {
  if (!input || typeof input.queryText !== 'string' || !input.queryText.trim() || input.queryText.length > 200) {
    throw new TypeError('queryText must be a non-empty string up to 200 characters')
  }
  if (!Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 25) {
    throw new RangeError('maxResults must be an integer from 1 to 25')
  }
  if ((input.regionCode ?? 'JP') !== 'JP' || (input.relevanceLanguage ?? 'ja') !== 'ja' || (input.lookbackDays ?? 7) !== 7) {
    throw new RangeError('Phase 1 requires JP, ja, and a seven-day window')
  }
  const capturedAt = Date.parse(input.capturedAt)
  if (!Number.isFinite(capturedAt)) throw new TypeError('capturedAt must be an ISO date')
  return { ...input, queryText: input.queryText.trim(), capturedAt: new Date(capturedAt).toISOString() }
}

function createYouTubeClient({ apiKey = process.env.YOUTUBE_API_KEY, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey || typeof apiKey !== 'string') throw new Error('YOUTUBE_API_KEY is required in the worker environment')
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')

  async function request(resource, params, operation) {
    const url = new URL(`${API_ROOT}/${resource}`)
    for (const [key, value] of Object.entries({ ...params, key: apiKey })) {
      if (value != null) url.searchParams.set(key, String(value))
    }
    let response
    try {
      response = await fetchImpl(url.toString(), { headers: { accept: 'application/json' } })
    } catch {
      console.error('[revenue-lab] YouTube request transport failure', { operation })
      throw new YouTubeProviderError('YOUTUBE_TRANSPORT_ERROR', `YouTube ${operation} request failed`)
    }
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('[revenue-lab] YouTube request rejected', { operation, status: response.status })
      throw new YouTubeProviderError('YOUTUBE_HTTP_ERROR', `YouTube ${operation} request was rejected`, response.status)
    }
    if (!body || !Array.isArray(body.items)) {
      console.error('[revenue-lab] YouTube response shape invalid', { operation })
      throw new YouTubeProviderError('YOUTUBE_INVALID_RESPONSE', `YouTube ${operation} response was invalid`, response.status)
    }
    return body.items
  }

  async function collect(options) {
    const input = validateCollection(options)
    const publishedAfter = new Date(Date.parse(input.capturedAt) - 7 * 24 * 3600_000).toISOString()
    const searchItems = await request('search', {
      part: 'snippet',
      type: 'video',
      order: 'date',
      q: input.queryText,
      maxResults: input.maxResults,
      publishedAfter,
      regionCode: 'JP',
      relevanceLanguage: 'ja',
    }, 'search')
    const videoIds = [...new Set(searchItems.map(item => item?.id?.videoId).filter(Boolean))].slice(0, input.maxResults)
    if (videoIds.length === 0) return []
    const videoItems = await request('videos', { part: 'snippet,statistics', id: videoIds.join(',') }, 'videos')
    const channelIds = [...new Set(videoItems.map(item => item?.snippet?.channelId).filter(Boolean))]
    const channelItems = channelIds.length
      ? await request('channels', { part: 'snippet,statistics', id: channelIds.join(',') }, 'channels')
      : []
    const channelById = new Map(channelItems.map(item => [item.id, item]))
    const searchPosition = new Map(videoIds.map((id, index) => [id, index + 1]))
    return videoItems
      .filter(item => videoIds.includes(item?.id))
      .map(item => {
        const snippet = item.snippet || {}
        const statistics = item.statistics || {}
        const channel = channelById.get(snippet.channelId)
        const hiddenSubscribers = channel?.statistics?.hiddenSubscriberCount === true
        return {
          youtubeVideoId: item.id,
          title: String(snippet.title || '').slice(0, 500),
          channelId: snippet.channelId || null,
          channelTitle: String(snippet.channelTitle || '').slice(0, 300),
          publishedAt: snippet.publishedAt || null,
          thumbnailUrl: snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || null,
          viewCount: count(statistics.viewCount),
          likeCount: count(statistics.likeCount),
          commentCount: count(statistics.commentCount),
          subscriberCount: hiddenSubscribers ? null : count(channel?.statistics?.subscriberCount),
          hiddenSubscriberCount: hiddenSubscribers,
          searchPosition: searchPosition.get(item.id),
          capturedAt: input.capturedAt,
        }
      })
      .sort((a, b) => a.searchPosition - b.searchPosition)
  }

  return { collect }
}

module.exports = { API_ROOT, YouTubeProviderError, count, createYouTubeClient, validateCollection }
