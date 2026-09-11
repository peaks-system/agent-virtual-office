'use strict'

const SENSITIVE_QUERY = /(token|api[-_]?key|secret|password|passwd|auth|credential|client[-_]?id)/i
const PRIVATE_KEY = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const QUERY_VALUE = /([?&](?:token|api[-_]?key|secret|password|passwd|auth|credential|client[-_]?id)=)([^&#\s"']+)/gi
const KEY_VALUE = /\b(token|api[-_]?key|secret|password|passwd|auth|credential|client[-_]?id)\s*([:=])\s*([^\s,;]+)/gi

function redactString(value) {
  let decoded = value
  try { decoded = decodeURIComponent(value) } catch {}
  if (/(?:["']?\b(?:[a-z_-]*token|api[-_]?key|[a-z_-]*secret|password|passwd|authorization|credential|client[-_]?id)["']?\s*[:=])|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}/i.test(decoded)) return '[認証情報らしい内容を除外しました]'
  return value
    .replace(PRIVATE_KEY, '[REDACTED PRIVATE KEY]')
    .replace(BEARER, 'Bearer [REDACTED]')
    .replace(JWT, '[REDACTED JWT]')
    .replace(QUERY_VALUE, '$1[REDACTED]')
    .replace(KEY_VALUE, '$1$2[REDACTED]')
}

function redactDiagnostics(value, seen = new WeakMap()) {
  if (typeof value === 'string') return redactString(value)
  if (value == null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
    const copy = []; seen.set(value, copy)
    for (const item of value) copy.push(redactDiagnostics(item, seen))
    return copy
  }
  const copy = {}; seen.set(value, copy)
  for (const [key, item] of Object.entries(value)) copy[key] = redactDiagnostics(item, seen)
  return copy
}

module.exports = { redactDiagnostics, redactString, SENSITIVE_QUERY }
