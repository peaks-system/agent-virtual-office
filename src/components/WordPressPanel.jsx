import React, { useEffect, useState } from 'react'
import './wordpressPanel.css'

async function api(route, body) {
  const response = await fetch(`/api/wordpress${route}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || 'WordPress保守機能に接続できません。')
  return value
}
const labels = { proposed: '承認待ち', sending: '送信中、または中断により結果不明（再送禁止）', uncertain: '保存結果不明（再送禁止）', saved: '下書き保存済み・品質確認未完了', checked: '下書き保存・内容照合済み', 'needs-review': '下書き作成後の確認が必要' }

function Proposal({ item, configured, busy, approve }) {
  const [consent, setConsent] = useState(false)
  return <article className="wp-proposal">
    <h3>{item.after.title}</h3><p role="status">{labels[item.status] || '状態を確認してください'}</p>
    <small>{new Date(item.createdAt).toLocaleString('ja-JP')}</small>
    <details open={item.status === 'proposed'}><summary>変更内容・理由を確認</summary>
      <p>対象：{item.source ? `元ページ ID ${item.source.id} の別下書き` : item.kind === 'posts' ? '新しい記事の下書き' : '新しい固定ページの下書き'}</p>
      <h4>変更前（元ページの内容・変更しません）</h4><pre>{item.source ? `${item.source.title}\n\n${item.source.content}` : '新規作成のため、変更前のページはありません。'}</pre>
      <h4>変更後（別の下書きへ保存）</h4><pre>{item.after.title}{'\n\n'}{item.after.content}</pre>
      <p>理由：{item.reason}</p><p>期待する効果：提案した文章を、公開せず確認できます。</p>
      <p>注意：本文とタイトルだけを新規保存します。元ページの画像・リンク・装飾・独自設定は引き継ぎません。WordPressのプラグインが保存時に動作する可能性があります。</p>
    </details>
    {item.status === 'proposed' && <>
      <label className="wp-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />この変更内容で、対象サイトに下書きを1件作ることを承認します。</label>
      <button className="corp-primary" disabled={!consent || !configured || busy} onClick={() => { setConsent(false); approve(item) }}>承認して別の下書きに保存</button>
    </>}
    {item.checks && <ul>{Object.entries(item.checks).map(([key, value]) => <li key={key}>{({ draft: '下書き状態', title: 'タイトルの一致', content: '本文の一致', sourceUnchanged: '元ページに変更がないこと' })[key]}：{value ? '確認済み' : '不一致・確認が必要'}</li>)}</ul>}
    {item.status !== 'proposed' && <>
      <p>技術確認：WordPressからの読み戻しによる照合です。AIスタッフの確認ではありません。</p>
      <p>未確認：実際の表示・スマホ表示・テーマの見出し・リンク・メタ情報・noindex・canonical・構造化データ。WordPressのプレビューで確認してください。</p>
      {item.draftId && <a href={`${item.site}/wp-admin/post.php?post=${item.draftId}&action=edit`} target="_blank" rel="noreferrer">下書き ID {item.draftId} をWordPressで確認</a>}
      {item.checks?.sourceUnchanged === false && <p role="alert">元ページにも差異が見つかりました。他の編集やプラグインの影響をWordPress上で確認してください。自動復元は行いません。</p>}
      <p>元に戻す方法：Officeには元ページを上書きする処理はありません。作成した下書きが不要なら、IDを確認してWordPress上で手動でゴミ箱へ移してください。Officeは削除しません。</p>
      {['sending', 'uncertain'].includes(item.status) && <p role="alert">重複を防ぐため再送しません。WordPressの固定ページ一覧で、次のスラッグの下書きがあるか確認してください。他の案として作り直す前にも確認が必要です。</p>}
      <small className="wp-slug">照合用スラッグ：{item.slug}</small>
    </>}
  </article>
}

export default function WordPressPanel({ project, settings }) {
  const base = `/projects/${encodeURIComponent(project.id)}`
  const [kind, setKind] = useState('pages')
  const [state, setState] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('案内ページの動作確認'), [content, setContent] = useState('このページは、下書き保存と表示を確認するためのテスト用ページです。\n\n公開前に担当者が内容を確認します。')
  const [reason, setReason] = useState('下書き保存の動作と案内文の読みやすさを確認するため。'), [sourceId, setSourceId] = useState(''), [neutral, setNeutral] = useState(false)
  useEffect(() => { let alive = true; api(base).then(value => { if (alive) setState(value) }).catch(() => { if (alive) setError('WordPress保守機能に接続できません。Officeを起動し直してください。') }); return () => { alive = false } }, [base, settings?.revision])
  async function run(operation) {
    setBusy(true); setError('')
    try { await operation(); setState(await api(base)) } catch (e) { setError(e.message); try { setState(await api(base)) } catch {} } finally { setBusy(false) }
  }
  return <section className="wp-panel">
    <h2>WordPress保守（下書きのみ）</h2>
    <p>対象：{state?.site || 'サイト設定で登録してください'}</p><p>{state?.category === 'general' ? '記事・固定ページを1件ずつ新しい下書きとして保存します。' : '中立的な案内・テスト用ページだけを扱います。'}公開・元ページの更新・削除は行いません。</p>
    {!state?.canDraft && <p role="status">下書き作成は許可されていません。「サイト設定」でカテゴリと操作権限を確認してください。未分類は読み取り専用です。</p>}
    <p role="status">接続情報：{state?.configured ? '起動中のみ保持（通信の成功は保存時に確認）' : '未設定'}</p>
    <fieldset disabled={busy || !state?.canDraft}><details><summary>WordPress接続の準備</summary>
      <p>既存のWordPressユーザー名とアプリケーションパスワードを入力します。GoogleのJSONや通常のログインパスワードではありません。新規発行が必要な場合は、このチャットで手順を確認してください。</p>
      <p>接続情報は画面へ再表示せず、Office終了時に消えます。既存の認証ファイルは変更しません。接続先は上記サイトに固定しています。</p>
      <form className="corp-editor" autoComplete="off" onSubmit={e => {
        e.preventDefault(); const form = e.currentTarget
        const username = form.elements.namedItem('wp-user').value, password = form.elements.namedItem('wp-pass').value
        form.reset(); run(() => api(`${base}/connection`, { username, password }))
      }}>
        <label>WordPressユーザー名<input name="wp-user" type="password" autoComplete="off" maxLength={100} required /></label>
        <label>アプリケーションパスワード<input name="wp-pass" type="password" autoComplete="new-password" maxLength={64} required /></label>
        <button disabled={busy}>起動中だけ接続情報を使用</button>
      </form>
    </details>
    <form className="corp-editor" onSubmit={e => { e.preventDefault(); run(() => api(`${base}/proposals`, { sourceId: sourceId ? Number(sourceId) : null, title, content, reason, neutral, kind })) }}>
      <label>下書きの種類<select value={kind} disabled={state?.category !== 'general'} onChange={e => setKind(e.target.value)}><option value="pages">固定ページ</option><option value="posts">記事</option></select></label>
      <label>元ページID（新規なら空欄）<input type="number" min="1" step="1" value={sourceId} onChange={e => setSourceId(e.target.value)} /></label>
      <p>{state?.category === 'general' ? '元ページを指定しても上書きせず、選択した種類の別下書きを作成します。' : '成人向け本文を含まない案内ページのIDだけを指定してください。'}ページ一覧を自動収集しません。</p>
      <p>初期入力は動作確認用の例文です。保存するタイトル・本文・理由に書き換えてから変更案を作ってください。</p>
      <label>変更後のタイトル<input value={title} required maxLength={120} onChange={e => setTitle(e.target.value)} /></label>
      <label>変更後の本文<textarea rows={5} value={content} required maxLength={8000} onChange={e => setContent(e.target.value)} /></label>
      <p>初版は通常の文章のみです。HTML・ショートコード・URLは入力できません。</p>
      <label>変更理由<textarea rows={2} value={reason} required maxLength={1000} onChange={e => setReason(e.target.value)} /></label>
      {state?.category !== 'general' && <label className="wp-consent"><input type="checkbox" checked={neutral} onChange={e => setNeutral(e.target.checked)} />成人向け本文や宣伝を含まない案内・テスト用の内容です。</label>}
      <button disabled={busy || (state?.category !== 'general' && !neutral) || (!!sourceId && !state?.configured)}>変更案を表示（まだ保存しません）</button>
    </form>
    </fieldset>
    {error && <p className="corp-error" role="alert">{error}</p>}
    {busy && <p role="status">処理中です。画面を閉じずにお待ちください。</p>}
    <h3>変更案・履歴</h3><button disabled={busy} onClick={() => run(async () => {})}>履歴・状態を再読み込み</button>
    {!state?.records?.length && <p>変更案はまだありません。接続前でも、新規テストの変更案を確認できます。</p>}
    {state?.records?.map(item => <Proposal key={item.id} item={item} configured={state.configured} busy={busy || state.busy} approve={p => run(() => api(`${base}/approvals`, { id: p.id, hash: p.hash, approved: true }))} />)}
  </section>
}
