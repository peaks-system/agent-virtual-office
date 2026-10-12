'use strict'

const { createHash } = require('node:crypto')

const PROMPT_BUILDER_VERSION = 'product-i2v-identity-v1'

const POSITIVE_PROMPT = `[IDENTITY LOCK]
Use the exact product shown in the input image. Preserve every visible product detail exactly: shape, proportions, color, material appearance, logo position, labels, buttons, openings, and construction. Do not redesign or reinterpret it.

[FIXED PRODUCT]
The product remains completely stationary for the entire shot. Do not rotate, deform, open, close, articulate, or move any product part.

[CAMERA MOTION]
Use one slow, stable camera push-in only for five seconds. Keep the complete product centered, sharp, and fully recognizable.

[ALLOWED CHANGES]
Only camera distance, background parallax caused by that camera movement, and subtle environmental lighting may change.`

const NEGATIVE_PROMPT = `product motion, rotation, deformation, redesign, morphing, duplicated product, changed shape, changed proportions, changed color, changed material, changed logo, changed logo position, changed label, new label, generated text, changed button, changed opening, added part, missing part, crop of the product, camera shake, sudden zoom, watermark`

function buildProductIdentityPrompt() {
  const output = { version: PROMPT_BUILDER_VERSION, positivePrompt: POSITIVE_PROMPT, negativePrompt: NEGATIVE_PROMPT }
  return Object.freeze({ ...output, fingerprint: createHash('sha256').update(JSON.stringify(output)).digest('hex') })
}

module.exports = { NEGATIVE_PROMPT, POSITIVE_PROMPT, PROMPT_BUILDER_VERSION, buildProductIdentityPrompt }
