import React from 'react'

const messages = {
  'source-unknown': 'トップページのHTMLを確認できませんでした。リンクが残っているかは未確認です。',
  'target-unconfirmed': '変更先の正常な応答を確認できません。リンクの置き換えはまだ提案できません。',
  'change-needed': '古いリンクがトップページに残っています。変更先は応答しました。',
  'legacy-link': '古いURLへのリンクはありますが、そのURLがリンク切れとは確認できていません。転送などの追加確認が必要です。',
  'replacement-observed': '古いリンクは見つからず、正しいリンクと変更先の応答を確認しました。',
  'link-not-found': 'このHTMLでは対象リンクを見つけられませんでした。JavaScript表示や別ページは未確認です。',
}
export default function MaintenanceActionSummary({ result, history = [], busy, onCheck }) {
  const needsChange = result?.items?.some(item => item.state === 'change-needed')
  return <section aria-label="今の結果と次の操作" style={{ border: '2px solid #477d66', borderRadius: 12, padding: 16, marginBottom: 16 }}>
    <h2>今の結果と次の操作</h2>
    <p>対象：お問い合わせ・プライバシーポリシーへのリンク</p>
    <h3>今の結果</h3>
    {!result ? <p>正しい公開先は登録済みです。トップページに古いリンクが残っているかは、Officeではまだ確認していません。</p> : <>
      <p>確認日時：{new Date(result.checkedAt).toLocaleString('ja-JP')}。サイトへの書き込みはしていません。</p>
      {result.items.map(item => <article key={item.key} style={{ borderTop: '1px solid #dfe8e3', paddingTop: 8 }}>
        <h4>{item.label}</h4><p>{messages[item.state] || '確認結果を判定できませんでした。再確認してください。'}</p>
        <p>変更前のリンク先：<code>{item.before}</code>（HTTP {item.beforeCheck.status ?? '未確認'}）<br />変更後の候補：<code>{item.after}</code>（HTTP {item.afterCheck.status ?? '未確認'}）</p>
        <p>トップページのHTML内：古いリンク {item.oldLinks ?? '未確認'} 件／正しいリンク {item.newLinks ?? '未確認'} 件</p>
      </article>)}
    </>}
    <h3>今、何をすればよいか</h3>
    {needsChange ? <p><strong>リンク修正が必要です。ただし、自動修正はOffice側の実装待ちです。</strong>編集元のファイル・設定と変更前後を特定する機能が不足しています。あなたの承認待ちではありません。</p> : <p>{result ? '確認結果は保存されています。サイトを別途修正した後は、同じボタンで古いリンクがなくなったか確認できます。' : '下のボタンを1回押してください。2つの公開先と古いURL、トップページ内の対象リンクをまとめて確認します。チャットへの貼り付けは不要です。'}</p>}
    <button className="corp-primary" disabled={busy} onClick={onCheck}>{busy ? '処理の終了をお待ちください…' : result ? '現在のリンクを再確認する' : '2つのリンクをまとめて確認する'}</button>
    <h3>結果、どうなるか</h3>
    <p>この操作で、修正が必要なリンクと変更先が明確になります。将来リンクを修正すると、利用者が既存のお問い合わせ・プライバシーポリシーを開ける状態を目指せます。確認ボタン自体はサイトを修正しません。</p>
    <p className="corp-muted">対象は登録サイトのトップページ1件と2組のURLだけです。本文は保存せずAIへ送りません。HTTP確認と静的HTML内のリンク確認であり、クリック操作・スマホ表示・WordPressの編集元は未確認です。</p>
    <details><summary>確認履歴（{history.length}件）</summary>{history.slice().reverse().map((entry, i) => <p key={i}>{new Date(entry.checkedAt).toLocaleString('ja-JP')}：{entry.items.map(item => `${item.label}：${messages[item.state] || '未確認'}`).join(' ／ ')}</p>)}</details>
  </section>
}
