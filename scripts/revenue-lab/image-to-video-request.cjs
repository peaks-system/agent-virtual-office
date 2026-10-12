'use strict'

const { validateImageToVideoRequest } = require('./model-capability-manifest.cjs')

function createImageToVideoRequest(value, manifest) {
  const request = Object.freeze({
    generationMode: 'image_to_video',
    prompt: String(value?.prompt || ''),
    negativePrompt: String(value?.negativePrompt || ''),
    promptBuilderVersion: String(value?.promptBuilderVersion || ''),
    inputImage: Object.freeze({ ...value?.inputImage }),
    durationSeconds: Number(value?.durationSeconds),
    resolution: String(value?.resolution || ''),
    aspectRatio: String(value?.aspectRatio || ''),
    audioEnabled: value?.audioEnabled,
  })
  if (!request.prompt.trim() || !request.negativePrompt.trim() || !request.promptBuilderVersion) {
    throw new TypeError('Image-to-video prompt contract is incomplete')
  }
  return validateImageToVideoRequest(request, manifest)
}

module.exports = { createImageToVideoRequest }
