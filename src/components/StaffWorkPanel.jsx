import React, { useEffect, useState } from 'react'
import { useStaffRunState } from '../systems/staffRunState'
import { charName } from '../i18n'
import modelPolicy from '../../config/model-policy.json'

const stages = { planning: '依頼の整理・割り振り', draft: '独立した初案', review: '相互レビュー', revise: '修正', quality: '品質確認', final: '取りまとめ' }
const statuses = { queued: '開始待ち', running: '実行中', 'awaiting-human': '人間の最終確認待ち', error: '実行できませんでした', cancelled: '中止しました' }
const ACTIVE_KEY = 'office-staff-active-run'

export default function StaffWorkPanel({ project }) {
  const [request, setRequest] = useState('')
  const [run, setRun] = useState(null)
  const [runId, setRunId] = useState(() => { try { return localStorage.getItem(ACTIVE_KEY) || null } catch { return null } })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [effort, setEffort] = useState(modelPolicy.defaultReasoningEffort)
  const [approveAstra, setApproveAstra] = useState(false)
  useEffect(() => { setApproveAstra(false) }, [project?.id, request, effort])
  const active = submitting || ['queued', 'running'].includes(run?.status)
  useEffect(() => {
    if (!runId) return
    let alive = true
    let timer
    const poll = async () => {
      try {
        const response = await fetch(`/api/staff/runs/${encodeURIComponent(runId)}`)
        const value = await response.json()
        if (!response.ok) throw new Error(value.error || '実行状態を取得できません。')
        if (!alive) return
        setRun(value); setError(''); useStaffRunState.getState().applyRun(value)
        if (['queued', 'running'].includes(value.status)) timer = setTimeout(poll, 1500)
      } catch (e) {
        if (alive) { setError(e.message); timer = setTimeout(poll, 5000) }
      }
    }
    poll()
    return () => { alive = false; clearTimeout(timer) }
  }, [runId])
  async function start(event) {
    event.preventDefault()
    if (!project || !request.trim() || active) return
    setSubmitting(true); setError('')
    const execution = { model: approveAstra ? modelPolicy.approvalRequiredModel : modelPolicy.defaultModel, reasoningEffort: effort, humanApprovedAstra: approveAstra }
    setApproveAstra(false)
    try {
      const response = await fetch('/api/staff/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, request: request.trim(), execution }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || '開始できませんでした。')
      setRun(value); setRunId(value.id)
      try { localStorage.setItem(ACTIVE_KEY, value.id) } catch { setError('実行は開始しましたが、再読み込み用の実行IDを保存できませんでした。') }
    } catch (e) { setError(e.message) }
    finally { setSubmitting(false) }
  }
  async function cancel() {
    try {
      const response = await fetch(`/api/staff/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error || '中止できませんでした。')
      setRun(value); useStaffRunState.getState().applyRun(value)
    } catch (e) { setError(e.message) }
  }
  return <section className="corp-real-work" aria-label="スタッフへのAI依頼">
    <h2>スタッフへのAI依頼</h2>
    <p className="corp-muted">既存のCodexログインで実行します。利用枠を消費します。社長への割り当てや、投稿・公開・購入・削除は行いません。</p>
    <form className="corp-editor" onSubmit={start}>
      <label>人間からの依頼<textarea rows={4} maxLength={8000} value={request} onChange={e => setRequest(e.target.value)} placeholder="目的、対象、期限、条件、参考情報を入力" /></label>
      <p className="corp-muted">{project ? `対象：${project.title}` : '先にプロジェクトを追加・選択してください。'}</p>
      <p className="corp-muted">標準：5.6 Terra。自動でAstraへ切り替わることはありません。</p>
      <label>思考レベル<select value={effort} disabled={active} onChange={e => setEffort(e.target.value)}><option value="low">低（速度優先）</option><option value="medium">中（標準）</option></select></label>
      <label><input type="checkbox" checked={approveAstra} disabled={active} onChange={e => setApproveAstra(e.target.checked)} />今回の共同作業の全工程にAstraを使うことを承認する（利用量が増える場合があります）</label>
      <button className="corp-primary" disabled={!project || !request.trim() || active || (!run && !!runId && !error)}>{active ? '実行中…' : 'PMに依頼して共同作業を開始'}</button>
    </form>
    {error && <><p role="alert" className="corp-error">{error}</p>{!active && <button type="button" onClick={() => {
      setRunId(null); setRun(null); setError(''); useStaffRunState.getState().applyRun(null)
      try { localStorage.removeItem(ACTIVE_KEY) } catch { setError('表示用の実行IDを解除できませんでした。') }
    }}>実行表示をリセット（保存済み成果物は保持）</button>}</>}
    {run && <div aria-live="polite">
      {run.execution && <p>使用モデル：{run.execution.model === 'gpt-6-astra' ? 'Astra（今回のみ承認済み）' : '5.6 Terra'} ／ 思考：{run.execution.reasoningEffort === 'low' ? '低' : '中'}</p>}
      <p><strong>{statuses[run.status] || run.status}</strong></p>
      {run.projectId !== project?.id && <p className="corp-muted">別のプロジェクトの実行結果です。</p>}
      {run.staffId && <p>{charName(run.staffId)}：{stages[run.stage] || run.stage}</p>}
      {active && <button onClick={cancel} type="button">実行を中止</button>}
      {run.error && <p role="alert">{run.error}</p>}
      {run.steps?.map((step, i) => <details key={`${step.staffId}-${step.stage}-${i}`}>
        <summary>{charName(step.staffId)} · {stages[step.stage] || step.stage} · {step.status === 'complete' ? '完了' : statuses[step.status] || step.status}</summary>
        {step.output && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: 12 }}>{step.output}</pre>}
      </details>)}
      {run.result && <><h3>取りまとめた成果物</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: 12 }}>{run.result}</pre></>}
      {run.status === 'awaiting-human' && <p className="corp-muted">内容と根拠を確認してください。この画面から外部操作を自動実行することはありません。</p>}
    </div>}
  </section>
}
