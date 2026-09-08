import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { controlAddress, windowsUserSid, parseArgs, requestControl, createControlServer } = require('../scripts/office-launcher.cjs')

describe('Windows office launcher', () => {
  it('isolates Windows process users even when they inherit the same profile directory', () => {
    const normalSid = windowsUserSid(() => '"PC\\normal","S-1-5-21-1001"\r\n')
    const sandboxSid = windowsUserSid(() => '"PC\\sandbox","S-1-5-21-1003"\r\n')
    expect(controlAddress('/same-project', 5173, 'win32', normalSid))
      .not.toBe(controlAddress('/same-project', 5173, 'win32', sandboxSid))
    expect(controlAddress('/same-project', 5173, 'win32', normalSid))
      .toBe(controlAddress('/same-project', 5173, 'win32', normalSid))
  })

  it('fails closed if Windows cannot supply a valid process SID', () => {
    expect(() => windowsUserSid(() => 'unexpected output')).toThrow('実行ユーザー')
    expect(() => windowsUserSid(() => { throw new Error('denied') })).toThrow('実行ユーザー')
  })
  it.skipIf(process.platform !== 'win32')('keeps Japanese batch wrappers as UTF-8 without BOM and CRLF', () => {
    for (const name of ['Start-Office.cmd', 'Stop-Office.cmd']) {
      const text = readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
      expect(text.charCodeAt(0)).not.toBe(0xfeff)
      expect(text).not.toMatch(/(?<!\r)\n/)
      expect(text).toContain('chcp 65001')
    }
  })
  it('defaults to the Japanese office port and validates explicit ports', () => {
    expect(parseArgs(['start'])).toEqual({ action: 'start', port: 5173, openBrowser: true })
    expect(parseArgs(['stop', '--port', '5189', '--no-browser']).port).toBe(5189)
    for (const value of ['0', 'NaN', '65536', '5173;anything']) expect(() => parseArgs(['start', '--port', value])).toThrow()
    expect(() => parseArgs(['kill'])).toThrow()
  })

  it('isolates control identities by project directory and port', () => {
    expect(controlAddress('/project-a', 5173, 'win32')).toMatch(/^\\\\\.\\pipe\\avo-/)
    expect(controlAddress('/project-a', 5173)).not.toBe(controlAddress('/project-b', 5173))
    expect(controlAddress('/project-a', 5173)).not.toBe(controlAddress('/project-a', 5189))
  })

  it('only invokes shutdown for a valid matching-root stop message', async () => {
    let stops = 0
    const root = 'test-office'
    const server = createControlServer(root, () => { stops++ })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = { host: '127.0.0.1', port: server.address().port }
    try {
      await requestControl(address, 'status', root)
      expect(stops).toBe(0)
      await expect(requestControl(address, 'stop', 'other-office')).rejects.toThrow()
      expect(stops).toBe(0)
      await requestControl(address, 'stop', root)
      expect(stops).toBe(1)
    } finally { await new Promise(resolve => server.close(resolve)) }
  })

  it('does not acknowledge or stop a server while startup is still pending', async () => {
    let stops = 0
    const server = createControlServer('pending', () => { stops++ }, () => false)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      await expect(requestControl({ host: '127.0.0.1', port: server.address().port }, 'stop', 'pending')).rejects.toThrow('起動処理中')
      expect(stops).toBe(0)
    } finally { await new Promise(resolve => server.close(resolve)) }
  })
})
