import React, { useEffect, useState } from 'react'
const labels = { unclassified: '未分類', general: '一般サイト', restricted: '制限対象サイト（成人向けなど）' }
export default function SiteSettingsPanel({ project, onSettings }) {
  const [saved, setSaved] = useState(null), [form, setForm] = useState(null), [confirmed, setConfirmed] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [listing, setListing] = useState(null), [loading, setLoading] = useState(false), [propertyNotice, setPropertyNotice] = useState('')
  const route = `/api/seo/projects/${encodeURIComponent(project.id)}`
  useEffect(() => { let alive = true; fetch(route).then(r => r.json()).then(data => { if (alive && data.settings) { setSaved(data.settings); setForm(data.settings); onSettings({ ...data.settings, projectId: project.id }) } }).catch(() => { if (alive) setError('設定を読み込めません。Officeの起動状態を確認してください。') }); return () => { alive = false } }, [route])
  const edit = changes => { setForm(current => ({ ...current, ...changes })); setConfirmed(false) }
  async function loadProperties() {
    setLoading(true); setListing(null); setPropertyNotice('')
    try { const response = await fetch(`${route}/properties`); const data = await response.json(); if (!response.ok) throw new Error(); setListing(data) }
    catch { setListing({ sites: [], reason: 'failed' }) } finally { setLoading(false) }
  }
  async function saveProperty(manual = false) {
    setLoading(true); setPropertyNotice('')
    try {
      const response = await fetch(`${route}/property`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ property: form.property, expectedProperty: saved.property, manual }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '保存できませんでした。もう一度お試しください。')
      setSaved(data); setForm(current => ({ ...current, property: data.property })); setConfirmed(false); onSettings({ ...data, projectId: project.id })
      setPropertyNotice(manual ? 'このプロジェクトへ保存しました。Googleの閲覧権限は未確認です。「診断結果」で情報取得を試してください。' : 'このプロジェクトへ保存しました。「診断結果」でGoogle側の診断情報を取得できます。')
    } catch(e) { setPropertyNotice(e.message) } finally { setLoading(false) }
  }
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
      <fieldset disabled={busy || loading} style={{ minWidth: 0 }}><legend>Search Consoleプロパティ</legend>
        <p>保存済みの登録URL：{saved.siteUrl || '未登録。先にサイト設定を保存してください。'}</p>
        <p>保存済みプロパティ：{saved.property || '未選択'}</p>
        <button type="button" onClick={loadProperties}>閲覧できるサイト一覧を取得</button>
        {loading && <p role="status">Googleの一覧を確認しています…</p>}
        {listing?.reason && <p role="alert">{listing.reason === 'not-connected' ? 'Googleが未接続、または再認証が必要です。「診断結果」の「Search Consoleに接続」から承認し、戻って一覧を取得してください。' : listing.reason === 'forbidden' ? 'Googleからアクセスが拒否されました。対象アカウントの閲覧権限とSearch Console APIの有効化を確認してください。' : '一覧を取得できませんでした。通信状態を確認して再取得してください。未登録とは断定できません。詳細設定から手入力もできます。'}</p>}
        {listing?.unknowns?.length > 0 && !listing.reason && <p role="alert">一覧を取得できませんでした。Google接続を確認して再取得してください。</p>}
        {listing && !listing.reason && !listing.unknowns?.length && <>
          <p>{listing.sites.length ? `取得したプロパティ：${listing.sites.length}件。登録URLに対応する候補を先頭に表示します。` : '閲覧できるプロパティがありません。Googleアカウント、Search Consoleのサイト登録・所有権確認・閲覧権限を確認してください。'}</p>
          {!!listing.sites.length && !listing.sites.some(item => item.selectable) && <p>選択できる一致候補がありません。未登録・権限不足のほか、http/https・www・パスの違いが考えられます。</p>}
          <label>Search Consoleのサイト（このプロジェクト）<select value={form.property} onChange={e => { edit({ property: e.target.value }); setPropertyNotice('選択は未保存です。下の保存ボタンを押してください。') }}>
            <option value="">プロパティを選んでください</option>
            {form.property && !listing.sites.some(item => item.siteUrl === form.property) && <option value={form.property}>現在の入力：{form.property}（一覧で未確認）</option>}
            {listing.sites.map(item => <option key={item.siteUrl} value={item.siteUrl} disabled={!item.selectable}>{item.label}：{item.siteUrl} ／ {({siteOwner:'所有者',siteFullUser:'フルユーザー',siteRestrictedUser:'制限付きユーザー',siteUnverifiedUser:'未確認ユーザー'})[item.permissionLevel] || '権限不明'}</option>)}
          </select></label>
          <button type="button" disabled={!saved.siteUrl || !listing.sites.some(item => item.siteUrl === form.property && item.selectable)} onClick={() => saveProperty()}>選択したプロパティを保存</button>
        </>}
        <p>ドメイン形式はサブドメインも含みます。URLプレフィックスはhttp/https・www・パスを区別します。ルートURL登録に対する一部パスだけのプロパティは選択できません。</p>
        <details><summary>詳細設定・一覧を取得できない場合の手入力</summary>
          <label>Search Consoleプロパティ（手入力）<input value={form.property} maxLength={2048} placeholder="https://example.com/ または sc-domain:example.com" onChange={e => { edit({ property: e.target.value }); setPropertyNotice('入力は未保存です。') }} /></label>
          <p>登録済みプロパティの表記を正確に入力してください。手入力ではGoogleの閲覧権限を確認できません。</p>
          <button type="button" disabled={!saved.siteUrl || !form.property} onClick={() => saveProperty(true)}>手入力のプロパティを保存</button>
        </details>
        {propertyNotice && <p role="status">{propertyNotice}</p>}
        <p>ここでの保存はプロパティだけです。カテゴリ・操作権限・WordPress接続は変更しません。Google上のサイト登録・公開・インデックス申請は行いません。</p>
      </fieldset>
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
      <details><summary>設定変更履歴（{saved.history.length}件）</summary>{saved.history.slice().reverse().map((item,i) => <p key={i}>{new Date(item.at).toLocaleString('ja-JP')}：{item.before.property !== item.after.property ? `Search Console：${item.before.property || '未選択'} → ${item.after.property || '未選択'}` : `${labels[item.before.category]} → ${labels[item.after.category]}`}</p>)}</details>
    </form>}
  </section>
}
