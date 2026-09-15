'use strict'
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max
function parseConfirmation(output) {
  try {
    const data = JSON.parse(output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
    if (!text(data.report, 40000) || !Array.isArray(data.items) || data.items.length > 5) throw Error()
    const items = data.items.map((item, i) => {
      if (!text(item.question, 300) || !text(item.reason, 600) || !text(item.risk, 600) || !Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4) throw Error()
      const options = item.options.map((option, j) => {
        if (!text(option.label, 300)) throw Error()
        return { id: String(j + 1), label: option.label }
      })
      if (!options.some(o => o.id === item.recommended)) throw Error()
      return { id: String(i + 1), question: item.question, reason: item.reason, risk: item.risk, recommended: item.recommended, options }
    })
    return { report: data.report, items, fallback: false }
  } catch {
    return { report: output, items: [], fallback: true }
  }
}
function decisionInput(run, body) {
  if (!['approve', 'revise', 'reject'].includes(body.action) || !text(body.actor, 80) || typeof body.feedback !== 'string' || body.feedback.length > 2000) throw Error('Invalid decision')
  if (body.action === 'revise' && !body.feedback.trim()) throw Error('Missing revision')
  const selected = (run.confirmation?.items || []).map(item => {
    const option = item.options.find(o => o.id === body.selections?.[item.id])
    if (body.action === 'approve' && !option) throw Error('Missing selection')
    return { question: item.question, selection: option?.label || '未選択' }
  })
  return { action: body.action, actor: body.actor.trim(), feedback: body.feedback, selected, at: Date.now(), scope: 'read-only-reasoning' }
}
module.exports = { parseConfirmation, decisionInput }
