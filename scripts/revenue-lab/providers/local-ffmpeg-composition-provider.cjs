'use strict'

const { execFile } = require('node:child_process')
const { mkdtemp, rm, writeFile, readFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { promisify } = require('node:util')
const { FinalCompositionProvider, FinalCompositionProviderError } = require('../final-composition-provider.cjs')

const execFileAsync = promisify(execFile)
const PROVIDER_ID = 'local_ffmpeg'
const PROVIDER_VERSION = 'local-shorts-composer-v1'

function sanitizedError(code = 'COMPOSITION_FAILED') {
  return new FinalCompositionProviderError(code, 'Local final composition could not be completed')
}

function assertManifest(manifest) {
  const output = manifest?.output
  if (manifest?.manifest_version !== 'three-picks-composition-manifest-v1'
    || output?.width !== 1080 || output?.height !== 1920 || output?.fps !== 30
    || output?.container !== 'mp4' || output?.video_codec !== 'h264'
    || output?.pixel_format !== 'yuv420p' || output?.faststart !== true || output?.audio !== false
    || output?.duration_seconds !== 20 || manifest?.product_cards?.length !== 3) {
    throw sanitizedError('COMPOSITION_MANIFEST_INVALID')
  }
}

function segmentFilter(transition, frames) {
  const fadeOut = Math.max(0, frames - 9)
  if (transition === 'slow_zoom') return `scale=1080:1920,zoompan=z='min(zoom+0.00035,1.04)':d=${frames}:s=1080x1920:fps=30,fade=t=in:st=0:d=0.25,fade=t=out:st=${(frames / 30 - 0.25).toFixed(2)}:d=0.25`
  if (transition === 'slide') return `scale=1120:1920,zoompan=z=1:x='max(0,40-on/${Math.max(frames - 1, 1)}*40)':y=0:d=${frames}:s=1080x1920:fps=30,fade=t=in:st=0:d=0.25,fade=t=out:st=${(frames / 30 - 0.25).toFixed(2)}:d=0.25`
  if (transition === 'scale') return `scale=1080:1920,zoompan=z='if(lte(on,12),0.96+on*0.0033,1)':d=${frames}:s=1080x1920:fps=30,fade=t=in:st=0:d=0.25,fade=t=out:st=${(frames / 30 - 0.25).toFixed(2)}:d=0.25`
  return `scale=1080:1920,zoompan=z='min(zoom+0.0001,1.015)':d=${frames}:s=1080x1920:fps=30,fade=t=in:st=0:d=0.25,fade=t=out:st=${(frames / 30 - 0.25).toFixed(2)}:d=0.25`
}

function inspectPayload(payload) {
  const stream = payload?.streams?.find(item => item.codec_type === 'video')
  const duration = Number(payload?.format?.duration)
  const rate = String(stream?.avg_frame_rate || '').split('/').map(Number)
  const fps = rate.length === 2 && rate[1] ? rate[0] / rate[1] : Number.NaN
  if (!stream || stream.codec_name !== 'h264' || stream.pix_fmt !== 'yuv420p'
    || stream.width !== 1080 || stream.height !== 1920 || !Number.isFinite(duration)
    || duration < 19.5 || duration > 20.5 || !Number.isFinite(fps) || Math.abs(fps - 30) > 0.1) {
    throw sanitizedError('COMPOSITION_OUTPUT_INVALID')
  }
  return { durationSeconds: duration, pixelWidth: stream.width, pixelHeight: stream.height, fps }
}

function createLocalFfmpegCompositionProvider({
  ffmpegPath = process.env.REVENUE_LAB_FFMPEG_PATH || 'ffmpeg',
  ffprobePath = process.env.REVENUE_LAB_FFPROBE_PATH || 'ffprobe',
  powershellPath = process.env.REVENUE_LAB_POWERSHELL_PATH || 'powershell.exe',
  rendererPath = resolve(__dirname, '..', 'three-picks-card-renderer.ps1'),
  execute = execFileAsync,
} = {}) {
  class LocalProvider extends FinalCompositionProvider {
    constructor() { super({ id: PROVIDER_ID, version: PROVIDER_VERSION }) }
    async render({ manifest, assets }) {
      assertManifest(manifest)
      if (!(assets instanceof Map) || assets.size !== 3) throw sanitizedError('COMPOSITION_ASSET_MISSING')
      const work = await mkdtemp(join(tmpdir(), 'revenue-lab-composition-'))
      try {
        const assetPaths = {}
        for (const card of manifest.product_cards) {
          const bytes = assets.get(card.product_asset_revision_id)
          if (!Buffer.isBuffer(bytes) || !bytes.length) throw sanitizedError('COMPOSITION_ASSET_MISSING')
          const path = join(work, `asset-${card.pick_number}.bin`)
          await writeFile(path, bytes); assetPaths[card.product_asset_revision_id] = path
        }
        const localManifest = { ...manifest, product_cards: manifest.product_cards.map(card => ({ ...card, local_asset_path: assetPaths[card.product_asset_revision_id] })) }
        const manifestPath = join(work, 'manifest.json')
        await writeFile(manifestPath, JSON.stringify(localManifest), 'utf8')
        try {
          await execute(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', rendererPath, '-ManifestPath', manifestPath, '-OutputDirectory', work], { windowsHide: true, maxBuffer: 512 * 1024 })
        } catch { throw sanitizedError('COMPOSITION_CARD_RENDER_FAILED') }

        const segmentPaths = []
        for (let index = 0; index < manifest.timeline.length; index += 1) {
          const scene = manifest.timeline[index]
          const framePath = join(work, `scene-${String(index + 1).padStart(2, '0')}.png`)
          const segmentPath = join(work, `segment-${String(index + 1).padStart(2, '0')}.mp4`)
          const frames = Math.round(scene.duration_seconds * 30)
          try {
            await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', framePath,
              '-t', String(scene.duration_seconds), '-vf', segmentFilter(scene.transition, frames), '-r', '30',
              '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', segmentPath], { windowsHide: true, maxBuffer: 1024 * 1024 })
          } catch { throw sanitizedError('COMPOSITION_FFMPEG_FAILED') }
          segmentPaths.push(segmentPath)
        }
        const concatPath = join(work, 'segments.txt')
        await writeFile(concatPath, segmentPaths.map(path => `file '${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')
        const outputPath = join(work, 'final.mp4')
        try {
          await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
            '-an', '-c', 'copy', '-movflags', '+faststart', outputPath], { windowsHide: true, maxBuffer: 1024 * 1024 })
          const result = await execute(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath],
            { windowsHide: true, maxBuffer: 1024 * 1024 })
          const inspection = inspectPayload(JSON.parse(result.stdout))
          return { bytes: await readFile(outputPath), ...inspection, contentType: 'video/mp4' }
        } catch (error) {
          if (error instanceof FinalCompositionProviderError) throw error
          throw sanitizedError('COMPOSITION_FFMPEG_FAILED')
        }
      } finally { await rm(work, { recursive: true, force: true }).catch(() => {}) }
    }
    normalizeError(error) { return error instanceof FinalCompositionProviderError ? error : sanitizedError() }
  }
  return new LocalProvider()
}

module.exports = { PROVIDER_ID, PROVIDER_VERSION, assertManifest, createLocalFfmpegCompositionProvider, inspectPayload, segmentFilter }
