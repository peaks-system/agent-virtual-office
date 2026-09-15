import React, { useState } from 'react'

export default function StaffApproval({ run, onRun, onOpenRun, onWordPress }) {
  const [selections, setSelections] = useState({})
  const [actor, setActor] = useState('ローカル利用者')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const items = run.confirmation?.items || []
  async function decide(action) {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/staff/runs/${encodeURIComponent(run.id)}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: run.projectId, action, actor, feedback, selections }) })
      const data = await response.json()
      if (!response.ok) throw Error()
      onRun(data.parent)
    } catch { setError('操作結果を確認できません。実行状態を再確認してください。記録済みの承認は重複実行しません。') }
    finally { setBusy(false) }
  }
  return <section aria-label="次の操作と承認履歴">
    <h3>次に確認すること</h3>
    <p>ここでの承認は追加調査・検討だけです。Terra（標準）でAIチームを再実行し、利用枠を消費します。WordPress接続は不要です。新たな巡回や外部情報の取得は行わず、渡された資料で検討します。</p>
    {(!run.confirmation || run.confirmation.fallback) && <p>この報告から確認項目を分離できませんでした。追加調査への承認で、AIに確認項目の整理を依頼します。</p>}
    {run.confirmation && !run.confirmation.fallback && !items.length && <p>PMから個別の確認項目はありません。追加で検討する内容をコメントに入力できます。</p>}
    {items.map(item => <fieldset key={item.id} disabled={busy || !!run.decision}><legend>{item.question}</legend>
      <label>選択肢<select value={selections[item.id] || ''} onChange={e => setSelections({ ...selections, [item.id]: e.target.value })}><option value="">選んでください</option>{item.options.map(option => <option key={option.id} value={option.id}>{option.label}{option.id === item.recommended ? '（PM推奨）' : ''}</option>)}</select></label>
      <p>推奨理由：{item.reason}</p><p>危険性・不確実性：{item.risk}</p>
    </fieldset>)}
    {!run.decision && <>
      <label>記録する確認者名（自己申告）<input value={actor} maxLength={80} onChange={e => setActor(e.target.value)} /></label>
      <label>修正内容・追加コメント<textarea value={feedback} maxLength={2000} onChange={e => setFeedback(e.target.value)} /></label>
      <button type="button" disabled={busy || !actor.trim() || items.some(item => !selections[item.id])} onClick={() => decide('approve')}>承認して追加調査へ進む</button>
      <button type="button" disabled={busy || !actor.trim() || !feedback.trim()} onClick={() => decide('revise')}>修正を依頼</button>
      <button type="button" disabled={busy || !actor.trim()} onClick={() => decide('reject')}>却下</button>
      <p>承認：選択を引き継ぎ追加検討。修正：コメントを引き継ぎ再検討。却下：履歴だけを保存し、AIは実行しません。</p>
    </>}
    {error && <p role="alert">{error}</p>}
    {run.decision && <div><h4>判断履歴</h4><p>{run.decision.actor}（自己申告）／{new Date(run.decision.at).toLocaleString('ja-JP')}／{({ approve: '追加検討を承認', revise: '修正依頼', reject: '却下' })[run.decision.action]}</p>
      {run.decision.selected.map((item, i) => <p key={i}>{item.question}：{item.selection}</p>)}<p>{run.decision.feedback}</p>
      <p>{run.decision.outcome === 'dispatch-failed' ? '追加実行の開始を確認できませんでした。自動再試行はしません。' : run.decision.nextRunId ? '追加実行を開始しました。下のボタンで進行状況・結果を確認できます。' : '却下を記録しました。追加実行はありません。'}</p>
      {run.decision.nextRunId && <button type="button" onClick={() => onOpenRun(run.decision.nextRunId)}>追加実行の進行状況・結果を見る</button>}
    </div>}
    <p>WordPress変更は別承認です。「WordPress保守」で対象ページ・変更前後を確認して承認するまで保存しません。この調査承認を流用することはありません。</p>
    <button type="button" onClick={onWordPress}>WordPress保守で別の変更案を確認</button>
  </section>
}
