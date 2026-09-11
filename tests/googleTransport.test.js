import { it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
const require = createRequire(import.meta.url)
const { createGoogleFetch } = require('../scripts/google-transport.cjs')

it('uses default and system certificates, verifies TLS, and never follows redirects', async () => {
  const certificates = { getCACertificates: vi.fn(type => [type + '-marker']) }
  const response = Object.assign(Readable.from([Buffer.from('bounded response')]), { statusCode: 302, headers: { location: 'https://untrusted.test/' } })
  const request = vi.fn((url, options, callback) => Object.assign(new EventEmitter(), {
    write: vi.fn(), destroy: vi.fn(), end: () => callback(response),
  }))
  const signal = new AbortController().signal
  const result = await createGoogleFetch({ request, certificates })('https://oauth2.googleapis.com/token', { method: 'POST', body: 'harmless-marker', signal })
  expect(request).toHaveBeenCalledOnce()
  expect(request.mock.calls[0][1]).toMatchObject({ ca: ['default-marker', 'system-marker'], rejectUnauthorized: true, signal, method: 'POST' })
  expect(result.status).toBe(302)
  expect(result.ok).toBe(false)
  expect(await result.text()).toBe('bounded response')
})

it('propagates certificate errors without retrying insecurely', async () => {
  const request = vi.fn(() => {
    const req = Object.assign(new EventEmitter(), { end() { this.emit('error', Object.assign(new Error('TLS'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })) }, destroy() {} })
    return req
  })
  await expect(createGoogleFetch({ request, certificates: {} })('https://oauth2.googleapis.com/token')).rejects.toMatchObject({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })
  expect(request).toHaveBeenCalledOnce()
})
