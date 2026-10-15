import { describe, expect, it, vi } from 'vitest'
import { createAudioDurationProbe } from '../scripts/revenue-lab/audio-duration-probe.cjs'

describe('Creative Audio FFprobe duration measurement', () => {
  it('measures the generated MP3 instead of estimating from narration text', async () => {
    const execFileImpl = vi.fn(async (_binary, args) => {
      expect(args).toContain('format=duration')
      expect(args.at(-1)).toMatch(/segment\.mp3$/)
      return { stdout: '1.23789\n', stderr: '' }
    })
    const probe = createAudioDurationProbe({ ffprobePath: 'ffprobe-test', execFileImpl })
    await expect(probe(Buffer.from('mp3 bytes'))).resolves.toBe(1.238)
    expect(execFileImpl).toHaveBeenCalledOnce()
  })

  it('rejects invalid FFprobe output instead of creating a silent fallback duration', async () => {
    const probe = createAudioDurationProbe({ ffprobePath: 'ffprobe-test',
      execFileImpl: vi.fn(async () => ({ stdout: 'N/A', stderr: '' })) })
    await expect(probe(Buffer.from('mp3 bytes'))).rejects.toThrow(/invalid audio duration/i)
  })
})
