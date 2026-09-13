import React from 'react'
import { resourceKind } from '../../scripts/maintenance-resource.mjs'

export function describeMaintenancePage(page) {
  let path = '', label = 'その他のURL'
  try { path = decodeURIComponent(new URL(page.url).pathname) } catch {}
  const type = resourceKind(page.url, page.contentType)
  if (path === '/') label = 'トップページ（LP）'
  else if (path === '/お問い合わせ/' || path === '/contact/') label = 'お問い合わせのURL'
  else if (path === '/プライバシーポリシー/' || path === '/privacy-policy/') label = 'プライバシーポリシーのURL'
  else if (type === 'xml' || type === 'xml-candidate') label = 'XMLファイル（サイトマップ等）'
  else if (type === 'asset' || type === 'asset-candidate') label = '付随ファイルのURL'
  const headingCheck = type === 'html' && page.status === 200
  return { label, type, headingCheck, path }
}

export default function MaintenanceReview({ report, checks = {}, busy, onCheck, onReview }) {
  if (!report) return null
  const pages = report.pages || []
  const failed = pages.filter(p => p.status === 404 || p.status === 410).length
  return <section aria-label="技術保守の確認結果" className="maintenance-review">
    <h3>何が分かり、次に何をするか</h3>
    <p><strong>調査報告です。承認して実行できる修正案はまだありません。</strong></p>
    <p>サイトは変更していません。以下の「このURLの応答を再確認」で、現在の応答とファイル種別を確認できます。本文の取得・編集・公開は行いません。</p>
    <p>診断日時：{new Date(report.generatedAt).toLocaleString('ja-JP')}。{failed ? `404・410の記録は${failed}件です。同じURLの記録が複数ある場合があります。` : 'この取得範囲に404・410の記録はありません。全体の正常性を保証するものではありません。'}</p>
    <p>今後の完成条件：対象URL、変更前後、変更理由、危険性、確認方法が揃い、実装が対応する操作であること。その段階で初めて個別承認に進みます。現在のWordPress保守は別下書き保存のみで、リンク設定やリダイレクトは変更できません。</p>
    {pages.slice(0, 10).map((page, index) => {
      const info = describeMaintenancePage(page), check = checks[index]
      const missing = page.status === 404 || page.status === 410
      return <article key={index} style={{ border: '1px solid #dfe8e3', borderRadius: 8, padding: 12, marginTop: 12 }}>
        <h4>記録{index + 1}：{info.label}</h4>
        <p style={{ overflowWrap: 'anywhere' }}>{page.url}</p>
        <p>観測結果：HTTP {page.status ?? '未確認'}</p>
        <p>{missing ? 'このURLは診断時に見つかりませんでした。正しいリンク先か、まだページを作っていないかは未確認です。まず現在も同じ応答かを確認します。' : info.type.startsWith('xml') ? 'XMLは通常の閲覧用ページではありません。見出しが0件でも、HTMLの見出し不備とは判定しません。' : !info.headingCheck ? '過去の記録にはHTML種別の確証がありません。見出し数だけで修正の要否は判定しません。' : '応答したことは確認できています。表示・リンク全体・修正の必要性は別の確認が必要です。'}</p>
        <button disabled={busy} onClick={() => onCheck(index)}>このURLの応答を再確認（読み取りのみ）</button>
        {check && <div role="status"><p>再確認：{new Date(check.checkedAt).toLocaleString('ja-JP')} ／ HTTP {check.status} ／ {({ html: 'HTML', xml: 'XML', 'xml-candidate': 'URL上はXML候補', asset: 'HTML以外', 'asset-candidate': '付随ファイル候補', unknown: '種別未確認' })[check.type]}</p>
          <p>{check.status === 404 || check.status === 410 ? '現在のヘッダー確認でも見つかりません。ページを復旧するか、リンク先を直すか、意図した削除かはまだ確定していません。' : check.status >= 300 && check.status < 400 ? '転送応答です。転送先にはアクセスしていません。' : check.status === 405 ? 'このサーバーはHEAD確認に対応していません。ページが壊れているとは判断できません。' : check.status === 200 ? 'HEADでは応答しました。本文・画面表示まで確認した結果ではありません。' : 'この応答だけでは修正内容を確定できません。'}</p>
          <p className="corp-muted">再確認はHEAD方式です。元のGET診断とは条件が異なり、本文やスマホ表示は未確認です。サイトに変更はありません。</p>
        </div>}
      </article>
    })}
    <button disabled={busy || !Object.keys(checks).length} onClick={onReview}>再確認結果をAIチームに渡して再検討</button>
    <p className="corp-muted">AI利用枠を消費します。上のモデル・思考レベル設定を使います。再確認の日時とHEAD方式であることもAIへ渡します。修正・公開の承認ではありません。</p>
    <p>下の「案内ページの動作確認」は別のテストです。この診断の修正ではないため、重ねて承認する必要はありません。</p>
  </section>
}
