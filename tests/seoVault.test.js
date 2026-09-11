import { it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { createSeoVault } = require('../scripts/seo-vault.cjs')
const { createSearchConsole } = require('../scripts/search-console.cjs')

it.skipIf(process.platform !== 'win32')('persists and reloads a harmless marker using actual fresh Windows PowerShell DPAPI', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-dpapi-test-'))
  try {
    const vault = createSeoVault({ directory })
    const marker = { marker: 'harmless-office-regression-marker' }
    await vault.write(marker)
    const disk = await fs.readFile(path.join(directory, 'search-console.dpapi'), 'utf8')
    expect(disk).not.toContain(marker.marker)
    expect(await createSeoVault({ directory }).read()).toEqual(marker)
    const search = createSearchConsole({ vault })
    await search.configure({ installed: { client_id: 'harmless-test-client', client_secret: 'harmless-test-value', auth_uri: 'https://accounts.google.com/o/oauth2/auth', token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['http://localhost'] } })
    await search.close()
    const reopened = createSearchConsole({ vault: createSeoVault({ directory }) })
    expect(await reopened.status()).toMatchObject({ configured: true, connected: false })
    await reopened.close()
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 25000)
