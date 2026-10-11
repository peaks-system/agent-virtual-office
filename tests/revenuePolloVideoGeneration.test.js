import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { assertVideoGenerationProvider } = require('../scripts/revenue-lab/video-generation-provider.cjs')
const {
  DEFAULT_MODEL, createPolloVideoGenerationProvider, normalizedDuration, validatedModel,
} = require('../scripts/revenue-lab/providers/pollo-video-generation-provider.cjs')

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const rawResponse = (body, status = 200, contentType = 'application/json') => new Response(body, { status, headers: { 'content-type': contentType } })

describe('Pollo VideoGenerationProvider', () => {
  it('submits only text-to-video with header auth, 9:16, normalized duration, and audio disabled', async () => {
    const fetchImpl = vi.fn(async () => response({ taskId: 'task-safe-1', status: 'pending' }))
    const provider = createPolloVideoGenerationProvider({ apiKey: 'private-test-key', fetchImpl })
    expect(assertVideoGenerationProvider(provider)).toBe(provider)
    const result = await provider.submitScene({ prompt: '[背景のみ] 朝の机', durationSeconds: 7, aspectRatio: '9:16', resolution: '480p' })
    const [url, options] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://pollo.ai/api/platform/v1/generation/pollo-ai/pollo-v2/video')
    expect(options.headers['x-api-key']).toBe('private-test-key')
    expect(JSON.parse(options.body)).toEqual({ input: { prompt: '[背景のみ] 朝の机', resolution: '480p', duration: 10, aspectRatio: '9:16', generateAudio: false } })
    expect(result).toMatchObject({ providerTaskId: 'task-safe-1', status: 'polling', providerTaskStatus: 'pending' })
    expect(`${url}${options.body}${JSON.stringify(result)}`).not.toContain('private-test-key')
  })

  it('accepts the observed code/message/data submit wrapper without breaking the top-level format', async () => {
    const fetchImpl = vi.fn(async () => response({
      code: 200, message: 'success', data: { taskId: 'task-wrapped-1', status: 'pending' },
    }))
    const provider = createPolloVideoGenerationProvider({ apiKey: 'test-only', fetchImpl })
    await expect(provider.submitScene({ prompt: '抽象的な光の動き', durationSeconds: 5 })).resolves.toEqual({
      providerTaskId: 'task-wrapped-1', status: 'polling', providerTaskStatus: 'pending',
    })
  })

  it('normalizes successful output and preserves only actual provider cost', async () => {
    const fetchImpl = vi.fn(async () => response({ taskId: 'task-1', costUsd: 0.12, generations: [{ status: 'succeeded', url: 'https://cdn.example/video.mp4', mediaType: 'video' }] }))
    const provider = createPolloVideoGenerationProvider({ apiKey: 'test-only', model: 'pollo-v2-5', fetchImpl })
    await expect(provider.getTaskStatus('task-1')).resolves.toMatchObject({
      status: 'succeeded', providerTaskStatus: 'succeeded', outputUrl: 'https://cdn.example/video.mp4',
      providerCost: 0.12, costCurrency: 'USD', costProvenance: 'actual', safeErrorCode: null,
    })
    expect(fetchImpl.mock.calls[0][0]).toContain('/generation/task-1/status')
  })

  it('accepts a wrapped status response and reads generations and actual cost from data', async () => {
    const fetchImpl = vi.fn(async () => response({
      code: 200, message: 'success', data: {
        taskId: 'task-wrapped-1', costUsd: 0.06,
        generations: [{ status: 'succeeded', url: 'https://cdn.example/wrapped.mp4', mediaType: 'video' }],
      },
    }))
    const provider = createPolloVideoGenerationProvider({ apiKey: 'test-only', fetchImpl })
    await expect(provider.getTaskStatus('task-wrapped-1')).resolves.toMatchObject({
      status: 'succeeded', providerTaskStatus: 'succeeded', outputUrl: 'https://cdn.example/wrapped.mp4',
      providerCost: 0.06, costCurrency: 'USD', costProvenance: 'actual',
    })
  })

  it('marks absent cost unavailable and seals provider errors without response bodies', async () => {
    const pending = createPolloVideoGenerationProvider({ apiKey: 'test-only', fetchImpl: vi.fn(async () => response({ status: 'processing', generations: [] })) })
    await expect(pending.getTaskStatus('task-1')).resolves.toMatchObject({ status: 'polling', providerCost: null, costCurrency: null, costProvenance: 'unavailable' })
    const failed = createPolloVideoGenerationProvider({ apiKey: 'test-only', fetchImpl: vi.fn(async () => response({ message: 'provider secret diagnostic' }, 401)) })
    await expect(failed.getTaskStatus('task-1')).rejects.toMatchObject({ code: 'POLLO_AUTH_FAILED', message: 'Pollo status failed', status: 401 })
    await failed.getTaskStatus('task-1').catch(error => expect(JSON.stringify(error)).not.toContain('provider secret diagnostic'))
  })

  it('accepts a UTF-8 BOM and the documented top-level submit schema', async () => {
    const logger = { error: vi.fn() }
    const provider = createPolloVideoGenerationProvider({
      apiKey: 'test-only', logger,
      fetchImpl: vi.fn(async () => rawResponse('\uFEFF{"taskId":"task-bom","status":"pending"}')),
    })
    await expect(provider.submitScene({ prompt: '背景の光が移動する', durationSeconds: 5 })).resolves.toMatchObject({
      providerTaskId: 'task-bom', providerTaskStatus: 'pending',
    })
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs only allowlisted response metadata when submit JSON lacks taskId', async () => {
    const logger = { error: vi.fn() }
    const provider = createPolloVideoGenerationProvider({
      apiKey: 'private-test-key', logger,
      fetchImpl: vi.fn(async () => response({
        code: 200, message: 'provider-secret-detail',
        data: { state: 'pending', unsafe: 'provider-secret-value' },
      }, 202)),
    })
    await expect(provider.submitScene({ prompt: 'sensitive full prompt', durationSeconds: 5 })).rejects.toMatchObject({ code: 'POLLO_INVALID_RESPONSE' })
    expect(logger.error).toHaveBeenCalledWith('[revenue-lab] Pollo response validation failed', {
      httpStatus: 202,
      contentType: 'application/json',
      jsonParsed: true,
      topLevelKeys: ['code', 'message', 'data'],
      hasTaskId: false,
      hasStatus: false,
      dataIsObject: true,
      dataTopLevelKeys: ['state', 'unsafe'],
      endpointPath: '/api/platform/v1/generation/pollo-ai/pollo-v2/video',
    })
    const serializedLog = JSON.stringify(logger.error.mock.calls)
    expect(serializedLog).not.toContain('private-test-key')
    expect(serializedLog).not.toContain('provider-secret-detail')
    expect(serializedLog).not.toContain('provider-secret-value')
    expect(serializedLog).not.toContain('sensitive full prompt')
  })

  it('logs invalid JSON without logging the response body', async () => {
    const logger = { error: vi.fn() }
    const provider = createPolloVideoGenerationProvider({
      apiKey: 'test-only', logger,
      fetchImpl: vi.fn(async () => rawResponse('raw-secret-response', 200, 'text/html; charset=utf-8')),
    })
    await expect(provider.submitScene({ prompt: 'safe prompt', durationSeconds: 5 })).rejects.toMatchObject({ code: 'POLLO_INVALID_RESPONSE' })
    expect(logger.error.mock.calls[0][1]).toEqual({
      httpStatus: 200,
      contentType: 'text/html; charset=utf-8',
      jsonParsed: false,
      topLevelKeys: [],
      hasTaskId: false,
      hasStatus: false,
      dataIsObject: false,
      dataTopLevelKeys: [],
      endpointPath: '/api/platform/v1/generation/pollo-ai/pollo-v2/video',
    })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('raw-secret-response')
  })

  it('bounds the configurable model and Pollo 2.0 duration contract', () => {
    expect(DEFAULT_MODEL).toBe('pollo-v2')
    expect(validatedModel('POLLO-V2-5')).toBe('pollo-v2-5')
    expect(() => validatedModel('../other-provider')).toThrow(TypeError)
    expect(normalizedDuration(1)).toBe(5)
    expect(normalizedDuration(5)).toBe(5)
    expect(normalizedDuration(5.1)).toBe(10)
    expect(normalizedDuration(30)).toBe(10)
  })
})
