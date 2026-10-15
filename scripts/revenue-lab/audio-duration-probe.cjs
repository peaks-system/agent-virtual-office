'use strict'

const { execFile } = require('node:child_process')
const { mkdtemp, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

function createAudioDurationProbe({ ffprobePath, execFileImpl = execFileAsync } = {}) {
  if (!ffprobePath) throw new Error('REVENUE_LAB_FFPROBE_PATH is required for TTS duration measurement')
  return async function probeAudioDuration(bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length) throw new TypeError('Non-empty audio bytes are required')
    const directory = await mkdtemp(path.join(tmpdir(), 'revenue-audio-'))
    const filename = path.join(directory, 'segment.mp3')
    try {
      await writeFile(filename, bytes, { flag: 'wx' })
      const result = await execFileImpl(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1', filename], { windowsHide: true, timeout: 30_000 })
      const duration = Number.parseFloat(String(result.stdout || '').trim())
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('FFprobe returned an invalid audio duration')
      return Number(duration.toFixed(3))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}

module.exports = { createAudioDurationProbe }
