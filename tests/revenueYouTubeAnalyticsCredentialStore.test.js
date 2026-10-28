import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { CredentialStoreError, WindowsDpapiYouTubeAnalyticsCredentialStore, assertRepositoryExternal, runDpapi } = require('../scripts/revenue-lab/youtube-analytics-credential-store.cjs')
const roots = []
const hasPwsh = process.platform === 'win32' && spawnSync('where.exe', ['pwsh.exe'], { stdio: 'ignore' }).status === 0

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const base = path.join(process.cwd(), '.test-tmp')
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, 'youtube-credential-'))
  roots.push(root)
  const protector = {
    protect: vi.fn(async value => Buffer.from(value).toString('base64')),
    unprotect: vi.fn(async value => Buffer.from(value, 'base64').toString('utf8')),
  }
  return { root, protector, store: new WindowsDpapiYouTubeAnalyticsCredentialStore({
    filePath: path.join(root, 'credentials.json'), repositoryRoot: path.join(root, 'repository'), protector,
  }) }
}

describe('YouTubeAnalyticsCredentialStore', () => {
  it('stores only protected ciphertext and restores the refresh credential', async () => {
    const { root, store, protector } = await fixture()
    const reference = store.createReference()
    await store.save(reference, { refreshToken: 'test-refresh-token', scopes: ['scope-a'] })
    expect(await readFile(path.join(root, 'credentials.json'), 'utf8')).not.toContain('test-refresh-token')
    expect(await store.load(reference)).toEqual({ refreshToken: 'test-refresh-token', scopes: ['scope-a'] })
    expect(protector.protect).toHaveBeenCalledOnce()
    expect(await store.delete(reference)).toBe(true)
    await expect(store.load(reference)).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_FOUND' })
  })

  it('rejects repository-local storage and malformed references', async () => {
    expect(() => assertRepositoryExternal(path.join(process.cwd(), 'private.json'), process.cwd())).toThrowError(CredentialStoreError)
    const { store } = await fixture()
    await expect(store.save('unsafe-reference', { refreshToken: 'x' })).rejects.toThrow('Invalid credential reference')
  })

  it.runIf(process.platform === 'win32')('round-trips a UTF-8 token with CurrentUser DPAPI and stores no plaintext', async () => {
    const base = path.join(process.cwd(), '.test-tmp')
    await mkdir(base, { recursive: true })
    const root = await mkdtemp(path.join(base, 'YouTube Analytics Credential Store '))
    roots.push(root)
    const filePath = path.join(root, 'AI Office', 'Revenue Lab', 'youtube-analytics-credentials.json')
    const store = new WindowsDpapiYouTubeAnalyticsCredentialStore({ filePath, repositoryRoot: path.join(root, 'repository') })
    const reference = store.createReference()
    const refreshToken = 'fixed-test-token-UTF8-日本語'
    await store.save(reference, { refreshToken, scopes: ['scope-a'] })
    expect(await store.load(reference)).toEqual({ refreshToken, scopes: ['scope-a'] })
    const secondReference = store.createReference()
    await store.save(secondReference, { refreshToken: 'fixed-second-token', scopes: [] })
    expect(await store.load(reference)).toEqual({ refreshToken, scopes: ['scope-a'] })
    const contents = await readFile(filePath, 'utf8')
    expect(contents).not.toContain(refreshToken)
    expect(contents).not.toContain('fixed-second-token')
  })

  it.runIf(hasPwsh)('supports the PowerShell 7 DPAPI engine', async () => {
    const plaintext = 'fixed-pwsh-test-token-UTF8-日本語'
    const ciphertext = await runDpapi('protect', plaintext, { powerShellExecutables: ['pwsh.exe'] })
    expect(await runDpapi('unprotect', ciphertext, { powerShellExecutables: ['pwsh.exe'] })).toBe(plaintext)
  })

  it('classifies directory, write, and atomic rename failures without file content', async () => {
    const { root, protector } = await fixture()
    const reference = new WindowsDpapiYouTubeAnalyticsCredentialStore({
      filePath: path.join(root, 'a', 'credentials.json'), repositoryRoot: path.join(root, 'repository'), protector,
      fsImpl: { ...fs, mkdir: vi.fn(async () => { throw new Error('sensitive directory detail') }) },
    })
    await expect(reference.save(reference.createReference(), { refreshToken: 'x' })).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_DIRECTORY_FAILURE' })

    const writeFailure = new WindowsDpapiYouTubeAnalyticsCredentialStore({
      filePath: path.join(root, 'b', 'credentials.json'), repositoryRoot: path.join(root, 'repository'), protector,
      fsImpl: { ...fs, writeFile: vi.fn(async () => { throw new Error('sensitive write detail') }) },
    })
    await expect(writeFailure.save(writeFailure.createReference(), { refreshToken: 'x' })).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_WRITE_FAILURE' })

    const renameFailure = new WindowsDpapiYouTubeAnalyticsCredentialStore({
      filePath: path.join(root, 'c', 'credentials.json'), repositoryRoot: path.join(root, 'repository'), protector,
      fsImpl: { ...fs, rename: vi.fn(async () => { throw new Error('sensitive rename detail') }) },
    })
    await expect(renameFailure.save(renameFailure.createReference(), { refreshToken: 'x' })).rejects.toMatchObject({ code: 'CREDENTIAL_STORE_RENAME_FAILURE' })
  })

  it.runIf(process.platform === 'win32')('classifies a missing PowerShell engine without exposing stdin', async () => {
    await expect(runDpapi('protect', 'fixed-test-token', { powerShellExecutables: ['missing-powershell-engine.exe'] }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_STORE_DPAPI_LAUNCH_FAILURE' })
  })

  it.runIf(process.platform === 'win32')('classifies a CurrentUser DPAPI rejection without exposing provider stderr', async () => {
    await expect(runDpapi('unprotect', Buffer.from('not-dpapi-ciphertext').toString('base64')))
      .rejects.toMatchObject({ code: 'CREDENTIAL_STORE_DPAPI_FAILURE' })
  })
})
