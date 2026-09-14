'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { normalizeSiteUrl } = require('./seo-crawler.cjs')
const { redactString } = require('./seo-redaction.cjs')
const { siteCovers } = require('./search-console-property.cjs')
const CATEGORIES = ['unclassified', 'general', 'restricted']
const restrictedHost = value => { try { const h = new URL(value).hostname; return h === 'school-jk-style.com' || h.endsWith('.school-jk-style.com') } catch { return false } }
const error = message => { throw Object.assign(new Error(message), { code: 'SITE_POLICY' }) }
function createSitePolicy(root) {
  const directory = path.join(root, '.office-work', 'sites')
  function file(id) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id || '')) error('プロジェクトIDを確認してください。')
    for (const dir of [path.join(root, '.office-work'), directory]) { if (!fs.existsSync(dir)) fs.mkdirSync(dir); if (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory()) error('設定保存先を確認してください。') }
    return path.join(directory, `${id}.json`)
  }
  function json(file) { if (!fs.existsSync(file)) return null; if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 2000000) error('設定ファイルを確認してください。'); return JSON.parse(fs.readFileSync(file, 'utf8')) }
  function read(id) {
    const saved = json(file(id))
    if (saved) return saved
    const legacy = json(path.join(root, '.office-work', 'seo', `${id}.json`))
    const siteUrl = legacy?.siteUrl ? new URL(legacy.siteUrl).origin : ''
    const category = restrictedHost(siteUrl) ? 'restricted' : 'unclassified'
    return { siteName: '', siteUrl, category, permissions: { diagnosis: true, ai: category === 'restricted', draft: category === 'restricted' }, property: siteCovers(legacy?.google?.property, siteUrl + '/') ? legacy.google.property : '', publication: 'manual', model: 'gpt-5.6-terra', reasoningEffort: 'medium', scheduled: false, revision: 0, history: [] }
  }
  function update(id, body) {
    const old = read(id)
    if (body.confirmed !== true || body.revision !== old.revision) error('変更内容を確認してチェックを入れ、最新の設定で保存してください。')
    if (!CATEGORIES.includes(body.category)) error('サイトカテゴリを選択してください。')
    let siteUrl = ''
    try { siteUrl = new URL(normalizeSiteUrl(body.siteUrl)).origin } catch { error('公開サイトのURLを入力してください。内部アドレスは登録できません。') }
    if (old.siteUrl && siteUrl !== old.siteUrl) error('別ドメインは新しいプロジェクトに登録してください。履歴と記憶を混ぜないため、この登録先は変更できません。')
    if (restrictedHost(siteUrl) && body.category !== 'restricted') error('このドメインは制限対象です。一般サイトや未分類へ変更できません。')
    if (typeof body.siteName !== 'string' || body.siteName.length > 120 || redactString(body.siteName) !== body.siteName) error('サイト名を確認してください。')
    if (!['low', 'medium'].includes(body.reasoningEffort) || body.model !== 'gpt-5.6-terra' || body.publication !== 'manual' || body.scheduled !== false) error('この版はTerraの低・中、手動公開、定期実行なしに対応しています。')
    if (typeof body.property !== 'string' || body.property.length > 2048 || redactString(body.property) !== body.property) error('Search Consoleのプロパティを確認してください。')
    if (body.property && !siteCovers(body.property, siteUrl + '/')) error('登録URLを含むプロパティを選択してください。http/https・www・パスの違いを確認してください。')
    const permissions = { diagnosis: body.permissions?.diagnosis === true, ai: body.category !== 'unclassified' && body.permissions?.ai === true, draft: body.category !== 'unclassified' && body.permissions?.draft === true }
    const next = { siteName: body.siteName.trim(), siteUrl, category: body.category, permissions, property: body.property, publication: 'manual', model: 'gpt-5.6-terra', reasoningEffort: body.reasoningEffort, scheduled: false, revision: old.revision + 1 }
    const { history, ...before } = old
    next.history = [...(history || []), { at: new Date().toISOString(), before, after: { ...next } }].slice(-50)
    const target = file(id), temp = `${target}.${randomUUID()}.tmp`
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, target)
    return next
  }
  function requirePermission(id, operation) {
    const policy = read(id)
    if (!policy.siteUrl || !policy.permissions?.[operation] || (operation !== 'diagnosis' && policy.category === 'unclassified') || (restrictedHost(policy.siteUrl) && policy.category !== 'restricted')) error('サイト設定でカテゴリと許可する操作を確認してください。未分類は読み取り専用です。')
    return policy
  }
  function setProperty(id, property, expected) {
    const old = read(id)
    if (expected !== old.property) error('別の画面で選択が変わりました。再読み込みして選び直してください。')
    if (!old.siteUrl || typeof property !== 'string' || redactString(property) !== property || !siteCovers(property, old.siteUrl + '/')) error('登録URLを含むSearch Consoleプロパティを選んでください。')
    // Selecting a property does not expand execution permissions or expire WP approvals.
    const { history, ...before } = old
    const next = { ...before, property }
    next.history = [...(history || []), { at: new Date().toISOString(), before, after: { ...next } }].slice(-50)
    const target = file(id), temp = `${target}.${randomUUID()}.tmp`
    fs.writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); fs.renameSync(temp, target)
    return next
  }
  return { read, update, requirePermission, setProperty }
}
module.exports = { createSitePolicy, restrictedHost }
