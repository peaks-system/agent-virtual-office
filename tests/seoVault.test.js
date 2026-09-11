import { it, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { createSeoVault } = require('../scripts/seo-vault.cjs')

it.skipIf(process.platform !== 'win32')('persists and reloads a harmless marker using actual fresh Windows PowerShell DPAPI', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'office-dpapi-test-'))
  try {
    const vault = createSeoVault({ directory })
    const marker = { marker: 'harmless-office-regression-marker' }
    await vault.write(marker)
    const disk = await fs.readFile(path.join(directory, 'search-console.dpapi'), 'utf8')
    expect(disk).not.toContain(marker.marker)
    expect(await createSeoVault({ directory }).read()).toEqual(marker)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
}, 25000)
