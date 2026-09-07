import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'

// Execute each real language handler with isolated persistence dependencies.
// No writes reach the user's home directory and no server ports are needed.
function loadHandler(file) {
  const source = fs.readFileSync(file, 'utf8')
  const write = vi.fn(() => true)
  const context = {
    Buffer, path, os: { homedir: () => '/isolated-home' },
    fs: { existsSync: () => true, mkdirSync: vi.fn() },
    atomicWrite: write, apiConfig: {},
    setCors: vi.fn(), handlePreflight: vi.fn(),
    isAllowedOrigin: () => true, getAllowedOriginHeader: () => null,
    isAuthorized: () => true, isAuthorizedOfficeRequest: () => true,
    checkRateLimit: () => true,
  }
  let handler
  if (file === 'server.mjs') {
    const start = source.indexOf('function handleLang(')
    const end = source.indexOf('// ─── /api/event', start)
    handler = vm.runInNewContext(`${source.slice(start, end)}; handleLang`, context)
  } else {
    const start = source.indexOf("server.middlewares.use('/api/lang'")
    const end = source.indexOf('// ─── /api/event', start)
    context.server = { middlewares: { use: (_route, callback) => { handler = callback } } }
    vm.runInNewContext(source.slice(start, end), context)
  }
  return { handler, write }
}

function request(handler, body) {
  const req = Object.assign(new EventEmitter(), {
    method: 'POST', headers: {}, setEncoding: vi.fn(), resume: vi.fn(),
  })
  const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() }
  handler(req, res)
  req.emit('data', body)
  req.emit('end')
  return res
}

describe.each(['server.mjs', 'vite.config.js'])('%s language persistence', file => {
  it.each(['ja', 'en', 'zh-TW'])('persists supported language %s', lang => {
    const { handler, write } = loadHandler(file)
    const res = request(handler, ` ${lang} `)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ ok: true })
    expect(write).toHaveBeenCalledWith(path.join('/isolated-home', '.claude', 'office-lang'), lang)
  })

  it('rejects unsupported languages without changing saved preferences', () => {
    const { handler, write } = loadHandler(file)
    expect(request(handler, 'xx').statusCode).toBe(400)
    expect(write).not.toHaveBeenCalled()
  })

  it('reports failed persistence as an error', () => {
    const { handler, write } = loadHandler(file)
    write.mockReturnValue(false)
    expect(request(handler, 'ja').statusCode).toBe(500)
  })
})
