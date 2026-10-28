'use strict'

const { randomUUID } = require('node:crypto')
const { spawn } = require('node:child_process')
const fileSystem = require('node:fs/promises')
const path = require('node:path')

const CREDENTIAL_REF = /^local-dpapi:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

class YouTubeAnalyticsCredentialStore {
  async save() { throw new Error('YouTubeAnalyticsCredentialStore.save is not implemented') }
  async load() { throw new Error('YouTubeAnalyticsCredentialStore.load is not implemented') }
  async delete() { throw new Error('YouTubeAnalyticsCredentialStore.delete is not implemented') }
}

class CredentialStoreError extends Error {
  constructor(code, message) { super(message); this.name = 'CredentialStoreError'; this.code = code }
}

function defaultCredentialPath(env = process.env) {
  if (!env.LOCALAPPDATA) throw new CredentialStoreError('CREDENTIAL_STORE_UNAVAILABLE', 'LOCALAPPDATA is required')
  return path.join(env.LOCALAPPDATA, 'AI Office', 'Revenue Lab', 'youtube-analytics-credentials.json')
}

function assertRepositoryExternal(filePath, repositoryRoot = process.cwd()) {
  const target = path.resolve(filePath)
  const root = path.resolve(repositoryRoot)
  const relative = path.relative(root, target)
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new CredentialStoreError('CREDENTIAL_STORE_INSIDE_REPOSITORY', 'Credential store must be outside the repository')
  }
  return target
}

function dpapiScript(operation) {
  const protect = operation === 'protect'
  const transform = protect
    ? '$r=[System.Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($v),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)'
    : '$r=[System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($v),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)'
  return `$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();${transform};[Console]::Out.Write([Convert]::ToBase64String($r))`
}

function runDpapiProcess(executable, operation, input, spawnImpl) {
  const protect = operation === 'protect'
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = error => { if (!settled) { settled = true; reject(error) } }
    let child
    try {
      child = spawnImpl(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', dpapiScript(operation)], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch {
      return fail(new CredentialStoreError('CREDENTIAL_STORE_DPAPI_LAUNCH_FAILURE', `Windows DPAPI engine could not start (${executable})`))
    }
    const stdout = []
    let stderrSize = 0
    child.stdout.on('data', chunk => { stdout.push(Buffer.from(chunk)) })
    child.stderr.on('data', chunk => { stderrSize += Buffer.byteLength(chunk) })
    child.on('error', () => fail(new CredentialStoreError('CREDENTIAL_STORE_DPAPI_LAUNCH_FAILURE', `Windows DPAPI engine could not start (${executable})`)))
    child.stdin.on('error', () => fail(new CredentialStoreError('CREDENTIAL_STORE_DPAPI_FAILURE', `Windows DPAPI stdin failed (${executable})`)))
    child.on('close', code => {
      if (settled) return
      const output = Buffer.concat(stdout).toString('ascii').trim()
      if (code !== 0 || !output) {
        return fail(new CredentialStoreError('CREDENTIAL_STORE_DPAPI_FAILURE', `Windows DPAPI failed (${executable}:${code ?? 'unknown'}:${stderrSize})`))
      }
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(output) || !Buffer.from(output, 'base64').length) {
        return fail(new CredentialStoreError('CREDENTIAL_STORE_DPAPI_FAILURE', `Windows DPAPI returned invalid output (${executable})`))
      }
      settled = true
      resolve(protect ? output : Buffer.from(output, 'base64').toString('utf8'))
    })
    const wireInput = protect ? Buffer.from(input, 'utf8').toString('base64') : input
    child.stdin.end(Buffer.from(wireInput, 'ascii'))
  })
}

async function runDpapi(operation, input, { spawnImpl = spawn, powerShellExecutables = ['powershell.exe', 'pwsh.exe'] } = {}) {
  if (process.platform !== 'win32') return Promise.reject(new CredentialStoreError('CREDENTIAL_STORE_UNAVAILABLE', 'Windows DPAPI is required'))
  if (!['protect', 'unprotect'].includes(operation)) throw new TypeError('Invalid DPAPI operation')
  let lastError
  for (const executable of powerShellExecutables) {
    try { return await runDpapiProcess(executable, operation, input, spawnImpl) }
    catch (error) {
      lastError = error
      if (error?.code !== 'CREDENTIAL_STORE_DPAPI_LAUNCH_FAILURE') throw error
    }
  }
  throw lastError || new CredentialStoreError('CREDENTIAL_STORE_DPAPI_LAUNCH_FAILURE', 'No Windows DPAPI engine is available')
}

class WindowsDpapiYouTubeAnalyticsCredentialStore extends YouTubeAnalyticsCredentialStore {
  constructor({ filePath, env = process.env, repositoryRoot = process.cwd(), protector, fsImpl = fileSystem } = {}) {
    super()
    this.filePath = assertRepositoryExternal(filePath || defaultCredentialPath(env), repositoryRoot)
    this.protector = protector || {
      protect: value => runDpapi('protect', value),
      unprotect: value => runDpapi('unprotect', value),
    }
    this.fs = fsImpl
    this.pending = Promise.resolve()
  }

  createReference() { return `local-dpapi:${randomUUID()}` }

  async readRecords() {
    try {
      const parsed = JSON.parse(await this.fs.readFile(this.filePath, 'utf8'))
      return parsed && parsed.version === 1 && parsed.credentials && typeof parsed.credentials === 'object' ? parsed : { version: 1, credentials: {} }
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, credentials: {} }
      throw new CredentialStoreError('CREDENTIAL_STORE_CORRUPT', 'Credential store could not be read')
    }
  }

  async writeRecords(records) {
    try { await this.fs.mkdir(path.dirname(this.filePath), { recursive: true }) }
    catch { throw new CredentialStoreError('CREDENTIAL_STORE_DIRECTORY_FAILURE', 'Credential store directory could not be created') }
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    try { await this.fs.writeFile(temporary, `${JSON.stringify(records)}\n`, { encoding: 'utf8', mode: 0o600 }) }
    catch {
      await this.fs.unlink(temporary).catch(() => {})
      throw new CredentialStoreError('CREDENTIAL_STORE_WRITE_FAILURE', 'Credential store temporary file could not be written')
    }
    try { await this.fs.rename(temporary, this.filePath) }
    catch {
      await this.fs.unlink(temporary).catch(() => {})
      throw new CredentialStoreError('CREDENTIAL_STORE_RENAME_FAILURE', 'Credential store atomic rename failed')
    }
  }

  serialize(task) {
    const next = this.pending.then(task, task)
    this.pending = next.catch(() => {})
    return next
  }

  async save(reference, credential) {
    if (!CREDENTIAL_REF.test(reference || '')) throw new TypeError('Invalid credential reference')
    if (typeof credential?.refreshToken !== 'string' || !credential.refreshToken) throw new TypeError('refreshToken is required')
    const safe = { refreshToken: credential.refreshToken, scopes: Array.isArray(credential.scopes) ? credential.scopes : [] }
    const ciphertext = await this.protector.protect(JSON.stringify(safe))
    await this.serialize(async () => {
      const records = await this.readRecords()
      records.credentials[reference] = { ciphertext, updatedAt: new Date().toISOString() }
      await this.writeRecords(records)
    })
    return reference
  }

  async load(reference) {
    if (!CREDENTIAL_REF.test(reference || '')) throw new TypeError('Invalid credential reference')
    const records = await this.readRecords()
    const ciphertext = records.credentials[reference]?.ciphertext
    if (!ciphertext) throw new CredentialStoreError('CREDENTIAL_NOT_FOUND', 'Stored YouTube credential was not found')
    try {
      const credential = JSON.parse(await this.protector.unprotect(ciphertext))
      if (typeof credential?.refreshToken !== 'string' || !credential.refreshToken) throw new Error('invalid')
      return credential
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error
      throw new CredentialStoreError('CREDENTIAL_DECRYPT_FAILED', 'Stored YouTube credential could not be decrypted')
    }
  }

  async delete(reference) {
    if (!CREDENTIAL_REF.test(reference || '')) return false
    return this.serialize(async () => {
      const records = await this.readRecords()
      if (!records.credentials[reference]) return false
      delete records.credentials[reference]
      if (Object.keys(records.credentials).length) await this.writeRecords(records)
      else await this.fs.unlink(this.filePath).catch(error => {
        if (error?.code !== 'ENOENT') throw new CredentialStoreError('CREDENTIAL_STORE_DELETE_FAILURE', 'Credential store could not be deleted')
      })
      return true
    })
  }
}

module.exports = {
  CREDENTIAL_REF, CredentialStoreError, YouTubeAnalyticsCredentialStore,
  WindowsDpapiYouTubeAnalyticsCredentialStore, assertRepositoryExternal, defaultCredentialPath, dpapiScript, runDpapi,
}
