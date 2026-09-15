import React, { useEffect, useState } from 'react'
import { useStaffRunState } from '../systems/staffRunState'
import { charName } from '../i18n'
import modelPolicy from '../../config/model-policy.json'
import { lookupStaffRun, staffStartBlocked } from '../systems/staffRunRecovery'
import StaffApproval from './StaffApproval'

const stages = { planning: '依頼の整理・割り振り', draft: '独立した初案', review: '相互レビュー', revise: '修正', quality: '品質確認', final: '取りまとめ' }
const statuses = { queued: '開始待ち', running: '実行中', 'awaiting-human': '人間の最終確認待ち', error: '実行できませんでした', cancelled: '中止しました' }
const ACTIVE_PREFIX = 'office-staff-active-run:'

export default function StaffWorkPanel(props) {
  return <StaffWorkSession key={props.project?.id || 'empty'} {...props} />
}

function StaffWorkSession({ project, settings, onWordPress }) {
  const ACTIVE_KEY = ACTIVE_PREFIX + (project?.id || 'empty')
  const [astraReason, setAstraReason] = useState('')
  useEffect(() => { if (settings) setEffort(settings.reasoningEffort) }, [settings?.revision])
  const [request, setRequest] = useState('')
  const [run, setRun] = useState(null)
  const [runId, setRunId] = useState(() => { try { return localStorage.getItem(ACTIVE_KEY) || null } catch { return null } })
  const [error, setError] = useState('')
  const [lookup, setLookup] = useState('checking')
  const [retry, setRetry] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [effort, setEffort] = useState(modelPolicy.defaultReasoningEffort)
  const [approveAstra, setApproveAstra] = useState(false)
  useEffect(() => { setApproveAstra(false) }, [project?.id, request, effort])
  const active = submitting || ['queued', 'running'].includes(run?.status)
  useEffect(() => {
    if (!runId) return
    let alive = true
    let timer
    const controller = new AbortController()
    setLookup('checking')
    const poll = async () => {
      const value = await lookupStaffRun(runId, project?.id, { signal: controller.signal })
      if (!alive) return
      setLookup(value.lookup); setRun(value.run)
      useStaffRunState.getState().applyRun(value.run)
      setError(value.lookup === 'missing' ? '保存された実行記録が見つかりません。実行表示をリセットできます。成果物は削除しません。' : value.lookup === 'unavailable' ? '実行状態を取得できませんでした。処理が停止したとは限りません。' : '')
      if (['queued', 'running'].includes(value.run?.status)) timer = setTimeout(poll, 1500)
    }
    poll()
    return () => { alive = false; controller.abort(); clearTimeout(timer) }
  }, [runId, retry, project?.id])
  const blockedReason = staffStartBlocked({ project, settings, request, approveAstra, astraReason, submitting, runId, lookup, run })
  async function start(event) {
    event.preventDefault()
    if (blockedReason) return
    setSubmitting(true); setError('')
    const execution = { model: approveAstra ? modelPolicy.approvalRequiredModel : modelPolicy.defaultModel, reasoningEffort: effort, humanApprovedAstra: approveAstra }
    setApproveAstra(false)
    try {
      const response = await fetch('/api/staff/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: project.id, request: request.trim(), execution, astraReason }) })
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
<p>{settings?.category === 'general' ? '記事案の検討結果から保存する文章を選び、WordPress保守で変更案を確認してください。' : '通常の文章作成は一般サイト専用です。制限対象は診断結果の技術保守、未分類は読み取り診断を利用してください。'}</p>
    <form className="corp-editor" onSubmit={start}>
      <label>人間からの依頼<textarea rows={4} maxLength={8000} value={request} onChange={e => setRequest(e.target.value)} placeholder="目的、対象、期限、条件、参考情報を入力" /></label>
      <p className="corp-muted">{project ? `対象：${project.title}` : '先にプロジェクトを追加・選択してください。'}</p>
      <p className="corp-muted">標準：5.6 Terra。自動でAstraへ切り替わることはありません。</p>
      <label>思考レベル<select value={effort} disabled={active} onChange={e => setEffort(e.target.value)}><option value="low">低（速度優先）</option><option value="medium">中（標準）</option></select></label>
      <label>Astraを使う必要性と期待する効果<input value={astraReason} maxLength={500} onChange={e => { setAstraReason(e.target.value); setApproveAstra(false) }} /></label>
      <label><input type="checkbox" checked={approveAstra} disabled={active} onChange={e => setApproveAstra(e.target.checked)} />今回の共同作業の全工程にAstraを使うことを承認する（利用量が増える場合があります）</label>
      <button className="corp-primary" disabled={!!blockedReason} aria-describedby="staff-start-reason">{active ? '実行中…' : 'PMに依頼して共同作業を開始'}</button>
    </form>
    <p id="staff-start-reason" role="status">{blockedReason || '調査・記事案の検討を開始できます。WordPress接続は不要です。'}</p>
    {error && <p role="alert" className="corp-error">{error}</p>}
    {runId && <><p className="corp-muted">リセットは表示だけを解除します。実行中の処理の中止や成果物の削除は行いません。処理が続いている場合、新しい依頼はサーバー側で拒否されます。</p>
    {lookup === 'unavailable' && <button type="button" onClick={() => setRetry(value => value + 1)}>実行状態を再確認</button>}
    <button type="button" disabled={submitting} onClick={() => {
      setRunId(null); setRun(null); setError(''); setLookup('ready'); useStaffRunState.getState().applyRun(null)
      try { localStorage.removeItem(ACTIVE_KEY) } catch { setError('表示用の実行IDを解除できませんでした。') }
    }}>実行表示をリセット（保存済み成果物は保持）</button></>}
    {run && <div aria-live="polite">
      {run.parentRunId && <button type="button" onClick={() => { setRun(null); setRunId(run.parentRunId); try { localStorage.setItem(ACTIVE_KEY, run.parentRunId) } catch { setError('実行IDを保存できませんでした。') } }}>前の報告・判断履歴を見る</button>}
      {run.status === 'awaiting-human' && <StaffApproval key={run.id} run={run} onRun={setRun} onWordPress={onWordPress} onOpenRun={id => { setRun(null); setRunId(id); try { localStorage.setItem(ACTIVE_KEY, id) } catch { setError('実行IDを保存できませんでした。') } }} />}
      {run.execution && <p>使用モデル：{run.execution.model === 'gpt-6-astra' ? 'Astra（今回のみ承認済み）' : '5.6 Terra'} ／ 思考：{run.execution.reasoningEffort === 'low' ? '低' : '中'}</p>}
      <p><strong>{run.decision ? '判断を記録済み' : statuses[run.status] || run.status}</strong></p>
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
