import React, { useEffect, useState } from 'react'
import { createRevenueAnalysisReview, enqueueEnabledRevenueQueries, enqueueRevenueAnalysis, enqueueRevenueTracking, loadRevenueDashboard, updateRevenueQuery } from '../services/revenueLabApi'
import './revenueLabDashboard.css'

const EMPTY = { config: { configured: false, missing: [], analysis: { configured: false, missing: ['OPENAI_API_KEY'] } }, queries: [], opportunities: [], trackingOpportunities: [], analyses: [], latestJob: null, latestRun: null, latestTrackingRun: null }

export function scoreLabel(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '—'
}

export function scoreStrength(value) {
  const score = Number(value)
  if (score >= 90) return '非常に強い'
  if (score >= 75) return '強い'
  if (score >= 60) return '注目'
  if (score >= 40) return '普通'
  return '弱い'
}

export function velocityPresentation(mode) {
  return mode === 'observed_delta'
    ? { label: '実測', tone: 'observed', description: '前回取得から今回取得までの実際の再生増加速度です。' }
    : { label: '公開後推定', tone: 'estimated', description: '初回取得のため、公開から現在までの平均再生速度です。' }
}

export function opportunityReasons(item) {
  const reasons = []
  if (Number(item.velocityPercentile) >= 75) reasons.push('再生速度が母集団上位')
  if (item.channelRatioPercentile != null && Number(item.channelRatioPercentile) >= 75) reasons.push('チャンネル規模に対して再生数が多い')
  if (Number(item.engagementPercentile) >= 75) reasons.push('engagementが高い')
  if (Number(item.freshness) >= 75) reasons.push('公開直後で鮮度が高い')
  if (reasons.length) return reasons
  const candidates = [
    [Number(item.velocityPercentile), '母集団内の再生速度を評価'],
    [Number(item.channelRatioPercentile), 'チャンネル規模に対する再生数を評価'],
    [Number(item.engagementPercentile), 'engagementを評価'],
    [Number(item.freshness), '公開後の鮮度を評価'],
  ].filter(([value]) => Number.isFinite(value))
  candidates.sort((left, right) => right[0] - left[0])
  return [candidates[0]?.[1] || '保存済みScore componentsで順位を決定']
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

export function nextCollectionLabel(value = new Date()) {
  const now = new Date(value)
  if (Number.isNaN(now.getTime())) return '—'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo',
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]))
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, -4, 15))
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
  return `${publishedLabel(next)}（毎日 05:15 JST）`
}

function jobStatusLabel(status) {
  return ({ queued: '待機中', running: '実行中', succeeded: '成功', failed: '失敗', skipped: '対象外' })[status] || status || '—'
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

const recommendationLabel = value => ({ adopt: '採用', hold: '保留', exclude: '除外' })[value] || '—'
const confidenceLabel = value => ({ high: '高', medium: '中', low: '低' })[value] || value

function AnalysisPanel({ analysis, busy, onReview }) {
  if (!analysis) return <div className="revenue-analysis is-empty"><strong>AI分析</strong><p>まだ分析されていません。上部の「TOP1をAI分析」から1動画で品質を確認します。</p></div>
  if (analysis.status !== 'succeeded' || !analysis.output) return <div className={`revenue-analysis is-${analysis.status}`}><strong>AI分析</strong><p>{({ pending: 'ジョブ待機中', running: 'メタデータを分析中', refused: '分析は拒否されました', incomplete: '分析結果が未完了です', failed: '分析に失敗しました' })[analysis.status] || analysis.status}</p></div>
  const output = analysis.output
  return <section className="revenue-analysis is-succeeded" aria-label="AI Opportunity Analyst">
    <div className="revenue-analysis-heading"><strong>AI Opportunity Analyst</strong><span>{recommendationLabel(output.recommendation)}</span></div>
    <p className="revenue-analysis-note">保存済みメタデータだけを使った解釈です。動画本文・映像・字幕・商品リンクは確認していません。</p>
    <dl><div><dt>商品・テーマ</dt><dd>{output.product_or_theme_name}</dd></div><div><dt>動画の主題候補</dt><dd>{output.video_subject}</dd></div><div><dt>推奨理由</dt><dd>{output.recommendation_reason}</dd></div></dl>
    <strong>成長仮説</strong><ul>{output.growth_hypotheses?.map((hypothesis, index) => <li key={`${hypothesis.hypothesis}-${index}`}><b>確信度 {confidenceLabel(hypothesis.confidence)}</b> {hypothesis.hypothesis}<small>{hypothesis.supporting_indicators?.join(' / ')}</small></li>)}</ul>
    <details><summary>企画・商品探索の詳細</summary><dl>
      <div><dt>商品検索キーワード</dt><dd>{output.product_search_keywords?.join(' / ') || '—'}</dd></div>
      <div><dt>類似商品カテゴリ</dt><dd>{output.similar_product_categories?.join(' / ') || '—'}</dd></div>
      <div><dt>動画企画案</dt><dd>{output.video_ideas?.join(' / ') || '—'}</dd></div>
      <div><dt>Hook案</dt><dd>{output.hooks?.join(' / ') || '—'}</dd></div>
      <div><dt>根拠品質</dt><dd>{output.evidence_quality === 'moderate' ? '中程度' : '限定的'}</dd></div>
    </dl></details>
    {analysis.id && <div className="revenue-human-review"><span>人間評価</span>{['adopt', 'hold', 'exclude'].map(decision => <button type="button" key={decision} disabled={busy} onClick={() => onReview(analysis, decision)}>{recommendationLabel(decision)}</button>)}</div>}
  </section>
}

function OpportunityCard({ item, index, tracking = false, analysis, busy, onReview }) {
  const reviewUrl = videoReviewUrl(item)
  const velocity = velocityPresentation(item.velocityMode)
  const reasons = opportunityReasons(item)
  return <article className="revenue-opportunity">
    <span className="revenue-rank">#{index + 1}</span>
    {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    <div><p className="revenue-channel">{item.channelTitle || 'チャンネル不明'}</p><h3>{item.title}</h3>
      <dl className="revenue-review-metrics">
        <div><dt>公開日時</dt><dd>{publishedLabel(item.publishedAt)}</dd></div>
        <div><dt>再生数</dt><dd>{metricCount(item.viewCount)}</dd></div>
        <div><dt>登録者数</dt><dd>{item.hiddenSubscriberCount ? '非公開' : metricCount(item.subscriberCount)}</dd></div>
        <div><dt>登録者数に対する再生倍率</dt><dd>{item.channelRatio == null ? '—' : `${Number(item.channelRatio).toFixed(2)}倍`}</dd></div>
        <div><dt>Views/hour</dt><dd>{Number.isFinite(Number(item.viewsVelocity)) ? Number(item.viewsVelocity).toFixed(6) : '—'}</dd></div>
        {tracking && <div><dt>前回比</dt><dd>{item.growthRatio == null ? '—' : `${Number(item.growthRatio).toFixed(3)}倍（+${Number(item.growthPercent).toFixed(2)}%）`}</dd></div>}
      </dl>
      <div className="revenue-score"><strong>{scoreLabel(item.opportunityScore)}</strong><span>Opportunity<br />{scoreStrength(item.opportunityScore)}</span><b>{scoreLabel(item.breakoutScore)}</b><span>Breakout<br />{scoreStrength(item.breakoutScore)}</span></div>
      <div className={`revenue-velocity is-${velocity.tone}`}><span>{velocity.label}</span><p>{velocity.description}</p></div>
      {item.velocityMode === 'observed_delta' && item.previousViewCount != null && <dl className="revenue-observed-details">
        <div><dt>前回再生数</dt><dd>{metricCount(item.previousViewCount)}</dd></div>
        <div><dt>現在再生数</dt><dd>{metricCount(item.viewCount)}</dd></div>
        <div><dt>増加再生数</dt><dd>+{metricCount(item.viewIncrease, '0')}</dd></div>
        <div><dt>経過時間</dt><dd>{Number(item.velocityElapsedHours).toFixed(2)}時間</dd></div>
        <div><dt>実測Views/hour</dt><dd>{Number(item.viewsVelocity).toFixed(6)}</dd></div>
      </dl>}
      <div className="revenue-reasons"><strong>なぜ上位なのか</strong><ul>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>
      <p className="revenue-meta">母集団 {item.percentilePopulationSize}件 · {item.scoreVersion}</p>
      <details className="revenue-score-details"><summary>詳細を見る</summary><dl>
        <div><dt>再生速度 percentile</dt><dd>{scoreLabel(item.velocityPercentile)}</dd></div>
        <div><dt>チャンネル倍率 percentile</dt><dd>{scoreLabel(item.channelRatioPercentile)}</dd></div>
        <div><dt>engagement percentile</dt><dd>{scoreLabel(item.engagementPercentile)}</dd></div>
        <div><dt>channel_ratio</dt><dd>{item.channelRatio == null ? '—' : Number(item.channelRatio).toFixed(6)}</dd></div>
        <div><dt>engagement_rate</dt><dd>{scoreLabel(item.engagementRate)}</dd></div>
        <div><dt>freshness</dt><dd>{scoreLabel(item.freshness)}</dd></div>
        <div><dt>Buyer Intent</dt><dd>{metricCount(item.buyerIntent)}</dd></div>
        <div><dt>Commerce Fit</dt><dd>{metricCount(item.commerceFit)}</dd></div>
      </dl></details>
      {reviewUrl && <a className="revenue-youtube-link" href={reviewUrl} target="_blank" rel="noopener noreferrer">YouTubeで見る</a>}
      <AnalysisPanel analysis={analysis} busy={busy} onReview={onReview} />
    </div>
  </article>
}

function OpportunitySection({ title, description, items, tracking = false, configured, analysisByItem = new Map(), busy, onReview = () => {} }) {
  return <section className="revenue-ranking-section">
    <div className="revenue-section-heading"><div><p className="revenue-kicker">{tracking ? 'OBSERVED TRACKING' : 'DAILY DISCOVERY'}</p><h2>{title}</h2><p>{description}</p></div></div>
    <div className="revenue-grid" aria-label={title}>
      {items.map((item, index) => <OpportunityCard key={item.id || item.youtubeVideoId} item={item} index={index} tracking={tracking} analysis={analysisByItem.get(item.sourceItemId)} busy={busy} onReview={onReview} />)}
      {configured && items.length === 0 && <div className="revenue-state"><h3>まだ候補がありません</h3><p>{tracking ? '6時間以上の間隔がある継続観測データを待っています。' : 'テーマのScore設定を保存して収集を実行してください。'}</p></div>}
    </div>
  </section>
}

export function RevenueLabView({ state, error, busy, onReload, onRun, onTrack, onAnalyze, onReview, onSave }) {
  if (!state) return <main className="revenue-shell" aria-busy="true"><div className="revenue-state"><h2>Revenue Lab</h2><p>収益機会を読み込んでいます…</p></div></main>
  const eligible = state.queries.filter(query => query.enabled && !queryNeedsScores(query))
  const enabledQueries = state.queries.filter(query => query.enabled)
  const lookbackDays = [...new Set(enabledQueries.map(query => query.lookbackDays).filter(Boolean))]
  const latestRun = state.latestRun
  const scoreVersion = state.opportunities[0]?.scoreVersion || 'youtube-v1'
  const analysisByItem = new Map((state.analyses || []).map(analysis => [analysis.sourceItemId, analysis]))
  return <main className="revenue-shell">
    <section className="revenue-hero">
      <div><p className="revenue-kicker">YOUTUBE COMMERCE · PHASE 1</p><h2>今日検討すべき候補</h2><p>本日の発掘と、過去候補の実測成長を分けて確認します。</p></div>
      <div className="revenue-actions"><button onClick={onReload} disabled={busy}>再読込</button><button onClick={onTrack} disabled={busy}>Tracking実行</button><button className="corp-primary" onClick={() => onRun(eligible)} disabled={busy || eligible.length === 0}>Discovery実行</button></div>
    </section>
    {error && <div className="revenue-alert" role="alert">{error}</div>}
    {!state.config.configured && <section className="revenue-state revenue-config"><h3>接続設定が必要です</h3><p>サーバー側の環境変数を設定してください。</p><code>{state.config.missing.join(', ')}</code></section>}
    {state.config.configured && state.queries.length === 0 && <section className="revenue-state"><h3>検索テーマがありません</h3><p>Supabaseの初期seedを適用して、最大3件のテーマを設定してください。</p></section>}
    <section className="revenue-research-summary" aria-labelledby="revenue-research-heading">
      <div className="revenue-section-heading"><div><p className="revenue-kicker">RESEARCH OVERVIEW</p><h2 id="revenue-research-heading">リサーチ概要</h2></div></div>
      <dl>
        <div className="revenue-summary-wide"><dt>検索テーマ</dt><dd>{enabledQueries.map(query => query.queryText).join(' / ') || '—'}</dd></div>
        <div><dt>最終収集日時（JST）</dt><dd>{publishedLabel(latestRun?.capturedAt)}</dd></div>
        <div><dt>対象期間</dt><dd>{lookbackDays.length ? lookbackDays.map(days => `直近${days}日`).join(' / ') : '—'}</dd></div>
        <div><dt>取得動画数</dt><dd>{metricCount(latestRun?.receivedCount)}</dd></div>
        <div><dt>Score対象動画数</dt><dd>{metricCount(latestRun?.scoredCount)}</dd></div>
        <div><dt>score_version</dt><dd>{scoreVersion}</dd></div>
        <div><dt>最新job状態</dt><dd><span className={`revenue-status is-${state.latestJob?.status || 'unknown'}`}>{jobStatusLabel(state.latestJob?.status)}</span></dd></div>
        <div className="revenue-summary-wide"><dt>次回予定収集時刻</dt><dd>{nextCollectionLabel()}</dd></div>
      </dl>
    </section>
    <section className="revenue-analyst-intro">
      <div><p className="revenue-kicker">PHASE 2 · METADATA ONLY</p><h2>AI Opportunity Analyst</h2><p>既存Scoreの上に、商品化の仮説と次の行動を追加します。Scoreと順位は変更しません。</p></div>
      <button className="corp-primary" disabled={busy || !state.config.analysis?.configured || (!state.opportunities.length && !state.trackingOpportunities.length)} onClick={onAnalyze}>TOP1をAI分析</button>
      {!state.config.analysis?.configured && <p className="revenue-warning">サーバー側に OPENAI_API_KEY を設定すると利用できます。Discovery / Trackingは引き続き利用できます。</p>}
    </section>
    <OpportunitySection title="本日の発掘TOP3" description="本日のsearch.listで発掘した候補です。過去動画が再登場する場合もあります。" items={state.opportunities || []} configured={state.config.configured} analysisByItem={analysisByItem} busy={busy} onReview={onReview} />
    <OpportunitySection title="継続観測・急伸TOP3" description="発見後7日間、6時間以上の間隔で実測した成長候補です。" items={state.trackingOpportunities || []} tracking configured={state.config.configured} analysisByItem={analysisByItem} busy={busy} onReview={onReview} />
    <details className="revenue-score-guide"><summary>スコアについて</summary><dl>
      <div><dt>Breakout Score</dt><dd>再生速度、チャンネル規模比、反応率、鮮度から「通常より勢いがあるか」を示します。</dd></div>
      <div><dt>Opportunity Score</dt><dd>Breakout Scoreを70%、Buyer IntentとCommerce Fitを各15%で補正した企画候補順位です。</dd></div>
      <div><dt>Views/hour</dt><dd>1時間あたりの再生増加速度です。初回は公開後平均、2回目以降は前回との差分を使います。</dd></div>
      <div><dt>Buyer Intent</dt><dd>検索テーマに「買う意図」がどれくらい含まれるかを人間が0〜100で設定します。</dd></div>
      <div><dt>Commerce Fit</dt><dd>検索テーマが商品紹介にどれくらい適しているかを人間が0〜100で設定します。</dd></div>
      <div><dt>母集団</dt><dd>同じ検索テーマ・同じ収集runで取得とScore算出に成功した動画群です。</dd></div>
    </dl></details>
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
  const review = (analysis, decision) => perform(() => createRevenueAnalysisReview(
    analysis.id, decision, decision === analysis.output?.recommendation ? 'agree' : 'disagree',
  ))
  return <RevenueLabView state={state} error={error} busy={busy} onReload={reload} onRun={queries => perform(() => enqueueEnabledRevenueQueries(queries))} onTrack={() => perform(enqueueRevenueTracking)} onAnalyze={() => perform(() => enqueueRevenueAnalysis(1))} onReview={review} onSave={(id, values) => perform(() => updateRevenueQuery(id, values))} />
}
