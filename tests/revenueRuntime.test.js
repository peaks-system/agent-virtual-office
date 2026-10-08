import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createRevenueRuntime, REQUIRED_ENV } = require('../scripts/revenue-lab/runtime.cjs')

describe('Revenue Lab runtime', () => {
  it('stays inactive and identifies missing server-only configuration', () => {
    const runtime = createRevenueRuntime({ env: {} })
    expect(runtime.active).toBe(false)
    expect(runtime.missing).toEqual(REQUIRED_ENV)
    expect(runtime.store).toBeNull()
  })

  it('starts a local worker once and stops it without coupling API code', async () => {
    const run = vi.fn(() => Promise.resolve())
    const stop = vi.fn()
    const workerFactory = vi.fn(({ store, handlers }) => ({
      store, handlers, run, stop, workerId: 'test-worker', pollIntervalMs: 5000, leaseSeconds: 60,
    }))
    const store = {}
    const youtube = {}
    const runtime = createRevenueRuntime({
      env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'secret', YOUTUBE_API_KEY: 'secret' },
      store,
      youtube,
      workerFactory,
    })
    expect(runtime.active).toBe(true)
    expect(runtime.store).toBe(store)
    runtime.start()
    runtime.start()
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    expect(workerFactory.mock.calls[0][0].handlers.get('youtube.collect')).toBeTypeOf('function')
    runtime.close()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
