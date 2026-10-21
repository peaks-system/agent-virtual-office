import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createJobHandlers } from '../scripts/revenue-lab/job-handlers.cjs'
import { createLocalFfmpegCompositionV2Provider } from '../scripts/revenue-lab/providers/local-ffmpeg-composition-v2-provider.cjs'
import { ARCHETYPE, LAYOUT_ID, MANIFEST_VERSION, TEMPLATE_ID } from '../scripts/revenue-lab/multi-product-shorts-v2-schema.cjs'

const execute = promisify(execFile)
const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const windowsFfmpeg = 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe'
const windowsFfprobe = 'C:\\Tools\\ffmpeg\\bin\\ffprobe.exe'
const ffmpegPath = process.env.REVENUE_LAB_FFMPEG_PATH || (existsSync(windowsFfmpeg) ? windowsFfmpeg : null)
const ffprobePath = process.env.REVENUE_LAB_FFPROBE_PATH || (existsSync(windowsFfprobe) ? windowsFfprobe : null)

function scene(id, kind, start, duration, layers) {
  return { id, kind, start_seconds: start, duration_seconds: duration,
    transition: kind === 'product' ? 'carousel_slide' : 'fade', layers }
}

describe('Creative Archetype v2 real FFmpeg renderer', () => {
  let root
  let assetBytes
  let audioBytes

  beforeAll(async () => {
    if (!ffmpegPath || !ffprobePath) return
    root = await mkdtemp(join(tmpdir(), 'three-picks-v2-ffmpeg-'))
    assetBytes = []
    for (const [index, color] of ['#f97316', '#0ea5e9', '#22c55e', '#a855f7'].entries()) {
      const path = join(root, `asset-${index + 1}.png`)
      await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', `color=c=${color}:s=900x1200:d=0.1`, '-frames:v', '1', path])
      assetBytes.push(await readFile(path))
    }
    const audioPath = join(root, 'narration.mp3')
    await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
      '-i', 'sine=frequency=440:sample_rate=44100:duration=1', '-c:a', 'libmp3lame', '-b:a', '128k', audioPath])
    audioBytes = await readFile(audioPath)
  }, 30_000)

  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

  it.runIf(Boolean(ffmpegPath && ffprobePath))('renders and stores a validated 39-second 1080x1920 H.264/AAC Short with 11 narration artifacts', async () => {
    const assetIds = [1, 2, 3, 4].map(value => uuid(100 + value))
    const audioIds = Array.from({ length: 11 }, (_, index) => uuid(200 + index))
    const imageLayer = (id, order, role = 'supporting') => ({ kind: 'product_image', role,
      asset_order: order, product_asset_revision_id: id, content_sha256: sha256(assetBytes[assetIds.indexOf(id)]),
      layout_id: LAYOUT_ID, motion: order === 1 ? 'hero_slow_zoom' : 'supporting_carousel' })
    const productLayers = (pick, name, appeal, fact, ids) => [
      { kind: 'background', recipe_version: 'subordinate-graphic-background-v1', prominence: 'subordinate' },
      ...ids.map((id, index) => imageLayer(id, index + 1, index === 0 ? 'hero' : 'supporting')),
      { kind: 'pick_label', text: `PICK ${pick}` },
      { kind: 'display_name', text: name }, { kind: 'short_appeal', text: appeal },
      { kind: 'fact_badge', text: fact, verified_fact_ref: 'summary' },
      { kind: 'subtitle', cue_ids: [] },
    ]
    const scenes = [
      scene('hook', 'hook', 0, 4, [{ kind: 'background', recipe_version: 'subordinate-graphic-background-v1', prominence: 'subordinate' },
        { kind: 'hook_text', text: '毎日を軽くする3選' }, { kind: 'subtitle', cue_ids: [] }]),
      scene('product-1', 'product', 4, 10, productLayers(1, '車載ダストボックス', 'LED付きで夜間も使いやすい', '折りたたみ式', [assetIds[0]])),
      scene('product-2', 'product', 14, 10, productLayers(2, 'スマホホルダー', 'N56磁石でしっかり固定', 'N56磁石', assetIds.slice(0, 3))),
      scene('product-3', 'product', 24, 10, productLayers(3, '車載アロマ', '6種類の香りから選べる', '約2週間', assetIds.slice(2, 4))),
      scene('cta', 'cta', 34, 5, [{ kind: 'background', recipe_version: 'subordinate-graphic-background-v1', prominence: 'subordinate' },
        { kind: 'cta_text', text: '詳細をチェック' }, { kind: 'subtitle', cue_ids: [] }]),
    ]
    const cueScenes = [['hook', 0, 2], ['product-1', 4, 2], ['product-2', 14, 2],
      ['product-3', 24, 2], ['cta', 34, 3]]
    let audioIndex = 0
    const subtitleCues = cueScenes.flatMap(([sceneId, start, count]) => Array.from({ length: count }, (_, index) => {
      const artifactId = audioIds[audioIndex]
      const cue = { segment_id: `${sceneId}-${index + 1}`, scene_id: sceneId, text: `ナレーション${audioIndex + 1}`,
        start_seconds: start + 0.25 + index * 1.1, duration_seconds: 1,
        audio_artifact_id: artifactId, audio_object_key: `creative-audio/${uuid(9)}/${sceneId}-${index + 1}/${sha256(audioBytes)}.mp3`,
        audio_sha256: sha256(audioBytes) }
      audioIndex += 1
      return cue
    }))
    for (const current of scenes) {
      const subtitle = current.layers.find(layer => layer.kind === 'subtitle')
      subtitle.cue_ids = subtitleCues.filter(cue => cue.scene_id === current.id).map(cue => cue.segment_id)
    }
    const manifest = { manifest_version: MANIFEST_VERSION, archetype: ARCHETYPE, template_id: TEMPLATE_ID,
      layout_id: LAYOUT_ID, lineage: {}, output: { width: 1080, height: 1920, fps: 30, container: 'mp4',
        video_codec: 'h264', pixel_format: 'yuv420p', faststart: true, audio: true, duration_seconds: 39 },
      audio_mix: { narration: 'measured_segment_artifacts', sound_effects: 'template_timing',
        background_music: 'template_loop', bgm_ducking: { during_narration_db: -12, attack_ms: 120, release_ms: 280 } },
      scenes, subtitle_cues: subtitleCues }
    const composition = { id: uuid(1), campaignId: uuid(2), archetype: ARCHETYPE,
      provider: 'local_ffmpeg', providerVersion: 'local-shorts-composer-v2', renderManifest: manifest,
      assets: assetIds.map((id, index) => ({ id, immutableObjectKey: `asset-${index + 1}`,
        contentSha256: sha256(assetBytes[index]) })),
      audioAssets: audioIds.map(id => ({ id, immutableObjectKey: `audio-${id}`,
        contentSha256: sha256(audioBytes) })) }
    const store = { getFinalCompositionRequest: vi.fn(async () => composition), markFinalCompositionRendering: vi.fn(),
      persistFinalCompositionSuccess: vi.fn(), persistFinalCompositionFailure: vi.fn() }
    let savedBytes
    const compositionBlobStore = { provider: 'supabase-storage', bucket: 'revenue-lab-shorts-outputs',
      putImmutable: vi.fn(async (_key, bytes) => { savedBytes = bytes }) }
    const provider = createLocalFfmpegCompositionV2Provider({ ffmpegPath, ffprobePath, preset: 'ultrafast' })
    const handler = createJobHandlers({ store, youtube: {}, finalCompositionV2Provider: provider, compositionBlobStore,
      productAssetBlobStore: { readImmutable: vi.fn(async key => assetBytes[Number(key.at(-1)) - 1]) },
      creativeAudioBlobStore: { readImmutable: vi.fn(async () => audioBytes) } }).get('creative.compose.final')

    await expect(handler({ payload: { final_composition_request_id: composition.id } })).resolves.toMatchObject({ status: 'succeeded' })
    expect(compositionBlobStore.putImmutable).toHaveBeenCalledOnce()
    const [objectKey] = compositionBlobStore.putImmutable.mock.calls[0]
    expect(objectKey).toBe(`shorts-outputs/${composition.campaignId}/${sha256(savedBytes)}.mp4`)
    const outputPath = join(root, 'rendered.mp4')
    await writeFile(outputPath, savedBytes)
    const { stdout } = await execute(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', outputPath])
    const probe = JSON.parse(stdout)
    const video = probe.streams.find(stream => stream.codec_type === 'video')
    const audio = probe.streams.find(stream => stream.codec_type === 'audio')
    expect(video).toMatchObject({ codec_name: 'h264', width: 1080, height: 1920, pix_fmt: 'yuv420p' })
    expect(Number(video.avg_frame_rate.split('/')[0]) / Number(video.avg_frame_rate.split('/')[1])).toBeCloseTo(30, 3)
    expect(audio.codec_name).toBe('aac')
    expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(35)
    expect(Number(probe.format.duration)).toBeLessThanOrEqual(45)
    expect(savedBytes.indexOf(Buffer.from('moov'))).toBeGreaterThan(-1)
    expect(savedBytes.indexOf(Buffer.from('moov'))).toBeLessThan(savedBytes.indexOf(Buffer.from('mdat')))
    expect(store.persistFinalCompositionSuccess).toHaveBeenCalledWith(composition, expect.objectContaining({
      contentSha256: sha256(savedBytes), durationSeconds: expect.any(Number), pixelWidth: 1080, pixelHeight: 1920, fps: 30,
    }))
  }, 180_000)
})
