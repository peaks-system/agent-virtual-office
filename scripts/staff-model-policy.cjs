'use strict'
const policy = require('../config/model-policy.json')

function resolveExecution(selection = {}) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error('実行設定が正しくありません。')
  const model = selection.model ?? policy.defaultModel
  const reasoningEffort = selection.reasoningEffort ?? policy.defaultReasoningEffort
  // Keep the approval boundary fail-closed even if the editable config is invalid.
  if (policy.defaultModel !== 'gpt-5.6-terra' || policy.approvalRequiredModel !== 'gpt-6-astra'
      || !['low', 'medium'].includes(policy.defaultReasoningEffort)
      || !['low', 'medium'].includes(reasoningEffort)
      || !['gpt-5.6-terra', 'gpt-6-astra'].includes(model)) throw new Error('モデルはTerraまたは承認済みAstra、思考レベルは低・中だけ指定できます。')
  if (model === 'gpt-6-astra' && selection.humanApprovedAstra !== true) throw new Error('Astraの実行には、この依頼に対する人間の承認が必要です。')
  return { model, reasoningEffort, humanApprovedAstra: model === 'gpt-6-astra' }
}
module.exports = { resolveExecution }
