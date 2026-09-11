const { spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const VAULT_FILE = 'search-console.dpapi'
const MAX_SECRET_BYTES = 64 * 1024
const MAX_DPAPI_OUTPUT_BYTES = MAX_SECRET_BYTES * 4
const DPAPI_TIMEOUT_MS = 10 * 1000
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'

function unavailable() {
  return new Error('Encrypted local storage is unavailable')
}

function dpapi(script, input, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
        shell: false
      })
    } catch { reject(unavailable()); return }
    let output = ''
    let settled = false
    const done = (error, value) => { if (!settled) { settled = true; clearTimeout(timer); error ? reject(error) : resolve(value) } }
    const timer = setTimeout(() => { try { child.kill() } catch {}; done(unavailable()) }, DPAPI_TIMEOUT_MS)
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8')
      if (Buffer.byteLength(output, 'utf8') > MAX_DPAPI_OUTPUT_BYTES) { try { child.kill() } catch {}; done(unavailable()) }
    })
    child.once('error', () => done(unavailable()))
    child.stdin.once('error', () => done(unavailable()))
    child.once('close', code => {
      if (code !== 0 || !/^[A-Za-z0-9+/=]+$/.test(output.trim())) return done(unavailable())
      done(null, output.trim())
    })
    child.stdin.end(input)
  })
}

function windowsProtector(spawnImpl) {
  if (process.platform !== 'win32') return null
  const protectScript = "$v=[Console]::In.ReadToEnd().Trim();$b=[Convert]::FromBase64String($v);[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"
  const unprotectScript = "$v=[Console]::In.ReadToEnd().Trim();$b=[Convert]::FromBase64String($v);[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))"
  return {
    protect: value => dpapi(protectScript, Buffer.from(value, 'utf8').toString('base64'), spawnImpl),
    unprotect: value => dpapi(unprotectScript, value, spawnImpl).then(encoded => Buffer.from(encoded, 'base64').toString('utf8'))
  }
}

function createSeoVault({ directory, protector = windowsProtector(), fsImpl = fs } = {}) {
  const base = directory || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AI-Office', 'seo')
  const file = path.join(base, VAULT_FILE)
  const safeRead = async () => {
    if (!protector) throw unavailable()
    try {
      const info = await fsImpl.lstat(file)
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_SECRET_BYTES * 4) throw unavailable()
      const encrypted = await fsImpl.readFile(file, 'utf8')
      const plain = await protector.unprotect(encrypted.trim())
      if (Buffer.byteLength(plain, 'utf8') > MAX_SECRET_BYTES) throw unavailable()
      const parsed = JSON.parse(plain)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (error) {
      if (error && error.code === 'ENOENT') return {}
      throw unavailable()
    }
  }
  return {
    async read() { return safeRead() },
    async write(value) {
      if (!protector || !value || typeof value !== 'object') throw unavailable()
      const plain = JSON.stringify(value)
      if (Buffer.byteLength(plain, 'utf8') > MAX_SECRET_BYTES) throw unavailable()
      const encrypted = await protector.protect(plain)
      if (!/^[A-Za-z0-9+/=]+$/.test(encrypted)) throw unavailable()
      await fsImpl.mkdir(base, { recursive: true })
      const temp = path.join(base, `${VAULT_FILE}.${crypto.randomUUID()}.tmp`)
      await fsImpl.writeFile(temp, encrypted, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await fsImpl.rename(temp, file)
    },
    async clear() {
      try { await fsImpl.unlink(file) } catch (error) { if (error && error.code !== 'ENOENT') throw unavailable() }
    }
  }
}

module.exports = { createSeoVault, windowsProtector }
