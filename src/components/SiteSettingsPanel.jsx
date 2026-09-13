import React, { useEffect, useState } from 'react'
const labels = { unclassified: '未分類', general: '一般サイト', restricted: '制限対象サイト（成人向けなど）' }
export default function SiteSettingsPanel({ project, onSettings }) {
  const [saved, setSaved] = useState(null), [form, setForm] = useState(null), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const route = `/api/seo/projects/${encodeURIComponent(project.id)}`
  useEffect(() => { let alive = true; fetch(route).then(r => r.json()).then(data => { if (alive && data.settings) { setSaved(data.settings); setForm(data.settings); onSettings({ ...data.settings, projectId: project.id }) } }).catch(() => { if (alive) setError('設定を読み込めません。Officeの起動状態を確認してください。') }); return () => { alive = false } }, [route])
  const edit = changes => { setForm(current => ({ ...current, ...changes })); setConfirmed(false) }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await fetch(`${route}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, confirmed, revision: saved.revision }) })
      const value = await response.json(); if (!response.ok) throw new Error(value.error || '設定を保存できませんでした。')
      setSaved(value); setForm(value); setConfirmed(false); onSettings({ ...value, projectId: project.id })
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <section aria-label="サイト設定"><h2>サイト設定</h2>
    <p>カテゴリと許可する操作を保存してから利用してください。別ドメインは別のプロジェクトへ登録します。</p>
    {error && <p role="alert" className="corp-error">{error}</p>}
    {form && <form className="corp-editor" onSubmit={save}>
      <label>サイト名<input value={form.siteName} maxLength={120} onChange={e => edit({ siteName: e.target.value })} /></label>
      <label>登録サイトURL<input type="url" required value={form.siteUrl} onChange={e => edit({ siteUrl: e.target.value })} /></label>
      <label>サイトカテゴリ<select value={form.category} onChange={e => edit({ category: e.target.value, permissions: { diagnosis: true, ai: false, draft: false } })}>{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      <p>{form.category === 'general' ? '一般サイト：調査・AIチームによる記事案の検討・承認付き新規下書き保存を利用できます。カテゴリはAIの安全制限を解除する設定ではありません。' : form.category === 'restricted' ? '制限対象：機械的な技術点検と中立的な案内ページの別下書きだけを扱います。宣伝・アクセス増加・成人向けSEO・登録導線の最適化は行いません。' : '未分類：読み取りと機械的な診断だけです。文章生成・WordPress書き込み・公開はできません。'}</p>
      <fieldset><legend>許可する操作</legend>{[['diagnosis','公開サイト・Search Consoleの読み取り診断'],['ai', form.category === 'restricted' ? 'AIチームの技術保守検討' : 'AIチームの検討・記事案作成'],['draft', form.category === 'restricted' ? '中立的な案内ページの下書き保存' : '記事・固定ページの下書き保存']].map(([key,label]) => <label key={key}><input type="checkbox" disabled={form.category === 'unclassified' && key !== 'diagnosis'} checked={form.permissions[key] && (form.category !== 'unclassified' || key === 'diagnosis')} onChange={e => edit({ permissions: { ...form.permissions, [key]: e.target.checked } })} />{label}</label>)}</fieldset>
      <label>Search Consoleプロパティ<input value={form.property} maxLength={2048} placeholder="https://example.com/ または sc-domain:example.com" onChange={e => edit({ property: e.target.value })} /></label>
      <p>Google接続は既存の読み取り専用接続を共用します。プロパティと診断結果はプロジェクト別です。別Googleアカウントの同時接続は未対応です。</p>
      <p>WordPress接続：「WordPress保守」欄で、このプロジェクト専用の接続情報を入力します。設定変更・Office終了後は再入力が必要です。</p>
      <label>使用モデル<select value={form.model} disabled><option value="gpt-5.6-terra">GPT-5.6 Terra</option></select></label>
      <label>標準の思考レベル<select value={form.reasoningEffort} onChange={e => edit({ reasoningEffort: e.target.value })}><option value="low">低</option><option value="medium">標準</option></select></label>
      <p>Astraは実行時に理由を入力し、その回の使用を承認した場合だけ選べます。</p>
      <label>公開方法<select disabled value="manual"><option value="manual">人間がWordPressで手動公開</option></select></label>
      <label>定期実行<select disabled value="off"><option value="off">なし（この版では未対応）</option></select></label>
      <p>未対応：公開中ページの更新、テーマ・プラグイン操作、自動バックアップ、定期実行。削除・ユーザー変更・公開はこのOfficeから実行できません。</p>
      <p>変更前：{labels[saved.category]} → 変更後：{labels[form.category]}。操作権限の変更も履歴に保存します。</p>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />カテゴリと操作権限の変更を確認しました。</label>
      <button className="corp-primary" disabled={busy || !confirmed}>確認してサイト設定を保存</button>
      <details><summary>設定変更履歴（{saved.history.length}件）</summary>{saved.history.slice().reverse().map((item,i) => <p key={i}>{new Date(item.at).toLocaleString('ja-JP')}：{labels[item.before.category]} → {labels[item.after.category]}</p>)}</details>
    </form>}
  </section>
}
