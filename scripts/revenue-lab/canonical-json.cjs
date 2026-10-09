'use strict'

const { createHash } = require('node:crypto')

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonicalize(item) ?? 'null').join(',')}]`
  const keys = Object.keys(value).filter(key => canonicalize(value[key]) !== undefined).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
}

function inputFingerprint(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex')
}

module.exports = { canonicalize, inputFingerprint }
