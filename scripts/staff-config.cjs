const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../config/staff.json')
const STAFF_IDS = ['president', 'pm', 'arch', 'res', 'ops', 'gate', 'designer', 'dev', 'qa']
const STAGES = ['planning', 'draft', 'review', 'revise', 'quality', 'final']

function fail(detail) { throw new Error(`社員設定が正しくありません: ${detail}`) }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function text(value, label, max = 12000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} は空ではない${max}文字以内の文章にしてください。`)
}
function textList(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) fail(`${label} は1〜32個の文章の配列にしてください。`)
  value.forEach((item, index) => text(item, `${label}[${index}]`, 4000))
}
function exactKeys(value, keys, label) {
  if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail(`${label} の項目名を確認してください。`)
}

function validateStaffConfig(config) {
  exactKeys(config, ['version', 'commonRules', 'workflow', 'staff'], '設定')
  if (config.version !== 1) fail('version は 1 にしてください。')
  textList(config.commonRules, 'commonRules')
  exactKeys(config.workflow, STAGES, 'workflow')
  for (const stage of STAGES) text(config.workflow[stage], `workflow.${stage}`)
  if (!Array.isArray(config.staff) || config.staff.length !== STAFF_IDS.length) fail('staff には9人のプロフィールが必要です。')
  const seen = new Set()
  for (const staff of config.staff) {
    exactKeys(staff, ['id', 'displayName', 'executionEnabled', 'conversationEnabled', 'rolePrompt'], '社員プロフィール')
    if (!STAFF_IDS.includes(staff.id) || seen.has(staff.id)) fail('社員IDが未知または重複しています。')
    seen.add(staff.id)
    text(staff.displayName, 'displayName', 80)
    textList(staff.rolePrompt, `staff.${staff.id}.rolePrompt`)
    if (typeof staff.executionEnabled !== 'boolean' || typeof staff.conversationEnabled !== 'boolean') fail('実行・会話の設定は true または false にしてください。')
    if (staff.id === 'president' && (staff.executionEnabled || staff.conversationEnabled)) fail('社長は表示専用です。実行・会話を有効にできません。')
  }
  return config
}

function loadStaffConfig(configPath = DEFAULT_CONFIG_PATH) {
  let raw
  try {
    if (fs.statSync(configPath).size > 256 * 1024) fail('設定ファイルは256KB以内にしてください。')
    raw = fs.readFileSync(configPath, 'utf8')
  } catch (error) {
    if (error.message.startsWith('社員設定')) throw error
    throw new Error('社員設定ファイルを読み込めません。config/staff.json が存在し、読み取り可能か確認してください。')
  }
  let config
  try { config = JSON.parse(raw.replace(/^\uFEFF/, '')) } catch {
    throw new Error('社員設定のJSONを読み込めません。引用符、カンマ、括弧を確認してください。')
  }
  return validateStaffConfig(config)
}

function getStaff(config, id) {
  const staff = config.staff.find(item => item.id === id)
  if (!staff) throw new Error('指定された社員が見つかりません。')
  return staff
}

function buildInstructions(config, id, stage) {
  validateStaffConfig(config)
  const staff = getStaff(config, id)
  if (id === 'president' || !staff.executionEnabled) throw new Error('この社員は実行対象ではありません。社長は表示専用です。')
  if (!STAGES.includes(stage)) throw new Error('指定された作業段階が見つかりません。')
  if ((['planning', 'final'].includes(stage) && id !== 'pm') || (stage === 'quality' && id !== 'qa')) throw new Error('この作業段階は指定された担当者が実行する必要があります。')
  return [
    `担当社員: ${staff.displayName} (${staff.id})`,
    '【全社員共通の規則】', ...config.commonRules,
    '【あなた固有の役割と判断基準】', ...staff.rolePrompt,
    `【現在の工程: ${stage}】`, config.workflow[stage],
  ].join('\n\n')
}

module.exports = { loadStaffConfig, validateStaffConfig, getStaff, buildInstructions }
