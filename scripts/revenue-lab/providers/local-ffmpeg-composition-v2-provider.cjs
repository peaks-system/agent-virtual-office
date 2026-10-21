'use strict'

const { createHash } = require('node:crypto')
const { execFile } = require('node:child_process')
const { existsSync, statSync } = require('node:fs')
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { promisify } = require('node:util')
const { FinalCompositionProvider, FinalCompositionProviderError } = require('../final-composition-provider.cjs')
const { ARCHETYPE, LAYOUT_ID, LEGACY_LAYOUT_ID, LEGACY_MANIFEST_VERSION,
  MANIFEST_VERSION, TEMPLATE_ID } = require('../multi-product-shorts-v2-schema.cjs')
const { COMPOSITION_VERSION } = require('../multi-product-shorts-v2-composition.cjs')

const PROVIDER_ID = 'local_ffmpeg'
const PROVIDER_VERSION = COMPOSITION_VERSION
const FRAME_RATE = 30
const QUALITY_LAYOUT = Object.freeze({
  safe: { left: 96, right: 984 },
  pick: { x: 96, y: 48, width: 888, height: 48 },
  displayName: { x: 96, y: 112, width: 888, height: 152 },
  card: { x: 120, y: 300, width: 840, height: 990 },
  shortAppeal: { x: 96, y: 1320, width: 888, height: 142 },
  factBadge: { x: 96, y: 1490, width: 888, height: 78 },
  subtitle: { x: 96, y: 1640, width: 888, height: 220 },
})
const EXEC_OPTIONS = Object.freeze({ windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 300_000 })
const DEFAULT_FONT_CANDIDATES = Object.freeze([
  'C:\\Windows\\Fonts\\YuGothB.ttc', 'C:\\Windows\\Fonts\\YuGothM.ttc',
  'C:\\Windows\\Fonts\\meiryob.ttc', 'C:\\Windows\\Fonts\\meiryo.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc',
])
const TEMPLATE_AUDIO_PROFILE = Object.freeze({
  id: 'hero-carousel-v2-synthetic-audio-v1', narrationGain: 1, bgmGain: 0.16,
  ducking: { threshold: 0.012, ratio: 8, attackMs: 120, releaseMs: 280 },
  effects: { hookImpactHz: 88, transitionNoiseColor: 'pink', factPopHz: 760, ctaChimeHz: 880 },
})

function sealed(code) { return new FinalCompositionProviderError(code, 'Creative Archetype v2 composition could not be completed') }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex') }
function rounded(value) { return Math.round(value * 1000) / 1000 }
function frameSeconds(value) { return Math.round(Number(value) * FRAME_RATE) / FRAME_RATE }
function isUsableFile(path) {
  try { return Boolean(path && existsSync(path) && statSync(path).isFile()) } catch { return false }
}
function resolveCompositionFont(requestedPath) {
  if (isUsableFile(requestedPath)) return requestedPath
  return DEFAULT_FONT_CANDIDATES.find(isUsableFile) || null
}
function rendererConfiguration({ ffmpegPath, ffprobePath, fontPath } = {}) {
  const resolvedFontPath = resolveCompositionFont(fontPath)
  const missing = []
  if (!isUsableFile(ffmpegPath)) missing.push('REVENUE_LAB_FFMPEG_PATH')
  if (!isUsableFile(ffprobePath)) missing.push('REVENUE_LAB_FFPROBE_PATH')
  if (!resolvedFontPath) missing.push('COMPOSITION_FONT_NOT_AVAILABLE')
  return { configured: missing.length === 0, missing, fontPath: resolvedFontPath }
}

function assertV2Manifest(manifest) {
  const output = manifest?.output
  const supportedLayout = (manifest?.manifest_version === MANIFEST_VERSION && manifest?.layout_id === LAYOUT_ID)
    || (manifest?.manifest_version === LEGACY_MANIFEST_VERSION && manifest?.layout_id === LEGACY_LAYOUT_ID)
  if (!supportedLayout || manifest?.archetype !== ARCHETYPE || manifest?.template_id !== TEMPLATE_ID
    || output?.width !== 1080 || output?.height !== 1920 || output?.fps !== FRAME_RATE
    || output?.container !== 'mp4' || output?.video_codec !== 'h264' || output?.pixel_format !== 'yuv420p'
    || output?.faststart !== true || output?.audio !== true || output?.duration_seconds < 35 || output?.duration_seconds > 45
    || !Array.isArray(manifest.scenes) || manifest.scenes.length !== 5
    || !Array.isArray(manifest.subtitle_cues) || manifest.product_cards) {
    throw sealed('COMPOSITION_V2_MANIFEST_INVALID')
  }
  const expectedKinds = ['hook', 'product', 'product', 'product', 'cta']
  let expectedStartFrames = 0
  for (const [index, scene] of manifest.scenes.entries()) {
    const startFrames = Number(scene.start_seconds) * FRAME_RATE
    const durationFrames = Number(scene.duration_seconds) * FRAME_RATE
    if (scene.kind !== expectedKinds[index] || !Array.isArray(scene.layers)
      || Math.abs(startFrames - expectedStartFrames) > 0.002
      || Math.abs(durationFrames - Math.round(durationFrames)) > 0.002) {
      throw sealed('COMPOSITION_V2_MANIFEST_INVALID')
    }
    expectedStartFrames += Math.round(durationFrames)
  }
  if (Math.abs(expectedStartFrames - Number(output.duration_seconds) * FRAME_RATE) > 0.002) throw sealed('COMPOSITION_V2_MANIFEST_INVALID')
}

function buildV2CompositionPlan(manifest) {
  assertV2Manifest(manifest)
  return {
    templateId: TEMPLATE_ID, layoutId: manifest.layout_id, manifestVersion: manifest.manifest_version,
    output: { ...manifest.output },
    scenes: manifest.scenes.map(scene => ({ id: scene.id, kind: scene.kind,
      start_seconds: scene.start_seconds, duration_seconds: scene.duration_seconds,
      transition: scene.transition, layers: scene.layers })),
    subtitleCues: manifest.subtitle_cues.map(cue => ({ ...cue })), audioMix: { ...manifest.audio_mix },
  }
}

function filterPath(path) { return String(path).replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'") }
function wrapText(value, width, lines = 2) {
  const chars = Array.from(String(value || '').replace(/\s+/g, ' ').trim())
  if (chars.length <= width) return chars.join('')
  return Array.from({ length: lines }, (_, index) => chars.slice(index * width, (index + 1) * width).join(''))
    .filter(Boolean).join('\n')
}
function selectQualityAssets(assets, duration) {
  return assets.slice(0, Math.max(1, Math.min(assets.length, Math.floor(Number(duration) / 3))))
}
async function fitMeasuredText({ text, maxWidth, maxLines, maxFontSize, minFontSize, measure }) {
  const characters = Array.from(String(text || '').replace(/\s+/g, ' ').trim())
  if (!characters.length || characters.length > 80) throw sealed('COMPOSITION_V2_TEXT_FIT_INVALID')
  const sizes = []
  for (let size = maxFontSize; size >= minFontSize; size -= 2) sizes.push(size)
  for (const fontSize of sizes) {
    const splits = maxLines === 1 ? [[]] : Array.from({ length: characters.length - 1 }, (_, index) => index + 1)
      .sort((a, b) => Math.abs(a - characters.length / 2) - Math.abs(b - characters.length / 2))
      .map(index => [characters.slice(0, index).join(''), characters.slice(index).join('')])
    const candidates = characters.length === 1 || maxLines === 1
      ? [[characters.join('')]] : [[characters.join('')], ...splits]
    for (const lines of candidates) {
      if (lines.length > maxLines || lines.some(line => !line)) continue
      const measured = []
      for (const line of lines) measured.push({ text: line, ...(await measure(line, fontSize)) })
      if (measured.every(line => Number(line.width) <= maxWidth)) return { fontSize, lines: measured }
    }
  }
  throw sealed('COMPOSITION_V2_TEXT_FIT_INVALID')
}

async function measureFfmpegText({ ffmpegPath, execute, fontPath, root, name, text, fontSize }) {
  const textPath = join(root, `${name}-measure.txt`)
  await writeFile(textPath, text, 'utf8')
  const { stderr } = await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'debug', '-f', 'lavfi',
    '-i', 'color=c=black:s=1080x1920:r=1:d=0.04', '-vf', `drawtext=fontfile='${filterPath(fontPath)}':textfile='${filterPath(textPath)}':fontsize=${fontSize}`,
    '-frames:v', '1', '-f', 'null', '-'], EXEC_OPTIONS)
  const matches = [...String(stderr || '').matchAll(/text_w:(\d+)\s+text_h:(\d+)/g)]
  const match = matches.at(-1)
  if (match) return { width: Number(match[1]), height: Number(match[2]) }
  const shaped = [...String(stderr || '').matchAll(/width64:\s*(\d+)/g)].at(-1)
  if (!shaped) throw sealed('COMPOSITION_V2_TEXT_MEASURE_FAILED')
  return { width: Number(shaped[1]) / 64, height: fontSize }
}
function fpsValue(stream) {
  const [numerator, denominator] = String(stream?.avg_frame_rate || stream?.r_frame_rate || '0/1').split('/').map(Number)
  return denominator ? numerator / denominator : 0
}

async function probeFile(ffprobePath, path, execute) {
  const { stdout } = await execute(ffprobePath,
    ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], EXEC_OPTIONS)
  return JSON.parse(stdout)
}

function inspectV2Output(probe, expectedDuration) {
  const streams = Array.isArray(probe?.streams) ? probe.streams : []
  const video = streams.find(stream => stream.codec_type === 'video')
  const audio = streams.find(stream => stream.codec_type === 'audio')
  const duration = Number(probe?.format?.duration ?? video?.duration ?? audio?.duration)
  const fps = fpsValue(video)
  if (!video || !audio || video.codec_name !== 'h264' || audio.codec_name !== 'aac'
    || video.width !== 1080 || video.height !== 1920 || video.pix_fmt !== 'yuv420p'
    || Math.abs(fps - FRAME_RATE) > 0.01 || !Number.isFinite(duration)
    || duration < 35 || duration > 45 || Math.abs(duration - expectedDuration) > 0.12) {
    throw sealed('COMPOSITION_V2_OUTPUT_INVALID')
  }
  return { durationSeconds: rounded(duration), pixelWidth: video.width, pixelHeight: video.height,
    fps: rounded(fps), videoCodec: video.codec_name, audioCodec: audio.codec_name }
}

async function addTextFilter({ filters, input, root, fontPath, name, text, width, fontSize, y,
  color = 'white', boxColor = 'black@0.58', enable, animationStart }) {
  const textPath = join(root, `${name}.txt`)
  await writeFile(textPath, wrapText(text, width), 'utf8')
  const output = `${name}-out`
  const options = [`fontfile='${filterPath(fontPath)}'`, `textfile='${filterPath(textPath)}'`,
    `fontsize=${fontSize}`, `fontcolor=${color}`, 'line_spacing=14', 'x=(w-text_w)/2', `y=${y}`,
    'box=1', `boxcolor=${boxColor}`, 'boxborderw=22']
  if (enable) options.push(`enable='${enable}'`)
  if (Number.isFinite(animationStart)) options.push(`alpha='if(lt(t\\,${animationStart})\\,0\\,if(lt(t\\,${animationStart + 0.25})\\,(t-${animationStart})/0.25\\,1))'`)
  filters.push(`[${input}]drawtext=${options.join(':')}[${output}]`)
  return output
}

async function renderScene({ ffmpegPath, execute, fontPath, preset, root, plan, scene, assets }) {
  const duration = frameSeconds(scene.duration_seconds)
  const frames = Math.round(duration * FRAME_RATE)
  const outputPath = join(root, `scene-${scene.id}.mp4`)
  const inputs = ['-f', 'lavfi', '-i', `color=c=0x0b1220:s=1080x1920:r=${FRAME_RATE}:d=${duration}`]
  const filters = ['[0:v]format=yuv420p,drawbox=x=0:y=0:w=iw:h=220:color=0x111827@0.82:t=fill,drawbox=x=0:y=1450:w=iw:h=470:color=0x111827@0.88:t=fill[base]']
  let current = 'base'
  const imageLayers = scene.layers.filter(layer => layer.kind === 'product_image').sort((a, b) => a.asset_order - b.asset_order)
  if (scene.kind === 'product') {
    if (imageLayers.length < 1 || imageLayers.length > 4) throw sealed('COMPOSITION_V2_ASSET_INVALID')
    const crossfade = 0.35
    const clipDuration = (duration + (imageLayers.length - 1) * crossfade) / imageLayers.length
    const clipFrames = Math.ceil(clipDuration * FRAME_RATE)
    for (const [index, layer] of imageLayers.entries()) {
      const bytes = assets?.get(layer.product_asset_revision_id)
      if (!Buffer.isBuffer(bytes) || sha256(bytes) !== layer.content_sha256) throw sealed('COMPOSITION_V2_ASSET_HASH_MISMATCH')
      const assetPath = join(root, `asset-${scene.id}-${index + 1}.img`)
      await writeFile(assetPath, bytes)
      inputs.push('-i', assetPath)
      const drift = index % 2 === 0 ? '8*sin(on/38)' : '-8*sin(on/38)'
      filters.push(`[${index + 1}:v]scale=960:1120:force_original_aspect_ratio=decrease,`
        + `pad=960:1120:(ow-iw)/2:(oh-ih)/2:color=0xf8fafc,`
        + `zoompan=z='min(zoom+0.00035,1.045)':x='iw/2-(iw/zoom/2)+${drift}':y='ih/2-(ih/zoom/2)':`
        + `d=${clipFrames}:s=960x1120:fps=${FRAME_RATE},trim=duration=${clipDuration},setpts=PTS-STARTPTS,format=yuv420p[image-${index}]`)
    }
    let carousel = 'image-0'
    for (let index = 1; index < imageLayers.length; index += 1) {
      const output = `carousel-${index}`
      const offset = rounded(index * (clipDuration - crossfade))
      filters.push(`[${carousel}][image-${index}]xfade=transition=fade:duration=${crossfade}:offset=${offset}[${output}]`)
      carousel = output
    }
    filters.push(`[base][${carousel}]overlay=x=60:y=260:eof_action=pass:shortest=0,trim=duration=${duration},setpts=PTS-STARTPTS[with-image]`)
    current = 'with-image'
    const displayName = scene.layers.find(layer => layer.kind === 'display_name')?.text
    const shortAppeal = scene.layers.find(layer => layer.kind === 'short_appeal')?.text
    const factBadge = scene.layers.find(layer => layer.kind === 'fact_badge')?.text
    if (!displayName || !shortAppeal || !factBadge) throw sealed('COMPOSITION_V2_TEXT_LAYER_INVALID')
    current = await addTextFilter({ filters, input: current, root, fontPath, name: `${scene.id}-name`,
      text: displayName, width: 18, fontSize: 72, y: 82, boxColor: '0x0f172a@0.74', animationStart: 0.1 })
    current = await addTextFilter({ filters, input: current, root, fontPath, name: `${scene.id}-appeal`,
      text: shortAppeal, width: 20, fontSize: 58, y: 1435, boxColor: '0x0f172a@0.76', animationStart: 0.4 })
    current = await addTextFilter({ filters, input: current, root, fontPath, name: `${scene.id}-fact`,
      text: factBadge, width: 18, fontSize: 44, y: 1555, boxColor: '0x047857@0.9', animationStart: 0.85 })
  } else {
    const kind = scene.kind === 'hook' ? 'hook_text' : 'cta_text'
    const text = scene.layers.find(layer => layer.kind === kind)?.text
    if (!text) throw sealed('COMPOSITION_V2_TEXT_LAYER_INVALID')
    current = await addTextFilter({ filters, input: current, root, fontPath, name: `${scene.id}-title`,
      text, width: 12, fontSize: scene.kind === 'hook' ? 94 : 86, y: 600,
      boxColor: '0x0f172a@0.72', animationStart: 0.2 })
  }
  const cueIds = new Set(scene.layers.find(layer => layer.kind === 'subtitle')?.cue_ids || [])
  const cues = plan.subtitleCues.filter(cue => cueIds.has(cue.segment_id))
  for (const [index, cue] of cues.entries()) {
    const localStart = rounded(Number(cue.start_seconds) - Number(scene.start_seconds))
    const localEnd = rounded(localStart + Number(cue.duration_seconds))
    if (localStart < 0 || localEnd > duration + 0.1) throw sealed('COMPOSITION_V2_SUBTITLE_TIMING_INVALID')
    current = await addTextFilter({ filters, input: current, root, fontPath, name: `${scene.id}-subtitle-${index + 1}`,
      text: cue.text, width: 21, fontSize: 48, y: 1710, boxColor: 'black@0.78',
      enable: `between(t\\,${localStart}\\,${localEnd})` })
  }
  filters.push(`[${current}]fade=t=in:st=0:d=0.18,fade=t=out:st=${Math.max(0, duration - 0.18)}:d=0.18,`
    + `trim=duration=${duration},setpts=PTS-STARTPTS[vout]`)
  await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', filters.join(';'), '-map', '[vout]', '-an', '-r', String(FRAME_RATE), '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', preset, '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath], EXEC_OPTIONS)
  return outputPath
}

async function addQualityTextFilter({ ffmpegPath, execute, filters, input, root, fontPath, name, text,
  region, maxLines, maxFontSize, minFontSize, color = 'white', boxColor = 'black@0.58', enable, animationStart }) {
  let measureIndex = 0
  const fitted = await fitMeasuredText({ text, maxWidth: region.width - 32, maxLines, maxFontSize, minFontSize,
    measure: (line, fontSize) => measureFfmpegText({ ffmpegPath, execute, fontPath, root,
      name: `${name}-${measureIndex += 1}`, text: line, fontSize }) })
  const textPath = join(root, `${name}.txt`)
  await writeFile(textPath, fitted.lines.map(line => line.text).join('\n'), 'utf8')
  const output = `${name}-out`
  const options = [`fontfile='${filterPath(fontPath)}'`, `textfile='${filterPath(textPath)}'`,
    `fontsize=${fitted.fontSize}`, `fontcolor=${color}`, 'line_spacing=8', 'x=(w-text_w)/2', `y=${region.y}`,
    'box=1', `boxcolor=${boxColor}`, 'boxborderw=16']
  if (enable) options.push(`enable='${enable}'`)
  if (Number.isFinite(animationStart)) options.push(`alpha='if(lt(t\\,${animationStart})\\,0\\,if(lt(t\\,${animationStart + 0.25})\\,(t-${animationStart})/0.25\\,1))'`)
  filters.push(`[${input}]drawtext=${options.join(':')}[${output}]`)
  return output
}

async function renderQualityScene({ ffmpegPath, execute, fontPath, preset, root, plan, scene, assets }) {
  const duration = frameSeconds(scene.duration_seconds); const frames = Math.round(duration * FRAME_RATE)
  const outputPath = join(root, `scene-${scene.id}.mp4`)
  const inputs = ['-f', 'lavfi', '-i', `color=c=0xe8edf2:s=1080x1920:r=${FRAME_RATE}:d=${duration}`]
  const cardFilter = scene.kind === 'product'
    ? `,drawbox=x=${QUALITY_LAYOUT.card.x}:y=${QUALITY_LAYOUT.card.y}:w=${QUALITY_LAYOUT.card.width}:h=${QUALITY_LAYOUT.card.height}:color=white@1:t=fill` : ''
  const filters = [`[0:v]format=yuv420p,drawbox=x=0:y=0:w=iw:h=280:color=0x111827@0.96:t=fill,`
    + `drawbox=x=0:y=1600:w=iw:h=320:color=0x111827@0.96:t=fill${cardFilter}[base]`]
  let current = 'base'
  if (scene.kind === 'product') {
    const allImages = scene.layers.filter(layer => layer.kind === 'product_image').sort((a, b) => a.asset_order - b.asset_order)
    const imageLayers = selectQualityAssets(allImages, duration)
    if (imageLayers.length < 1) throw sealed('COMPOSITION_V2_ASSET_INVALID')
    const crossfade = 0.2; const clipDuration = (duration + (imageLayers.length - 1) * crossfade) / imageLayers.length
    const clipFrames = Math.ceil(clipDuration * FRAME_RATE)
    for (const [index, layer] of imageLayers.entries()) {
      const bytes = assets?.get(layer.product_asset_revision_id)
      if (!Buffer.isBuffer(bytes) || sha256(bytes) !== layer.content_sha256) throw sealed('COMPOSITION_V2_ASSET_HASH_MISMATCH')
      const assetPath = join(root, `asset-${scene.id}-${index + 1}.img`); await writeFile(assetPath, bytes); inputs.push('-i', assetPath)
      const totalFrames = imageLayers.length === 1 ? frames : clipFrames
      const zoom = `1+0.035*on/${Math.max(1, totalFrames - 1)}`
      const drift = index % 2 === 0 ? `6*sin(PI*on/${Math.max(1, totalFrames - 1)})` : `-6*sin(PI*on/${Math.max(1, totalFrames - 1)})`
      filters.push(`[${index + 1}:v]scale=${QUALITY_LAYOUT.card.width}:${QUALITY_LAYOUT.card.height}:force_original_aspect_ratio=decrease,`
        + `pad=${QUALITY_LAYOUT.card.width}:${QUALITY_LAYOUT.card.height}:(ow-iw)/2:(oh-ih)/2:color=white,`
        + `zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)+${drift}':y='ih/2-(ih/zoom/2)':`
        + `d=${totalFrames}:s=${QUALITY_LAYOUT.card.width}x${QUALITY_LAYOUT.card.height}:fps=${FRAME_RATE},`
        + `trim=duration=${clipDuration},setpts=PTS-STARTPTS,format=yuv420p[quality-image-${index}]`)
    }
    let carousel = 'quality-image-0'
    for (let index = 1; index < imageLayers.length; index += 1) {
      const output = `quality-carousel-${index}`; const offset = rounded(index * (clipDuration - crossfade))
      filters.push(`[${carousel}][quality-image-${index}]xfade=transition=slideleft:duration=${crossfade}:offset=${offset}[${output}]`); carousel = output
    }
    filters.push(`[base][${carousel}]overlay=x=${QUALITY_LAYOUT.card.x}:y=${QUALITY_LAYOUT.card.y}:eof_action=pass:shortest=0,`
      + `trim=duration=${duration},setpts=PTS-STARTPTS[with-quality-image]`); current = 'with-quality-image'
    const layerText = kind => scene.layers.find(layer => layer.kind === kind)?.text
    const pick = layerText('pick_label'); const name = layerText('display_name')
    const appeal = layerText('short_appeal'); const fact = layerText('fact_badge')
    if (!pick || !name || !appeal || !fact) throw sealed('COMPOSITION_V2_TEXT_LAYER_INVALID')
    current = await addQualityTextFilter({ ffmpegPath, execute, filters, input: current, root, fontPath,
      name: `${scene.id}-pick`, text: pick, region: QUALITY_LAYOUT.pick, maxLines: 1,
      maxFontSize: 32, minFontSize: 28, color: '0x94a3b8', boxColor: 'black@0', animationStart: 0.05 })
    current = await addQualityTextFilter({ ffmpegPath, execute, filters, input: current, root, fontPath,
      name: `${scene.id}-name`, text: name, region: QUALITY_LAYOUT.displayName, maxLines: 2,
      maxFontSize: 64, minFontSize: 56, boxColor: '0x0f172a@0.72', animationStart: 0.1 })
    current = await addQualityTextFilter({ ffmpegPath, execute, filters, input: current, root, fontPath,
      name: `${scene.id}-appeal`, text: appeal, region: QUALITY_LAYOUT.shortAppeal, maxLines: 2,
      maxFontSize: 52, minFontSize: 42, color: '0x0f172a', boxColor: 'white@0.9', animationStart: 0.35 })
    current = await addQualityTextFilter({ ffmpegPath, execute, filters, input: current, root, fontPath,
      name: `${scene.id}-fact`, text: fact, region: QUALITY_LAYOUT.factBadge, maxLines: 1,
      maxFontSize: 42, minFontSize: 34, boxColor: '0x047857@0.92', animationStart: 0.75 })
  } else {
    const kind = scene.kind === 'hook' ? 'hook_text' : 'cta_text'; const text = scene.layers.find(layer => layer.kind === kind)?.text
    if (!text) throw sealed('COMPOSITION_V2_TEXT_LAYER_INVALID')
    current = await addQualityTextFilter({ ffmpegPath, execute, filters, input: current, root, fontPath,
      name: `${scene.id}-title`, text, region: { ...QUALITY_LAYOUT.safe, x: 96, y: 650, width: 888, height: 240 },
      maxLines: 2, maxFontSize: scene.kind === 'hook' ? 86 : 76, minFontSize: 52,
      boxColor: '0x0f172a@0.74', animationStart: 0.2 })
  }
  const cueIds = new Set(scene.layers.find(layer => layer.kind === 'subtitle')?.cue_ids || [])
  const cues = plan.subtitleCues.filter(cue => cueIds.has(cue.segment_id))
  for (const [index, cue] of cues.entries()) {
    const localStart = rounded(Number(cue.start_seconds) - Number(scene.start_seconds)); const localEnd = rounded(localStart + Number(cue.duration_seconds))
    if (localStart < 0 || localEnd > duration + 0.1) throw sealed('COMPOSITION_V2_SUBTITLE_TIMING_INVALID')
    current = await addQualityTextFilter({ ffmpegPath, execute, filters, input: current, root, fontPath,
      name: `${scene.id}-subtitle-${index + 1}`, text: cue.text, region: QUALITY_LAYOUT.subtitle,
      maxLines: 2, maxFontSize: 46, minFontSize: 36, boxColor: 'black@0.78',
      enable: `between(t\\,${localStart}\\,${localEnd})` })
  }
  filters.push(`[${current}]fade=t=in:st=0:d=0.18,fade=t=out:st=${Math.max(0, duration - 0.18)}:d=0.18,`
    + `trim=duration=${duration},setpts=PTS-STARTPTS[vout]`)
  await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'),
    '-map', '[vout]', '-an', '-r', String(FRAME_RATE), '-frames:v', String(frames), '-c:v', 'libx264', '-preset', preset,
    '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath], EXEC_OPTIONS)
  return outputPath
}

async function prepareNarration({ ffprobePath, execute, root, plan, audioAssets }) {
  const filesBySha = new Map()
  const narration = []
  for (const [index, cue] of plan.subtitleCues.entries()) {
    const bytes = audioAssets?.get(cue.audio_artifact_id)
    if (!Buffer.isBuffer(bytes) || sha256(bytes) !== cue.audio_sha256) throw sealed('COMPOSITION_V2_AUDIO_HASH_MISMATCH')
    let record = filesBySha.get(cue.audio_sha256)
    if (!record) {
      const path = join(root, `narration-${filesBySha.size + 1}.mp3`)
      await writeFile(path, bytes)
      const probe = await probeFile(ffprobePath, path, execute)
      const audio = probe.streams?.find(stream => stream.codec_type === 'audio')
      const duration = Number(probe.format?.duration ?? audio?.duration)
      if (!audio || !(duration > 0)) throw sealed('COMPOSITION_V2_AUDIO_INVALID')
      record = { path, duration: rounded(duration) }
      filesBySha.set(cue.audio_sha256, record)
    }
    if (Math.abs(record.duration - Number(cue.duration_seconds)) > 0.15) throw sealed('COMPOSITION_V2_AUDIO_DURATION_MISMATCH')
    const scene = plan.scenes.find(item => item.id === cue.scene_id)
    if (!scene || Number(cue.start_seconds) + record.duration > Number(scene.start_seconds) + Number(scene.duration_seconds) + 0.02) {
      throw sealed('COMPOSITION_V2_AUDIO_TIMING_INVALID')
    }
    narration.push({ ...cue, path: record.path, measuredDuration: record.duration, inputIndex: index + 1 })
  }
  if (!narration.length || new Set(narration.map(item => item.audio_artifact_id)).size !== narration.length) {
    throw sealed('COMPOSITION_V2_AUDIO_INVALID')
  }
  return narration
}

function syntheticEffectFilters(plan) {
  const events = [{ role: 'impact', at: 0.05, source: `sine=f=${TEMPLATE_AUDIO_PROFILE.effects.hookImpactHz}:d=0.28:r=48000`, gain: 0.42 }]
  for (const scene of plan.scenes.filter(item => item.kind === 'product')) {
    events.push({ role: 'whoosh', at: scene.start_seconds, source: `anoisesrc=color=${TEMPLATE_AUDIO_PROFILE.effects.transitionNoiseColor}:d=0.34:r=48000`, gain: 0.08 })
    events.push({ role: 'pop', at: scene.start_seconds + 1.1, source: `sine=f=${TEMPLATE_AUDIO_PROFILE.effects.factPopHz}:d=0.12:r=48000`, gain: 0.18 })
  }
  const cta = plan.scenes.find(item => item.kind === 'cta')
  events.push({ role: 'chime', at: cta.start_seconds + 0.1, source: `sine=f=${TEMPLATE_AUDIO_PROFILE.effects.ctaChimeHz}:d=0.45:r=48000`, gain: 0.22 })
  const filters = []; const labels = []
  events.forEach((event, index) => {
    const label = `sfx-${index}`; const delay = Math.max(0, Math.round(event.at * 1000))
    const shaping = event.role === 'whoosh' ? ',highpass=f=350,lowpass=f=3200' : ''
    filters.push(`${event.source}${shaping},afade=t=out:st=0.05:d=0.25,volume=${event.gain},adelay=${delay}:all=1[${label}]`)
    labels.push(label)
  })
  return { filters, labels }
}

async function mixAudio({ ffmpegPath, execute, root, plan, silentVideoPath, narration }) {
  const outputPath = join(root, 'hero-carousel-v2.mp4')
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', silentVideoPath]
  narration.forEach(item => args.push('-i', item.path))
  const filters = []
  const narrationLabels = narration.map((item, index) => {
    const label = `narration-${index}`; const delay = Math.round(Number(item.start_seconds) * 1000)
    filters.push(`[${index + 1}:a]atrim=start=0:end=${item.measuredDuration},asetpts=PTS-STARTPTS,aresample=48000,`
      + `volume=${TEMPLATE_AUDIO_PROFILE.narrationGain},adelay=${delay}:all=1[${label}]`)
    return label
  })
  filters.push(`${narrationLabels.map(label => `[${label}]`).join('')}amix=inputs=${narrationLabels.length}:duration=longest:normalize=0,asplit=2[narration-main][narration-side]`)
  const duration = Number(plan.output.duration_seconds)
  filters.push(`aevalsrc='0.035*sin(2*PI*110*t)+0.018*sin(2*PI*165*t)':s=48000:d=${duration},volume=${TEMPLATE_AUDIO_PROFILE.bgmGain}[bgm]`)
  filters.push(`[bgm][narration-side]sidechaincompress=threshold=${TEMPLATE_AUDIO_PROFILE.ducking.threshold}:`
    + `ratio=${TEMPLATE_AUDIO_PROFILE.ducking.ratio}:attack=${TEMPLATE_AUDIO_PROFILE.ducking.attackMs}:`
    + `release=${TEMPLATE_AUDIO_PROFILE.ducking.releaseMs}[ducked-bgm]`)
  const effects = syntheticEffectFilters(plan)
  filters.push(...effects.filters)
  const mixInputs = ['ducked-bgm', 'narration-main', ...effects.labels]
  filters.push(`${mixInputs.map(label => `[${label}]`).join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0,`
    + `alimiter=limit=0.95,atrim=duration=${duration},aformat=sample_rates=48000:channel_layouts=stereo[aout]`)
  await execute(ffmpegPath, [...args, '-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2', '-t', String(duration),
    '-movflags', '+faststart', outputPath], EXEC_OPTIONS)
  return outputPath
}

async function renderWithFfmpeg(plan, { assets, audioAssets }, {
  ffmpegPath, ffprobePath, fontPath, preset, execute,
}) {
  const root = await mkdtemp(join(tmpdir(), 'revenue-lab-v2-composition-'))
  try {
    const narration = await prepareNarration({ ffprobePath, execute, root, plan, audioAssets })
    const scenePaths = []
    const sceneRenderer = plan.layoutId === LAYOUT_ID ? renderQualityScene : renderScene
    for (const scene of plan.scenes) scenePaths.push(await sceneRenderer({
      ffmpegPath, execute, fontPath, preset, root, plan, scene, assets,
    }))
    const concatPath = join(root, 'scenes.txt')
    await writeFile(concatPath, scenePaths.map(path => `file '${path.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`).join('\n'), 'utf8')
    const silentVideoPath = join(root, 'silent-video.mp4')
    await execute(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
      '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', silentVideoPath], EXEC_OPTIONS)
    const outputPath = await mixAudio({ ffmpegPath, execute, root, plan, silentVideoPath, narration })
    const probe = await probeFile(ffprobePath, outputPath, execute)
    const inspected = inspectV2Output(probe, Number(plan.output.duration_seconds))
    return { bytes: await readFile(outputPath), ...inspected, contentType: 'video/mp4',
      templateAudioProfile: TEMPLATE_AUDIO_PROFILE.id }
  } finally { await rm(root, { recursive: true, force: true }) }
}

function createLocalFfmpegCompositionV2Provider({ renderImpl, ffmpegPath, ffprobePath, fontPath,
  preset = 'veryfast', execFileImpl = execFile } = {}) {
  const execute = promisify(execFileImpl)
  const configuration = rendererConfiguration({ ffmpegPath, ffprobePath, fontPath })
  class LocalV2Provider extends FinalCompositionProvider {
    constructor() { super({ id: PROVIDER_ID, version: PROVIDER_VERSION }); this.configured = typeof renderImpl === 'function' || configuration.configured }
    async render({ manifest, assets, audioAssets }) {
      const plan = buildV2CompositionPlan(manifest)
      const renderer = renderImpl || (configuration.configured
        ? (renderPlan, inputs) => renderWithFfmpeg(renderPlan, inputs, {
          ffmpegPath, ffprobePath, fontPath: configuration.fontPath, preset, execute,
        }) : null)
      if (!renderer) throw sealed('COMPOSITION_V2_RENDERER_NOT_CONFIGURED')
      try { return await renderer(plan, { assets, audioAssets }) }
      catch (error) {
        if (error instanceof FinalCompositionProviderError) throw error
        throw sealed('COMPOSITION_V2_RENDER_FAILED')
      }
    }
    normalizeError(error) { return error instanceof FinalCompositionProviderError ? error : sealed() }
  }
  return new LocalV2Provider()
}

module.exports = { PROVIDER_ID, PROVIDER_VERSION, QUALITY_LAYOUT, TEMPLATE_AUDIO_PROFILE, assertV2Manifest,
  buildV2CompositionPlan, createLocalFfmpegCompositionV2Provider, fitMeasuredText, inspectV2Output,
  rendererConfiguration, resolveCompositionFont, selectQualityAssets }
