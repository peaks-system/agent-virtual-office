import React, { useEffect, useRef, useState } from 'react'
import modelPolicy from '../../config/model-policy.json'
import { charName } from '../i18n'
import { useStaffRunState } from '../systems/staffRunState'
import maintenancePolicy from '../../config/maintenance-workflow.json'
import MaintenanceReview from './MaintenanceReview'

async function api(route, body) {
  const response = await fetch(`/api/seo${route}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'SEO診断に接続できません。')
  return value
}
function Findings({ title, items }) {
  return <details open><summary>{title}（{items?.length || 0}件）</summary>
    {!items?.length ? <p className="corp-muted">該当する記録はありません。問題がないことを保証するものではありません。</p> : <ul>{items.slice(0, 100).map((item, index) => <li key={index}>
      <span>{typeof item === 'string' ? item : item.message}</span>
      {item.url && <div className="corp-muted" style={{ overflowWrap: 'anywhere' }}>{item.url}</div>}
      {item.evidence && <small>{typeof item.evidence === 'string' ? item.evidence : JSON.stringify(item.evidence)}</small>}
    </li>)}</ul>}
  </details>
}
const stageName = { res: '根拠整理', arch: '検索意図・優先度', dev: '技術的な改善案', qa: '誤診・危険・要件漏れの点検', pm: '最終取りまとめ' }
export default function SeoPanel({ project }) {
  const base = `/projects/${encodeURIComponent(project.id)}`
  const [state, setState] = useState(null), [url, setUrl] = useState(''), [connection, setConnection] = useState(null)
  const [sites, setSites] = useState([]), [property, setProperty] = useState(''), [error, setError] = useState('')
  const [busy, setBusy] = useState(false), [effort, setEffort] = useState(modelPolicy.defaultReasoningEffort), [astra, setAstra] = useState(false)
  const fileInput = useRef(null)
  const active = busy || state?.audit?.status === 'running' || ['queued', 'running'].includes(state?.proposal?.status)
  useEffect(() => { setAstra(false) }, [url, effort, state?.public?.generatedAt, state?.google?.generatedAt])
  useEffect(() => {
    let alive = true, timer
    async function poll(initial = false) {
      try {
        const [data, status] = await Promise.all([api(base), api('/google/status')])
        if (!alive) return
        setState(data); setConnection(status)
        if (initial) { setUrl(data.siteUrl || ''); setProperty(data.google?.property || '') }
        if (data.proposal) useStaffRunState.getState().applyRun(data.proposal)
      } catch { if (alive) setError('SEO診断を読み込めません。オフィスの起動状態を確認してください。') }
      if (alive) timer = setTimeout(() => poll(), 2500)
    }
    poll(true)
    return () => { alive = false; clearTimeout(timer) }
  }, [base])
  async function action(operation) {
    if (active) return
    setBusy(true); setError('')
    try { await operation(); setState(await api(base)); setConnection(await api('/google/status')) }
    catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  async function importClient(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await action(async () => {
      if (file.size > 30000) throw new Error('Googleからダウンロードした認証用JSON（30KB以内）を選んでください。')
      let client
      try { client = JSON.parse(await file.text()) } catch { throw new Error('認証用JSONを読み込めません。ファイルを確認してください。') }
      await api('/google/configuration', { client })
      // Client credentials are never kept in component state or browser storage.
    })
  }
  const report = state?.public, gsc = state?.google, run = state?.proposal
  let maintenance = false
  try { maintenance = maintenancePolicy.restrictedHosts.includes(new URL(state?.siteUrl).hostname.toLowerCase()) } catch {}
  const requestReview = () => {
    const execution = { model: astra ? modelPolicy.approvalRequiredModel : modelPolicy.defaultModel, reasoningEffort: effort, humanApprovedAstra: astra }
    setAstra(false)
    action(() => api(`${base}/proposals`, { execution }))
  }
  return <section className="corp-real-work" aria-label="SEO診断モード" style={{ overflowWrap: 'anywhere' }}>
    <h2>SEO診断モード</h2>
    <p className="corp-muted">公開ページを読み取り専用で調査します。サイトの編集・公開・削除やインデックス申請は行いません。</p>
    <form className="corp-editor" onSubmit={event => { event.preventDefault(); action(() => api(`${base}/site`, { siteUrl: url.trim() })) }}>
      <label>サイトURL<input type="url" value={url} maxLength={2048} placeholder="https://example.com/" disabled={active} onChange={event => setUrl(event.target.value)} required /></label>
      <button disabled={active || !url.trim()}>サイトURLを保存</button>
    </form>
    <p className="corp-muted">保存済み：{state?.siteUrl || '未登録'}。登録したホストだけを対象にし、内部ネットワークへの接続は拒否します。</p>
    <button className="corp-primary" disabled={active || !state?.siteUrl} onClick={() => action(() => api(`${base}/audits`, {}))}>公開サイトを診断</button>
    {state?.audit?.status === 'running' && <p role="status">公開サイトを診断しています…</p>}
    {state?.audit?.error && <p role="alert">{state.audit.error}</p>}
    <h3>Search Console接続</h3>
    <p role="status">接続状態：{connection?.pending ? 'Googleでの承認待ち' : connection?.connected ? '読み取り専用で接続済み' : connection?.configured ? '未接続（認証設定済み）' : '未接続（認証設定が必要）'}</p>
    {connection?.message && <p className="corp-muted">{connection.message}</p>}
    <button disabled={active || !connection?.configured || connection?.pending} onClick={() => action(() => api('/google/connection', {}))}>Search Consoleに接続</button>
    <p className="corp-muted">通常のブラウザーでGoogle承認画面が開きます。要求する権限はSearch Consoleの読み取りだけです。認証情報はWindowsで暗号化し、画面・Git・AIに渡しません。</p>
    <details><summary>Google接続の準備</summary>
      <p>まずGoogle Cloudで「Google Search Console API」を有効にしてください。次にOAuthの同意設定と「デスクトップアプリ」のクライアントを準備します。操作が不明な場合は、このチャットで順に案内します。</p>
      <p>認証用JSONを取得済みの場合だけ、下のボタンで読み込んでください。ファイルの中身をチャットへ貼り付ける必要はありません。</p>
      <input ref={fileInput} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={importClient} />
      <button disabled={active || connection?.pending} onClick={() => fileInput.current?.click()}>認証用JSONを読み込む</button>
    </details>
    {connection?.connected && <>
      <button disabled={active} onClick={() => action(async () => { const data = await api('/google/sites'); setSites(data.sites || []); if (data.unknowns?.length) throw new Error('サイト一覧を取得できませんでした。接続し直して確認してください。') })}>閲覧できるサイト一覧を取得</button>
      <button disabled={active} onClick={() => action(async () => { await api('/google/disconnection', {}); setSites([]); setProperty('') })}>Google接続を解除</button>
      <label>Search Consoleのサイト<select value={property} onChange={event => { setProperty(event.target.value); setAstra(false) }} disabled={active}>
        <option value="">サイトを選択</option>{sites.map(site => <option key={site.siteUrl} value={site.siteUrl}>{site.siteUrl}</option>)}
      </select></label>
      <button disabled={active || !property || !state?.siteUrl} onClick={() => action(() => api(`${base}/google`, { property }))}>Google側の診断情報を取得</button>
    </>}
    {error && <p role="alert" className="corp-error">{error}</p>}
    <h3>診断結果</h3>
    {!report && <p>公開サイトの診断はまだ実行していません。Googleのインデックス状態も未確認です。</p>}
    {report && <>
      <p className="corp-muted">公開診断日時：{new Date(report.generatedAt).toLocaleString('ja-JP')}</p>
      <details><summary>診断範囲・上限</summary><p>最大{report.limits?.pages}ページ・{report.limits?.requests}回の通信・合計{(report.limits?.durationMs || 0) / 1000}秒。1通信は最大{(report.limits?.requestMs || 0) / 1000}秒、1応答{Math.round((report.limits?.responseBytes || 0) / 1024)}KB、合計{Math.round((report.limits?.totalBytes || 0) / 1024)}KBまで。</p><p>取得：{report.usage?.pages}ページ／通信{report.usage?.requests}回／{Math.round((report.usage?.bytes || 0) / 1024)}KB。</p></details>
      <details><summary>確認したページ情報（{report.pages?.length || 0}件）</summary>{report.pages?.map((page, index) => <div key={index}>
        <h4>{page.url}</h4><p>HTTP：{page.status} ／ noindex：{page.noindex ? '検出' : '静的解析では検出なし'}</p>
        <p>タイトル：{page.title || '未検出'}<br />説明文：{page.description || '未検出'}<br />canonical：{page.canonical || '未検出'}</p>
        {Object.entries(page.headings || {}).map(([level, values]) => <p key={level}>{level.toUpperCase()}見出し：{values.join(' ／ ') || '未検出'}</p>)}
        {page.redirects?.map((redirect, i) => <p key={i}>転送：{redirect.status} {redirect.from} → {redirect.to}</p>)}
      </div>)}</details>
      <Findings title="確認済みの事実" items={report.facts} />
      <Findings title="原因候補・推測" items={report.hypotheses} />
      <Findings title="確認できなかった項目" items={report.unknowns} />
    </>}
    {!gsc && <p className="corp-muted">Google側のインデックス状態・選択canonical・最終クロールは未確認です。公開診断だけでは断定できません。</p>}
    {gsc && <>
      <h4>Google側の記録</h4><p className="corp-muted">取得日時：{new Date(gsc.generatedAt).toLocaleString('ja-JP')}</p>
      <Findings title="Search Consoleで確認した事実" items={gsc.facts} />
      <Findings title="Google情報の未確認項目" items={gsc.unknowns} />
      <details><summary>検索語と検索実績（取得上限内）</summary><div style={{ overflowX: 'auto' }}><table><thead><tr><th>検索語</th><th>ページ</th><th>表示回数</th><th>クリック数</th><th>CTR</th><th>平均順位</th></tr></thead><tbody>{gsc.analytics?.map((row, index) => <tr key={index}><td>{row.query}</td><td>{row.page}</td><td>{row.impressions}</td><td>{row.clicks}</td><td>{Number.isFinite(row.ctr) ? `${(row.ctr * 100).toFixed(1)}%` : '未確認'}</td><td>{row.position}</td></tr>)}</tbody></table></div></details>
      <details><summary>登録済みサイトマップ</summary><ul>{gsc.sitemaps?.map((item, index) => <li key={index}>{item.path || item.url}</li>)}</ul></details>
    </>}
    <p className="corp-muted">順位上昇やインデックス登録を保証しません。未取得ページ・JavaScript実行後の画面・Google内部の判断は推測と区別します。</p>
    <h3>{maintenance ? 'AIチームの技術保守' : 'AIスタッフの改善案'}</h3>
    <p className="corp-muted">{maintenance ? 'このサイトは技術保守のみです。PMの整理 → 技術担当と品質管理の独立した初案 → 技術担当の修正 → 品質管理の再点検 → PMの最終報告まで自動で進みます。HTTP応答・リダイレクト回数・見出し数だけを送信します。本文・検索語・検索実績は送りません。公開・書き込みは行わず、調査報告で完了します。' : '市場調査 → マーケティング戦略 → Webエンジニア → 品質管理 → PMの順に検討します。診断情報・検索実績を既存のCodex接続へ送信します。認証情報は送りません。'}</p>
    <label>{maintenance ? '技術保守の思考レベル' : 'SEO診断の思考レベル'}<select value={effort} disabled={active} onChange={event => setEffort(event.target.value)}><option value="low">低</option><option value="medium">中（標準）</option></select></label>
    <label><input type="checkbox" checked={astra} disabled={active} onChange={event => setAstra(event.target.checked)} />{maintenance ? '今回の技術保守の全工程だけAstraを使うことを承認する' : '今回のSEO検討の全工程だけAstraを使うことを承認する'}</label>
    <p className="corp-muted">標準は5.6 Terraです。AI実行は利用枠を消費します。</p>
    <button className="corp-primary" disabled={active || !report} onClick={requestReview}>{maintenance ? 'AIチームに技術保守を依頼' : 'AIスタッフに改善案を依頼'}</button>
    {maintenance && <p className="corp-muted">継続監視ではなく、押すたびに1回の検討です。情報不足なら追加確認を求めます。下書きの変更は別途「WordPress保守」で内容を確認して承認してください。</p>}
    {maintenance && run && run.mode !== 'maintenance' && <p>以前のSEO検討は今回の技術保守の結果ではありません。上のボタンから技術保守を依頼してください。</p>}
    {run && (!maintenance || run.mode === 'maintenance') && <div aria-live="polite">
      <p>{['queued', 'running'].includes(run.status) ? `${charName(run.staffId || (maintenance ? 'pm' : 'res'))}：検討中` : maintenance && ['awaiting-human', 'review-complete'].includes(run.status) ? '調査完了・修正内容は未確定（承認操作は不要）' : run.status === 'awaiting-human' ? '人間の最終確認待ち' : '実行を完了できませんでした'}</p>
      {maintenance && ['awaiting-human', 'review-complete'].includes(run.status) && <MaintenanceReview report={report} checks={state?.maintenanceChecks} busy={active} onReview={requestReview} onCheck={pageIndex => action(() => api(`${base}/checks`, { pageIndex, generatedAt: report.generatedAt }))} />}
      {run.error && <p role="alert">{run.error}</p>}
      {run.steps?.map((step, index) => <details key={index}><summary>{charName(step.staffId)}：{maintenance ? ['依頼整理', '技術初案', '独立した品質点検', '技術案の修正', '品質再確認', '最終報告'][index] : stageName[step.staffId]}（{step.status === 'complete' ? '完了' : '処理中'}）</summary><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{step.output}</pre></details>)}
      {maintenance && <p className="corp-muted">報告の diagnostic-page:1 は「確認したページ情報」の1番目を指します。ページ名や本文はAIへ送信していません。</p>}
      {run.result && (maintenance ? <details><summary>AIの検討メモ（実行指示ではありません）</summary><p>過去のメモに「承認待ち」「承認後に実行」とあっても、実行可能な変更案が作成されたことを意味しません。上の確認結果と操作案内を優先してください。</p><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{run.result}</pre></details> : <><h4>改善案と人間が行う操作</h4><pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{run.result}</pre></>)}
    </div>}
  </section>
}
