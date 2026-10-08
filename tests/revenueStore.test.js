import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createSupabaseStore } = require('../scripts/revenue-lab/supabase-store.cjs')

function response(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: body == null ? {} : { 'content-type': 'application/json' },
  })
}

describe('Revenue Lab Supabase store snapshots', () => {
  it('uses one uniform key set for mixed video and channel bulk inserts', async () => {
    const calls = []
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null })
      if (url.includes('/source_items?')) return response([
        { id: 'video-item', item_type: 'video', external_id: 'video-1' },
        { id: 'channel-item', item_type: 'channel', external_id: 'channel-1' },
      ])
      if (url.includes('/source_item_snapshots?')) return response([
        { id: 'video-snapshot', source_item_id: 'video-item' },
        { id: 'channel-snapshot', source_item_id: 'channel-item' },
      ])
      return response(null, 204)
    })
    const store = createSupabaseStore({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'test-only',
      fetchImpl,
    })
    await store.persistCollection({
      runId: 'run-1',
      query: { id: 'query-1', sourceId: 'source-1', maxResults: 25 },
      videos: [{
        youtubeVideoId: 'video-1', title: '動画', channelId: 'channel-1', channelTitle: 'チャンネル',
        publishedAt: '2026-10-07T00:00:00.000Z', capturedAt: '2026-10-08T00:00:00.000Z',
        viewCount: 100, likeCount: null, commentCount: 3, subscriberCount: 500,
        hiddenSubscriberCount: false, searchPosition: 1, thumbnailUrl: null,
      }],
      opportunities: [],
      excludedReason: null,
    })

    const snapshotCall = calls.find(call => call.url.includes('/source_item_snapshots?'))
    expect(snapshotCall.body).toHaveLength(2)
    const expectedKeys = [
      'captured_at', 'comment_count', 'hidden_subscriber_count', 'like_count', 'metrics',
      'source_item_id', 'subscriber_count', 'view_count',
    ]
    for (const row of snapshotCall.body) expect(Object.keys(row).sort()).toEqual(expectedKeys)
    expect(snapshotCall.body[0]).toMatchObject({
      source_item_id: 'video-item', view_count: 100, like_count: null, comment_count: 3,
      subscriber_count: null, hidden_subscriber_count: false,
    })
    expect(snapshotCall.body[1]).toMatchObject({
      source_item_id: 'channel-item', view_count: null, like_count: null, comment_count: null,
      subscriber_count: 500, hidden_subscriber_count: false,
    })
  })

  it('retains a safe PostgREST diagnostic without request headers or credentials', async () => {
    const fetchImpl = vi.fn(async () => response({
      code: 'PGRST102', message: 'All object keys must match', details: null, hint: null,
    }, 400))
    const store = createSupabaseStore({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'secret-must-not-appear',
      fetchImpl,
    })
    await expect(store.listQueries()).rejects.toMatchObject({
      code: 'SUPABASE_HTTP_ERROR', status: 400, providerCode: 'PGRST102',
      providerMessage: 'All object keys must match',
    })
  })
})
