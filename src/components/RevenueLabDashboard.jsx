import React, { useEffect, useState } from 'react'
import { enqueueEnabledRevenueQueries, loadRevenueDashboard, updateRevenueQuery } from '../services/revenueLabApi'
import './revenueLabDashboard.css'

const EMPTY = { config: { configured: false, missing: [] }, queries: [], opportunities: [], latestJob: null }

export function scoreLabel(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—'
}

export function queryNeedsScores(query) {
  return query.buyerIntent == null || query.commerceFit == null
}

export function videoReviewUrl(item) {
  if (item?.sourceUrl) {
    try {
      const url = new URL(item.sourceUrl)
      const host = url.hostname.toLowerCase()
      if (url.protocol === 'https:' && (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be')) return url.toString()
    } catch {}
  }
  return item?.youtubeVideoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(item.youtubeVideoId)}` : null
}

export function metricCount(value, missing = '—') {
  if (value == null || !Number.isFinite(Number(value))) return missing
  return new Intl.NumberFormat('ja-JP').format(Number(value))
}

export function publishedLabel(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  }).format(date)
}

function QueryEditor({ query, busy, onSave }) {
  const [form, setForm] = useState({
    label: query.label,
    queryText: query.queryText,
    buyerIntent: query.buyerIntent ?? '',
    commerceFit: query.commerceFit ?? '',
    enabled: query.enabled,
  })
  const score = value => value === '' ? null : Number(value)
  return <form className="revenue-query" onSubmit={event => {
    event.preventDefault()
    onSave(query.id, { ...form, buyerIntent: score(form.buyerIntent), commerceFit: score(form.commerceFit) })
  }}>
    <div className="revenue-query-heading">
      <strong>{query.label}</strong>
      <label className="revenue-toggle"><input type="checkbox" checked={form.enabled} onChange={event => setForm({ ...form, enabled: event.target.checked })} />有効</label>
    </div>
    <label>表示名<input value={form.label} maxLength={80} required onChange={event => setForm({ ...form, label: event.target.value })} /></label>
    <label>YouTube検索テーマ<input value={form.queryText} maxLength={200} required onChange={event => setForm({ ...form, queryText: event.target.value })} /></label>
    <div className="revenue-score-inputs">
      <label>Buyer intent<input type="number" min="0" max="100" step="1" value={form.buyerIntent} onChange={event => setForm({ ...form, buyerIntent: event.target.value })} /></label>
      <label>Commerce fit<input type="number" min="0" max="100" step="1" value={form.commerceFit} onChange={event => setForm({ ...form, commerceFit: event.target.value })} /></label>
    </div>
    {queryNeedsScores({ buyerIntent: score(form.buyerIntent), commerceFit: score(form.commerceFit) }) && <p className="revenue-warning">両方のScore設定がないテーマはランキング対象外です。</p>}
    <button className="corp-primary" disabled={busy} type="submit">設定を保存</button>
  </form>
}

export function RevenueLabView({ state, error, busy, onReload, onRun, onSave }) {
  if (!state) return <main className="revenue-shell" aria-busy="true"><div className="revenue-state"><h2>Revenue Lab</h2><p>収益機会を読み込んでいます…</p></div></main>
  const eligible = state.queries.filter(query => query.enabled && !queryNeedsScores(query))
  return <main className="revenue-shell">
    <section className="revenue-hero">
      <div><p className="revenue-kicker">YOUTUBE COMMERCE · PHASE 1</p><h2>今日検討すべきTOP3</h2><p>直近7日・日本語圏の動画を、再現可能な youtube-v1 で順位付けします。</p></div>
      <div className="revenue-actions"><button onClick={onReload} disabled={busy}>再読込</button><button className="corp-primary" onClick={() => onRun(eligible)} disabled={busy || eligible.length === 0}>今すぐ収集</button></div>
    </section>
    {error && <div className="revenue-alert" role="alert">{error}</div>}
    {!state.config.configured && <section className="revenue-state revenue-config"><h3>接続設定が必要です</h3><p>サーバー側の環境変数を設定してください。</p><code>{state.config.missing.join(', ')}</code></section>}
    {state.config.configured && state.queries.length === 0 && <section className="revenue-state"><h3>検索テーマがありません</h3><p>Supabaseの初期seedを適用して、最大3件のテーマを設定してください。</p></section>}
    <section className="revenue-grid" aria-label="Opportunity TOP3">
      {state.opportunities.map((item, index) => {
        const reviewUrl = videoReviewUrl(item)
        return <article className="revenue-opportunity" key={item.id || item.youtubeVideoId}>
          <span className="revenue-rank">#{index + 1}</span>
          {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
          <div><p className="revenue-channel">{item.channelTitle || 'チャンネル不明'}</p><h3>{item.title}</h3>
            <dl className="revenue-review-metrics">
              <div><dt>公開日時</dt><dd>{publishedLabel(item.publishedAt)}</dd></div>
              <div><dt>再生数</dt><dd>{metricCount(item.viewCount)}</dd></div>
              <div><dt>登録者数</dt><dd>{item.hiddenSubscriberCount ? '非公開' : metricCount(item.subscriberCount)}</dd></div>
              <div><dt>Views/hour</dt><dd>{Number.isFinite(Number(item.viewsVelocity)) ? Number(item.viewsVelocity).toFixed(6) : '—'}</dd></div>
            </dl>
            <div className="revenue-score"><strong>{scoreLabel(item.opportunityScore)}</strong><span>Opportunity</span><b>{scoreLabel(item.breakoutScore)}</b><span>Breakout</span></div>
            <p className="revenue-meta">{item.velocityMode === 'observed_delta' ? '実測増分' : '公開後推定'} · 母集団 {item.percentilePopulationSize}件</p>
            {reviewUrl && <a className="revenue-youtube-link" href={reviewUrl} target="_blank" rel="noopener noreferrer">YouTubeで見る</a>}
          </div>
        </article>
      })}
      {state.config.configured && state.opportunities.length === 0 && <div className="revenue-state"><h3>まだ候補がありません</h3><p>テーマのScore設定を保存して収集を実行してください。</p></div>}
    </section>
    <section className="revenue-settings">
      <div className="revenue-section-heading"><div><p className="revenue-kicker">QUERY SETTINGS</p><h2>検索テーマ</h2></div><span>有効 {state.queries.filter(query => query.enabled).length} / 3</span></div>
      <div className="revenue-query-grid">{state.queries.map(query => <QueryEditor key={query.id} query={query} busy={busy} onSave={onSave} />)}</div>
    </section>
    {state.latestJob && <p className="revenue-job" role="status">最新ジョブ: {state.latestJob.status} / 試行 {state.latestJob.attempts}{state.latestJob.errorCode ? ` / ${state.latestJob.errorCode}` : ''}</p>}
  </main>
}

export default function RevenueLabDashboard() {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = async () => {
    setError('')
    try { setState(await loadRevenueDashboard()) }
    catch (failure) { setState(previous => previous || EMPTY); setError(failure.message) }
  }
  useEffect(() => { reload() }, [])
  const perform = async action => {
    setBusy(true); setError('')
    try { await action(); await reload() }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <RevenueLabView state={state} error={error} busy={busy} onReload={reload} onRun={queries => perform(() => enqueueEnabledRevenueQueries(queries))} onSave={(id, values) => perform(() => updateRevenueQuery(id, values))} />
}
