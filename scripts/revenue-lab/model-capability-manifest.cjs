'use strict'

const CAPABILITY = Object.freeze({
  SUPPORTED: 'SUPPORTED',
  UNSUPPORTED: 'UNSUPPORTED',
  UNDOCUMENTED: 'UNDOCUMENTED',
})

const REQUIRED_CAPABILITIES = Object.freeze([
  'supportsImageToVideo', 'supportsNegativePrompt', 'supportsTailFrame', 'supportsMovementAmplitude',
])

class ModelCapabilityError extends Error {
  constructor(code, message, field = null) {
    super(message)
    this.name = 'ModelCapabilityError'
    this.code = code
    this.field = field
  }
}

function freezeManifest(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Model capability manifest is required')
  for (const name of REQUIRED_CAPABILITIES) {
    if (!Object.values(CAPABILITY).includes(value[name])) throw new TypeError(`Invalid capability state: ${name}`)
  }
  if (!Array.isArray(value.supportedDurations) || !Array.isArray(value.supportedResolutions)) {
    throw new TypeError('Model duration and resolution capabilities are required')
  }
  return Object.freeze({ ...value,
    supportedDurations: Object.freeze([...value.supportedDurations]),
    supportedResolutions: Object.freeze([...value.supportedResolutions]),
  })
}

function requireCapability(manifest, name) {
  const state = manifest?.[name]
  if (state === CAPABILITY.SUPPORTED) return
  const code = state === CAPABILITY.UNDOCUMENTED ? 'VIDEO_CAPABILITY_UNDOCUMENTED' : 'VIDEO_CAPABILITY_UNSUPPORTED'
  throw new ModelCapabilityError(code, `Requested model capability is not supported: ${name}`, name)
}

function validateImageToVideoRequest(request, manifest) {
  if (request?.generationMode !== 'image_to_video') throw new ModelCapabilityError('VIDEO_GENERATION_MODE_UNSUPPORTED', 'Image-to-video request required', 'generationMode')
  requireCapability(manifest, 'supportsImageToVideo')
  if (request.negativePrompt) requireCapability(manifest, 'supportsNegativePrompt')
  if (request.tailImage) requireCapability(manifest, 'supportsTailFrame')
  if (request.movementAmplitude) requireCapability(manifest, 'supportsMovementAmplitude')
  if (!manifest.supportedDurations.includes(request.durationSeconds)) {
    throw new ModelCapabilityError('VIDEO_DURATION_UNSUPPORTED', 'Requested duration is not documented for the model', 'durationSeconds')
  }
  if (!manifest.supportedResolutions.includes(request.resolution)) {
    throw new ModelCapabilityError('VIDEO_RESOLUTION_UNSUPPORTED', 'Requested resolution is not documented for the model', 'resolution')
  }
  if (request.aspectRatio !== '9:16' || request.audioEnabled !== false) {
    throw new ModelCapabilityError('VIDEO_OUTPUT_CONTRACT_UNSUPPORTED', 'Phase v1 requires 9:16 and audio disabled')
  }
  const image = request.inputImage
  if (!image || typeof image.temporaryUrl !== 'string' || !/^https:\/\//.test(image.temporaryUrl)
    || !/^[0-9a-f]{64}$/.test(image.contentSha256 || '') || image.pixelWidth * 16 !== image.pixelHeight * 9) {
    throw new ModelCapabilityError('VIDEO_INPUT_REVISION_INVALID', 'A verified 9:16 immutable image revision is required', 'inputImage')
  }
  return request
}

module.exports = { CAPABILITY, ModelCapabilityError, freezeManifest, requireCapability, validateImageToVideoRequest }
