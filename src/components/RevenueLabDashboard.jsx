import React, { useEffect, useRef, useState } from 'react'
import { createManualCampaign as createManualCampaignRequest, createProductAssetRevision, createProductCandidateDecision, enqueueCreativeProductionPlan, enqueueImageVideoGeneration, enqueueVideoGeneration, createRevenueAnalysisReview, createThreePicksCampaign as createThreePicksCampaignRequest, enqueueEnabledRevenueQueries, enqueueFinalComposition, enqueueProductSearch, enqueueRevenueAnalysis, enqueueRevenueTracking, enqueueThreePicksPlan, loadFinalCompositionPreview, loadRevenueDashboard, registerCampaignPublication, updateRevenueQuery } from '../services/revenueLabApi'
import './revenueLabDashboard.css'

const EMPTY = { config: { configured: false, missing: [], analysis: { configured: false, missing: ['OPENAI_API_KEY'] }, creativeProduction: { configured: false, missing: ['OPENAI_API_KEY'] }, multiProductShorts: { configured: false, missing: ['OPENAI_API_KEY'] }, finalComposition: { configured: false, missing: ['REVENUE_LAB_FFMPEG_PATH'] }, productAssetRevisions: { configured: false, missing: ['REVENUE_LAB_PRODUCT_ASSET_BUCKET'] }, videoGeneration: { configured: false, missing: ['POLLO_API_KEY'], provider: 'pollo', requestedModel: 'pollo-v2' }, imageToVideo: { configured: false, missing: ['POLLO_API_KEY', 'REVENUE_LAB_PRODUCT_ASSET_BUCKET'], provider: 'pollo', requestedModel: 'wan-v2-2-flash' }, products: { configured: false, missing: ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'] } }, queries: [], opportunities: [], trackingOpportunities: [], analyses: [], productSearches: [], campaigns: [], latestJob: null, latestRun: null, latestTrackingRun: null }

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
  return ({ queued: '待機中', running: '実行中', polling: '生成中', submission_uncertain: '送信結果不明', succeeded: '成功', failed: '失敗', skipped: '対象外' })[status] || status || '—'
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

const recommendationLabel = value => ({ adopt: '次の調査対象として採用', hold: '保留', exclude: '除外' })[value] || '—'
const confidenceLabel = value => ({ high: '高', medium: '中', low: '低' })[value] || value

export function safeRakutenUrl(value) {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    return url.protocol === 'https:' && (host === 'rakuten.co.jp' || host.endsWith('.rakuten.co.jp')) ? url.toString() : null
  } catch { return null }
}

const productDecisionLabel = value => ({ selected_for_research: '次の調査対象', shortlisted: '候補保存', hold: '保留', rejected: '除外' })[value] || '未判断'

export function manualProductSearchLinks(keywords = []) {
  const terms = [...new Set(keywords.filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean))].slice(0, 8)
  return terms.flatMap(keyword => {
    const query = encodeURIComponent(keyword)
    return [
      { provider: 'Amazon', discoveryChannel: 'amazon_search', keyword, url: `https://www.amazon.co.jp/s?k=${query}` },
      { provider: '楽天市場', discoveryChannel: 'rakuten_search', keyword, url: `https://search.rakuten.co.jp/search/mall/${query}/` },
      { provider: 'Yahoo!ショッピング', discoveryChannel: 'yahoo_search', keyword, url: `https://shopping.yahoo.co.jp/search?p=${query}` },
      { provider: 'Google', discoveryChannel: 'google_search', keyword, url: `https://www.google.com/search?q=${query}` },
    ]
  })
}

export function newCampaignIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function campaignSavePresentation(submitting, saved) {
  if (saved) return { label: '保存済み', disabled: true }
  if (submitting) return { label: '保存中…', disabled: true }
  return { label: '商品・Campaign・Iterationを保存', disabled: false }
}

function ManualCampaignForm({ analysis, busy, onCreate }) {
  const keywords = [...new Set((analysis?.output?.product_search_keywords || []).filter(Boolean))]
  const [form, setForm] = useState({
    campaignName: `${analysis?.output?.product_or_theme_name || '商品候補'} Campaign`, objective: '',
    discoveryChannel: 'google_search', searchKeyword: keywords[0] || '', merchant: '', productName: '', productUrl: '', affiliateUrl: '', priceAmount: '', currency: 'JPY', productNotes: '',
    appealHypothesis: analysis?.output?.recommendation_reason || '', hookText: analysis?.output?.hooks?.[0] || '',
    contentOutline: analysis?.output?.video_ideas?.join('\n') || '', scriptText: '', youtubeVideoId: '', publicationTitle: '', publishedAt: '',
  })
  const [submissionKey] = useState(newCampaignIdempotencyKey)
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(null)
  const submittingRef = useRef(false)
  if (!analysis?.id) return null
  const links = manualProductSearchLinks(keywords)
  const savePresentation = campaignSavePresentation(submitting, saved)
  const update = (name, value) => setForm(previous => ({ ...previous, [name]: value }))
  return <section className="revenue-manual-campaign" aria-label="Manual Campaign">
    <div className="revenue-product-heading"><strong>Manual / Search Product</strong><span>商品APIなしで利用可能</span></div>
    <p className="revenue-product-facts">AIの保存済み検索語から外部検索を開き、確認した事実だけを登録します。商品情報の推測・スクレイピングは行いません。</p>
    <div className="revenue-search-links">{links.map(link => <a key={`${link.provider}-${link.keyword}`} href={link.url} target="_blank" rel="noopener noreferrer">{link.provider}: {link.keyword}</a>)}</div>
    {!keywords.length && <p className="revenue-warning">保存済みの商品検索キーワードがないため、Campaignを作成できません。</p>}
    {!!keywords.length && <details><summary>商品を選んでCampaignを作成</summary><form onSubmit={async event => {
      event.preventDefault()
      if (submittingRef.current || saved) return
      submittingRef.current = true
      setSubmitting(true)
      try {
        const result = await onCreate(analysis.id, {
          ...form,
          idempotencyKey: submissionKey,
          priceAmount: form.priceAmount === '' ? null : Number(form.priceAmount),
          youtubeVideoId: form.youtubeVideoId || null,
          publicationTitle: form.youtubeVideoId ? form.publicationTitle : null,
          publishedAt: form.youtubeVideoId && form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
        })
        setSaved(result || { created: true })
      } catch {
        // The shared Dashboard alert presents the sealed API error.
      } finally {
        submittingRef.current = false
        setSubmitting(false)
      }
    }}>
      <fieldset><legend>Campaign</legend><label>Campaign名<input required maxLength={120} value={form.campaignName} onChange={event => update('campaignName', event.target.value)} /></label><label>目的<textarea maxLength={1000} value={form.objective} onChange={event => update('objective', event.target.value)} /></label></fieldset>
      <fieldset><legend>人間が確認した商品</legend><label>検索語<select required value={form.searchKeyword} onChange={event => update('searchKeyword', event.target.value)}>{keywords.map(keyword => <option key={keyword}>{keyword}</option>)}</select></label><label>発見経路<select value={form.discoveryChannel} onChange={event => update('discoveryChannel', event.target.value)}><option value="amazon_search">Amazon検索</option><option value="rakuten_search">楽天市場検索</option><option value="yahoo_search">Yahoo!ショッピング検索</option><option value="google_search">Google検索</option><option value="direct">直接入力</option></select></label><label>商品名<input required maxLength={240} value={form.productName} onChange={event => update('productName', event.target.value)} /></label><label>販売元・ショップ<input required maxLength={80} value={form.merchant} onChange={event => update('merchant', event.target.value)} /></label><label>商品URL（HTTPS）<input type="url" required value={form.productUrl} onChange={event => update('productUrl', event.target.value)} /></label><label>アフィリエイトURL（任意）<input type="url" value={form.affiliateUrl} onChange={event => update('affiliateUrl', event.target.value)} /></label><div className="revenue-form-pair"><label>価格（任意）<input type="number" min="0" step="0.01" value={form.priceAmount} onChange={event => update('priceAmount', event.target.value)} /></label><label>通貨<input maxLength={3} value={form.currency} onChange={event => update('currency', event.target.value.toUpperCase())} /></label></div><label>確認メモ<textarea maxLength={1000} value={form.productNotes} onChange={event => update('productNotes', event.target.value)} /></label></fieldset>
      <fieldset><legend>Iteration #1 の訴求と構成</legend><label>訴求仮説<textarea required maxLength={1000} value={form.appealHypothesis} onChange={event => update('appealHypothesis', event.target.value)} /></label><label>Hook<textarea required maxLength={500} value={form.hookText} onChange={event => update('hookText', event.target.value)} /></label><label>台本・構成<textarea required maxLength={5000} value={form.contentOutline} onChange={event => update('contentOutline', event.target.value)} /></label><label>台本本文（任意）<textarea maxLength={8000} value={form.scriptText} onChange={event => update('scriptText', event.target.value)} /></label></fieldset>
      <fieldset><legend>YouTube公開情報（任意・後から登録可）</legend><p className="revenue-product-facts">公開前は空欄のまま保存できます。その場合、Iterationは下書きになります。</p><label>YouTube Video ID（任意）<input pattern="[A-Za-z0-9_-]{6,32}" value={form.youtubeVideoId} onChange={event => update('youtubeVideoId', event.target.value)} /></label><label>公開タイトル（任意）<input disabled={!form.youtubeVideoId} maxLength={200} value={form.publicationTitle} onChange={event => update('publicationTitle', event.target.value)} /></label><label>公開日時（任意）<input disabled={!form.youtubeVideoId} type="datetime-local" value={form.publishedAt} onChange={event => update('publishedAt', event.target.value)} /></label></fieldset>
      {saved && <p className="revenue-save-success" role="status"><strong>保存しました。</strong> CampaignとIterationはCampaign実験台帳で確認できます。{saved.idempotentReplay ? ' 同一操作の再送は既存Campaignへ統合されました。' : ''}</p>}
      <button className="corp-primary" disabled={busy || savePresentation.disabled} type="submit">{savePresentation.label}</button>
    </form></details>}
  </section>
}

function ProductCandidatePanel({ analysis, search, config, busy, onSearch, onDecision }) {
  if (!analysis?.id) return null
  if (!config?.configured && !search) return <section className="revenue-products is-empty"><strong>楽天Provider（任意）</strong><p>楽天認証情報が未設定でも、上のManual / Search ProductからCampaignを作成できます。</p></section>
  if (!search) return <section className="revenue-products is-empty"><div className="revenue-product-heading"><strong>Product Candidate Finder</strong><button type="button" disabled={busy} onClick={() => onSearch(analysis.id)}>商品候補を検索</button></div><p>AIが生成した検索語を使い、楽天の実在商品を1分析ずつ確認します。</p></section>
  if (search.status !== 'succeeded') return <section className={`revenue-products is-${search.status}`}><div className="revenue-product-heading"><strong>Product Candidate Finder</strong><span>{jobStatusLabel(search.status)}</span></div><p>{search.status === 'failed' ? `商品検索に失敗しました（${search.errorCode || 'PRODUCT_SEARCH_FAILED'}）` : '楽天の商品候補を取得しています。'}</p></section>
  return <section className="revenue-products is-succeeded" aria-label="Product Candidate Finder">
    <div className="revenue-product-heading"><strong>Product Candidate Finder</strong><span>楽天市場 · API {search.providerApiVersion}</span></div>
    <p className="revenue-product-facts">楽天から{publishedLabel(search.fetchedAt)}に取得した情報です。価格・販売状況は取得時点の情報です。</p>
    <div className="revenue-product-keywords">検索語: {search.keywords.map(keyword => <span key={keyword}>{keyword}</span>)}</div>
    <div className="revenue-product-list">{search.candidates.map(candidate => {
      const url = safeRakutenUrl(candidate.affiliateUrl) || safeRakutenUrl(candidate.productUrl)
      const image = candidate.imageUrls.map(safeRakutenUrl).find(Boolean)
      return <article className="revenue-product" key={candidate.id}>
        <b>#{candidate.rankPosition}</b>{image && <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <div><h4>{candidate.title}</h4><p>{candidate.shopName || 'ショップ不明'}</p>
          <dl><div><dt>価格</dt><dd>{candidate.priceAmount == null ? '—' : `¥${metricCount(candidate.priceAmount)}`}</dd></div><div><dt>販売状況</dt><dd>購入可能</dd></div><div><dt>レビュー</dt><dd>{candidate.reviewAverage == null ? '—' : `${candidate.reviewAverage.toFixed(2)} / ${metricCount(candidate.reviewCount, '0')}件`}</dd></div><div><dt>報酬率</dt><dd>{candidate.affiliateRate == null ? '—' : `${candidate.affiliateRate}%`}</dd></div></dl>
          <div className="revenue-product-score"><strong>{scoreLabel(candidate.candidateScore)}</strong><span>Candidate Score · {candidate.scoreVersion}</span></div>
          <details><summary>順位の内訳</summary><p>キーワード一致 {scoreLabel(candidate.keywordMatchScore)} / 検索語カバー {scoreLabel(candidate.searchCoverageScore)} / Provider順位 {scoreLabel(candidate.providerRankScore)} / レビュー数 {scoreLabel(candidate.reviewCountScore)} / レビュー平均 {scoreLabel(candidate.reviewAverageScore)} / 報酬率 {scoreLabel(candidate.affiliateRateScore)}</p></details>
          {url && <a href={url} target="_blank" rel="noopener noreferrer">楽天で確認</a>}
          <div className="revenue-product-decisions"><span>{productDecisionLabel(candidate.decision?.decision)}</span>{[['selected_for_research', '次の調査対象に選ぶ'], ['hold', '保留'], ['rejected', '除外']].map(([decision, label]) => <button type="button" key={decision} disabled={busy} onClick={() => onDecision(candidate.id, analysis.id, decision)}>{label}</button>)}</div>
        </div>
      </article>
    })}</div>
    {!search.candidates.length && <p>購入可能な商品候補が見つかりませんでした。</p>}
    <p className="revenue-product-facts">「次の調査対象」は商品紹介・公開の承認ではありません。楽天Web Serviceの情報を利用しています。</p>
  </section>
}

function AnalysisPanel({ analysis, productSearch, productConfig, busy, onReview, onProductSearch, onProductDecision, onCreateCampaign }) {
  if (!analysis) return <div className="revenue-analysis is-empty"><strong>AI分析</strong><p>まだ分析されていません。上部の「TOP1をAI分析」から1動画で品質を確認します。</p></div>
  if (analysis.status !== 'succeeded' || !analysis.output) return <div className={`revenue-analysis is-${analysis.status}`}><strong>AI分析</strong><p>{({ pending: 'ジョブ待機中', running: 'メタデータを分析中', refused: '分析は拒否されました', incomplete: '分析結果が未完了です', failed: '分析に失敗しました' })[analysis.status] || analysis.status}</p></div>
  const output = analysis.output
  return <section className="revenue-analysis is-succeeded" aria-label="AI Opportunity Analyst">
    <div className="revenue-analysis-heading"><strong>AI Opportunity Analyst</strong><span>{recommendationLabel(output.recommendation)}</span></div>
    <p className="revenue-analysis-note">保存済みメタデータだけを使った解釈です。動画本文・映像・字幕・商品リンクは確認していません。</p>
    {output.recommendation === 'adopt' && <p className="revenue-analysis-note"><strong>「採用」</strong>は制作・商品採用の確定ではなく、次の人間調査へ進める意味です。</p>}
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
    <ManualCampaignForm analysis={analysis} busy={busy} onCreate={onCreateCampaign} />
    <ProductCandidatePanel analysis={analysis} search={productSearch} config={productConfig} busy={busy} onSearch={onProductSearch} onDecision={onProductDecision} />
  </section>
}

function OpportunityCard({ item, index, tracking = false, analysis, productSearch, productConfig, busy, onReview, onProductSearch, onProductDecision, onCreateCampaign }) {
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
      <AnalysisPanel analysis={analysis} productSearch={productSearch} productConfig={productConfig} busy={busy} onReview={onReview} onProductSearch={onProductSearch} onProductDecision={onProductDecision} onCreateCampaign={onCreateCampaign} />
    </div>
  </article>
}

function OpportunitySection({ title, description, items, tracking = false, configured, analysisByItem = new Map(), productSearchByAnalysis = new Map(), productConfig, busy, onReview = () => {}, onProductSearch = () => {}, onProductDecision = () => {}, onCreateCampaign = () => {} }) {
  return <section className="revenue-ranking-section">
    <div className="revenue-section-heading"><div><p className="revenue-kicker">{tracking ? 'OBSERVED TRACKING' : 'DAILY DISCOVERY'}</p><h2>{title}</h2><p>{description}</p></div></div>
    <div className="revenue-grid" aria-label={title}>
      {items.map((item, index) => { const analysis = analysisByItem.get(item.sourceItemId); return <OpportunityCard key={item.id || item.youtubeVideoId} item={item} index={index} tracking={tracking} analysis={analysis} productSearch={productSearchByAnalysis.get(analysis?.id)} productConfig={productConfig} busy={busy} onReview={onReview} onProductSearch={onProductSearch} onProductDecision={onProductDecision} onCreateCampaign={onCreateCampaign} /> })}
      {configured && items.length === 0 && <div className="revenue-state"><h3>まだ候補がありません</h3><p>{tracking ? '6時間以上の間隔がある継続観測データを待っています。' : 'テーマのScore設定を保存して収集を実行してください。'}</p></div>}
    </div>
  </section>
}

const campaignStatusLabel = value => ({ active: '進行中', completed: '完了', stopped: '停止' })[value] || value
const iterationStatusLabel = value => ({ draft: '下書き', ready_to_publish: '公開準備完了', published: '公開済み', measuring: '計測中', review_due: 'レビュー待ち', closed: '終了' })[value] || value

function PublicationRegistrationForm({ iterationId, busy, onRegister }) {
  const [form, setForm] = useState({ youtubeVideoId: '', publicationTitle: '', publishedAt: '' })
  return <form className="revenue-publication-form" onSubmit={event => {
    event.preventDefault()
    onRegister(iterationId, { ...form, publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null })
  }}><strong>公開後にYouTube情報を追加</strong><label>Video ID<input required pattern="[A-Za-z0-9_-]{6,32}" value={form.youtubeVideoId} onChange={event => setForm({ ...form, youtubeVideoId: event.target.value })} /></label><label>公開タイトル（任意）<input maxLength={200} value={form.publicationTitle} onChange={event => setForm({ ...form, publicationTitle: event.target.value })} /></label><label>公開日時（任意）<input type="datetime-local" value={form.publishedAt} onChange={event => setForm({ ...form, publishedAt: event.target.value })} /></label><button type="submit" disabled={busy}>Publicationを登録</button></form>
}

const visualSourceLabel = value => ({ real_product_asset: '実商品素材', ai_generated_scene: 'AI生成シーン', text_only: 'テキストのみ' })[value] || value
const renderingStrategyLabel = value => ({
  static_product_scene: '静止商品素材', image_motion_scene: '商品画像モーション',
  stylized_scene: 'スタイライズ演出', ai_generated_scene: 'リアル系AI演出', text_only: 'テキストのみ',
})[value] || value
const modelClassLabel = value => ({
  none: '生成モデル不要', stylized_t2v: 'スタイライズT2V', realistic_t2v: 'リアル系T2V',
  product_preserving_i2v: '商品形状維持I2V',
})[value] || value
const isExistingPolloEligible = scene => scene.rendering_strategy
  ? ['stylized_scene', 'ai_generated_scene'].includes(scene.rendering_strategy)
  : scene.visual_source_type === 'ai_generated_scene'

function safeGeneratedVideoUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null }
  catch { return null }
}

function SceneVideoGeneration({ planId, scene, attempts = [], config, busy, onGenerate }) {
  const [submitting, setSubmitting] = useState(false)
  const keyRef = useRef(newCampaignIdempotencyKey())
  const latest = attempts.filter(item => item.sceneNumber === scene.scene_number).sort((a, b) => b.attemptNumber - a.attemptNumber)[0]
  const active = ['queued', 'submitting', 'polling'].includes(latest?.status)
  const previewUrl = safeGeneratedVideoUrl(latest?.outputUrl)
  const submit = async regenerate => {
    if (busy || submitting || active || !config?.configured) return
    setSubmitting(true)
    try {
      await onGenerate(planId, scene.scene_number, keyRef.current, regenerate)
      keyRef.current = newCampaignIdempotencyKey()
    } finally { setSubmitting(false) }
  }
  const cost = latest?.costProvenance === 'actual' && latest.providerCost != null
    ? `${latest.costCurrency || 'USD'} ${Number(latest.providerCost).toFixed(4)}（実績）`
    : latest?.costProvenance === 'estimated' && latest.providerCost != null
      ? `${latest.costCurrency || ''} ${Number(latest.providerCost).toFixed(4)}（推定）` : '取得不可'
  return <section className="revenue-video-generation">
    <div><strong>Pollo映像素材</strong><span>{latest?.model || config?.requestedModel || 'pollo-v2'} · {latest?.resolution || config?.resolution || '480p'} · 9:16 · 音声なし</span></div>
    {!config?.configured && <p className="revenue-warning">サーバー側のPOLLO_API_KEYを設定すると生成できます。</p>}
    {latest && <dl>
      <div><dt>Status</dt><dd><span className={`revenue-status is-${latest.status}`}>{jobStatusLabel(latest.status)}</span></dd></div>
      <div><dt>Provider task</dt><dd>{latest.providerTaskStatus || '未送信'}</dd></div>
      <div><dt>Cost</dt><dd>{cost}</dd></div>
      <div><dt>Attempt</dt><dd>#{latest.attemptNumber}</dd></div>
    </dl>}
    {latest?.safeErrorCode && <p className="revenue-warning">Safe error: {latest.safeErrorCode}</p>}
    {previewUrl && <video controls preload="metadata" src={previewUrl}>生成動画を再生できません。</video>}
    <button type="button" className="corp-primary" disabled={busy || submitting || active || !config?.configured} onClick={() => submit(Boolean(latest))}>
      {submitting ? '送信中…' : active ? '生成中…' : latest ? '再生成' : 'Polloで生成'}
    </button>
  </section>
}

function SceneImageVideoGeneration({ planId, scene, asset, attempts = [], config, busy, onCreateRevision, onGenerate }) {
  const [submitting, setSubmitting] = useState(false)
  const [permissionConfirmed, setPermissionConfirmed] = useState(false)
  const keyRef = useRef(newCampaignIdempotencyKey())
  const revisions = (asset?.revisions || []).filter(item => item.availabilityStatus === 'available')
  const revision = revisions.find(item => item.i2vAllowed && item.permissionSnapshot === 'owned'
    && item.pixelWidth * 16 === item.pixelHeight * 9)
  const latest = attempts.filter(item => item.sceneNumber === scene.scene_number && item.generationMode === 'image_to_video')
    .sort((a, b) => b.attemptNumber - a.attemptNumber)[0]
  const active = ['queued', 'submitting', 'polling', 'submission_uncertain'].includes(latest?.status) || latest?.submissionUncertain
  const previewUrl = safeGeneratedVideoUrl(latest?.outputUrl)
  const createRevision = async () => {
    if (!asset || !permissionConfirmed || busy || submitting) return
    setSubmitting(true)
    try { await onCreateRevision(asset.id, true, true) } finally { setSubmitting(false) }
  }
  const generate = async regenerate => {
    if (!revision || active || busy || submitting || !config?.configured) return
    setSubmitting(true)
    try {
      await onGenerate(planId, scene.scene_number, revision.id, keyRef.current, regenerate)
      keyRef.current = newCampaignIdempotencyKey()
    } finally { setSubmitting(false) }
  }
  const cost = latest?.costProvenance === 'actual' && latest.providerCost != null
    ? `${latest.costCurrency || 'USD'} ${Number(latest.providerCost).toFixed(4)}（実績）`
    : latest?.costProvenance === 'estimated' && latest.providerCost != null
      ? `${latest.costCurrency || ''} ${Number(latest.providerCost).toFixed(4)}（推定）` : '取得不可'
  return <section className="revenue-video-generation revenue-image-video-generation">
    <div><strong>商品画像I2V</strong><span>{config?.requestedModel || 'wan-v2-2-flash'} · 5秒 · 720p · 9:16 · 音声なし</span></div>
    {!revision && <div className="revenue-i2v-revision-setup">
      <p>生成前に、元画像と9:16余白画像をimmutable revisionとして保存します。</p>
      <label><input type="checkbox" checked={permissionConfirmed} onChange={event => setPermissionConfirmed(event.target.checked)} /> このowned素材をI2Vへ使用する権限を確認しました</label>
      <button type="button" disabled={busy || submitting || !permissionConfirmed || asset?.usagePermission !== 'owned' || !config?.configured} onClick={createRevision}>{submitting ? 'Revision作成中…' : 'I2V用Asset Revisionを作成'}</button>
    </div>}
    {revision && <dl>
      <div><dt>Asset revision</dt><dd>#{revision.revisionNumber} · {revision.derivationType}{revision.parentRevisionId ? ` · parent ${revision.parentRevisionId.slice(0, 8)}…` : ''}</dd></div>
      <div><dt>SHA-256</dt><dd><code>{revision.contentSha256.slice(0, 12)}…</code></dd></div>
      <div><dt>Dimensions</dt><dd>{revision.pixelWidth} × {revision.pixelHeight}</dd></div>
      <div><dt>Permission</dt><dd>{revision.permissionSnapshot} / I2V {revision.i2vAllowed ? '許可' : '未許可'}</dd></div>
      <div><dt>Prompt Builder</dt><dd>{latest?.promptBuilderVersion || config?.promptBuilderVersion}</dd></div>
      <div><dt>Attempt</dt><dd>{latest ? `#${latest.attemptNumber}` : '未送信'}</dd></div>
      <div><dt>Provider task</dt><dd>{latest?.providerTaskStatus || '未送信'}</dd></div>
      <div><dt>Normalized status</dt><dd>{jobStatusLabel(latest?.status)}</dd></div>
      <div><dt>Cost</dt><dd>{cost}</dd></div>
    </dl>}
    {latest?.submissionUncertain && <p className="revenue-warning"><strong>送信結果不明:</strong> 二重課金防止のため新規submitを停止しています。人間による確認が必要です。</p>}
    {latest?.safeErrorCode && <p className="revenue-warning">Safe error: {latest.safeErrorCode}</p>}
    {previewUrl && <video controls preload="metadata" src={previewUrl}>生成動画を再生できません。</video>}
    {revision && <button type="button" className="corp-primary" disabled={busy || submitting || active || !config?.configured} onClick={() => generate(Boolean(latest))}>
      {submitting ? '送信中…' : active ? latest?.submissionUncertain ? '送信結果を確認してください' : '生成中…' : latest ? '再生成' : 'Wan 2.2 Flashで商品画像を動画化'}
    </button>}
  </section>
}

function CreativeProductionPanel({ iteration, config, videoGenerationConfig, imageToVideoConfig, busy, onGenerate, onGenerateVideo, onCreateAssetRevision, onGenerateImageVideo }) {
  const [submitting, setSubmitting] = useState(false)
  const keyRef = useRef(newCampaignIdempotencyKey())
  const submittingRef = useRef(false)
  const revisions = iteration.productionPlans || []
  const assets = new Map((iteration.product?.assets || []).map(asset => [asset.id, asset]))
  const generate = async () => {
    if (busy || submittingRef.current) return
    submittingRef.current = true; setSubmitting(true)
    try {
      await onGenerate(iteration.id, keyRef.current)
      keyRef.current = newCampaignIdempotencyKey()
    } catch {
      // Shared Dashboard alert presents the sealed API error.
    } finally { submittingRef.current = false; setSubmitting(false) }
  }
  return <section className="revenue-creative-production" aria-label={`Creative Production Iteration ${iteration.iterationNumber}`}>
    <div className="revenue-product-heading"><strong>Creative Production Plan v2</strong><button type="button" className="corp-primary" disabled={busy || submitting || !config?.configured} onClick={generate}>{submitting ? '生成依頼中…' : revisions.length ? '新しいrevisionを生成' : '動画制作案を生成'}</button></div>
    <p className="revenue-product-facts">実商品素材を第一選択にするStatic-first制作案です。v1 revisionは変更せず、新規生成だけv2として追加します。</p>
    {!config?.configured && <p className="revenue-warning">サーバー側のOPENAI_API_KEYを設定すると生成できます。</p>}
    {!revisions.length && <p>制作案はまだありません。</p>}
    <div className="revenue-production-revisions">{revisions.map((revision, index) => <details key={revision.requestId} open={index === 0}>
      <summary>Revision {revision.revisionNumber} · {revision.schemaVersion === 'creative-production-plan-v2' ? 'v2 Static-first' : 'v1'} · {jobStatusLabel(revision.status)}{revision.generatedAt ? ` · ${publishedLabel(revision.generatedAt)}` : ''}</summary>
      {revision.status !== 'succeeded' && <p>{revision.status === 'failed' ? `生成に失敗しました（${revision.errorCode || 'CREATIVE_PRODUCTION_FAILED'}）` : 'Local Workerで制作案を生成しています。'}</p>}
      {revision.output && <div className="revenue-production-plan">
        <dl><div><dt>形式</dt><dd>YouTube Shorts / {revision.output.aspect_ratio}</dd></div><div><dt>目標尺</dt><dd>{revision.output.target_duration_seconds}秒</dd></div><div><dt>Creative目的</dt><dd>{revision.output.creative_objective}</dd></div><div><dt>CTA</dt><dd>{revision.output.cta?.text || '—'}</dd></div></dl>
        <details><summary>ナレーション</summary><p>{revision.output.narration_script}</p><small>Fact refs: {revision.output.narration_fact_references?.join(', ') || 'なし'}</small></details>
        <details><summary>字幕</summary><ol>{revision.output.subtitle_segments?.map(segment => <li key={segment.id}><b>{segment.start_seconds}–{segment.end_seconds}秒</b> {segment.text}<small>Fact refs: {segment.product_fact_references?.join(', ') || 'なし'}</small></li>)}</ol></details>
        <div className="revenue-scene-list">{revision.output.scenes?.map(scene => {
          const asset = assets.get(scene.product_asset_id)
          return <article key={scene.scene_number} className={`revenue-scene is-${scene.visual_source_type}`}>
            <header><strong>Scene {scene.scene_number}</strong><span>{scene.start_seconds}秒〜 / {scene.duration_seconds}秒 · {scene.rendering_strategy ? renderingStrategyLabel(scene.rendering_strategy) : visualSourceLabel(scene.visual_source_type)}</span></header>
            <p><b>目的:</b> {scene.purpose}</p><p><b>画面テキスト:</b> {scene.on_screen_text || 'なし'}</p><p><b>ナレーション:</b> {scene.narration || 'なし'}</p>
            {scene.rendering_strategy && <div className="revenue-rendering-contract"><span>{scene.requires_ai_generation ? 'AI生成あり' : 'AI生成なし'}</span><span>{modelClassLabel(scene.recommended_model_class)}</span><span>{scene.preserve_product_identity ? '商品形状を維持' : '商品正確性は対象外'}</span></div>}
            {scene.motion_instruction?.description && <p><b>Motion:</b> {scene.motion_instruction.description}（{scene.motion_instruction.mode}）</p>}
            {asset && <p><b>使用素材:</b> <a href={asset.assetUrl} target="_blank" rel="noopener noreferrer">{asset.label || asset.id}</a>（{asset.assetKind} / {asset.usagePermission}）</p>}
            {scene.visual_source_type === 'real_product_asset' && !asset && <p className="revenue-warning">使用素材ID: {scene.product_asset_id}</p>}
            {scene.ai_generation_prompt && <details><summary>AI生成prompt</summary><code>{scene.ai_generation_prompt}</code></details>}
            {isExistingPolloEligible(scene) && <SceneVideoGeneration planId={revision.planId} scene={scene} attempts={revision.videoGenerations} config={videoGenerationConfig} busy={busy} onGenerate={onGenerateVideo} />}
            {scene.rendering_strategy === 'image_motion_scene' && asset && <SceneImageVideoGeneration planId={revision.planId} scene={scene} asset={asset} attempts={revision.videoGenerations} config={imageToVideoConfig} busy={busy} onCreateRevision={onCreateAssetRevision} onGenerate={onGenerateImageVideo} />}
            <small>Fact refs: {scene.product_fact_references?.join(', ') || 'なし'}</small>
          </article>
        })}</div>
        <details><summary>Provider-neutral export</summary><p>Scene timeline、Product Asset ID、AI生成promptをProvider未指定のhandoff構造として保存済みです。</p><code>{revision.schemaVersion}</code></details>
      </div>}
    </details>)}</div>
  </section>
}

function selectableThreePicksProducts(campaigns) {
  const seen = new Set(); const products = []
  for (const campaign of campaigns) for (const iteration of campaign.iterations || []) {
    const product = iteration.product
    if (!product?.id || seen.has(product.id)) continue
    const revisions = (product.assets || []).flatMap(asset => (asset.revisions || []).map(revision => ({ ...revision, assetId: asset.id })))
      .filter(revision => revision.availabilityStatus === 'available')
    const factEntry = Object.entries(product.verifiedFacts || {}).find(([, value]) => value != null && value !== '')
    if (!revisions.length || !factEntry) continue
    seen.add(product.id); products.push({ product, revision: revisions[0], verifiedFactRef: factEntry[0] })
  }
  return products
}

function ThreePicksIntake({ campaigns, busy, assetRevisionConfig, onCreate, onCreateAssetRevision }) {
  const products = selectableThreePicksProducts(campaigns)
  const pendingAssets = campaigns.flatMap(campaign => (campaign.iterations || []).flatMap(iteration => {
    const product = iteration.product
    if (!product?.id || !Object.keys(product.verifiedFacts || {}).length) return []
    const asset = (product.assets || []).find(item => item.creativeEligible && !(item.revisions || []).some(revision => revision.availabilityStatus === 'available'))
    return asset ? [{ product, asset }] : []
  })).filter((entry, index, all) => all.findIndex(item => item.product.id === entry.product.id) === index)
  const [selected, setSelected] = useState(['', '', ''])
  const [name, setName] = useState('おすすめ3選 Shorts')
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const keyRef = useRef(newCampaignIdempotencyKey())
  const canSubmit = new Set(selected.filter(Boolean)).size === 3
  const submit = async event => {
    event.preventDefault(); if (!canSubmit || submitting || busy) return
    setSubmitting(true)
    try {
      await onCreate({ idempotencyKey: keyRef.current, campaignName: name,
        objective: '人間が選んだ3商品を順位付けせず約20秒で紹介する',
        appealHypothesis: '実商品画像と確認済み事実を簡潔に提示する',
        items: selected.map(id => {
          const entry = products.find(product => product.product.id === id)
          return { curatedProductId: id, productAssetRevisionId: entry.revision.id, verifiedFactRef: entry.verifiedFactRef }
        }) })
      setSaved(true)
    } finally { setSubmitting(false) }
  }
  return <section className="revenue-three-picks-intake" aria-labelledby="three-picks-intake-heading">
    <div className="revenue-section-heading"><div><p className="revenue-kicker">MULTI-PRODUCT SHORTS v1</p><h2 id="three-picks-intake-heading">Three Picksを作成</h2><p>3商品を人間が選び、順位を付けずに実商品画像で紹介します。</p></div><span>Human selection</span></div>
    {products.length < 3 ? <><p className="revenue-warning">利用可能なimmutable Asset Revisionと確認済み事実を持つ商品が3件必要です（現在 {products.length}件）。</p>{pendingAssets.map(entry => <button key={entry.asset.id} type="button" disabled={busy || submitting || !assetRevisionConfig?.configured} onClick={async () => { setSubmitting(true); try { await onCreateAssetRevision(entry.asset.id, false, false) } finally { setSubmitting(false) } }}>{entry.product.productName}の静止画Revisionを作成</button>)}</>
      : <form onSubmit={submit}><label>Campaign名<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="revenue-three-picks-selects">{selected.map((value, index) => <label key={index}>PICK {index + 1}<select required value={value} onChange={event => setSelected(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}><option value="">商品を選択</option>{products.map(entry => <option key={entry.product.id} value={entry.product.id} disabled={selected.some((id, itemIndex) => itemIndex !== index && id === entry.product.id)}>{entry.product.productName} · Revision #{entry.revision.revisionNumber}</option>)}</select></label>)}</div>
        {saved && <p className="revenue-save-success" role="status"><strong>Three Picks Campaignを保存しました。</strong> 台帳から制作案を生成できます。</p>}
        <button className="corp-primary" disabled={busy || submitting || saved || !canSubmit}>{saved ? '保存済み' : submitting ? '保存中…' : '3商品でCampaignを作成'}</button>
      </form>}
  </section>
}

function ThreePicksPanel({ iteration, plannerConfig, composerConfig, busy, onGeneratePlan, onCompose, onPreview }) {
  const [submitting, setSubmitting] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const keyRef = useRef(newCampaignIdempotencyKey())
  const revisions = iteration.archetypePlans || []
  const generate = async () => { setSubmitting(true); try { await onGeneratePlan(iteration.id, keyRef.current); keyRef.current = newCampaignIdempotencyKey() } finally { setSubmitting(false) } }
  const compose = async planId => { setSubmitting(true); try { await onCompose(planId, keyRef.current); keyRef.current = newCampaignIdempotencyKey() } finally { setSubmitting(false) } }
  const preview = async outputId => { const result = await onPreview(outputId); setPreviewUrl(result.previewUrl) }
  return <section className="revenue-three-picks-panel">
    <div className="revenue-product-heading"><strong>Three Picks Plan</strong><button className="corp-primary" disabled={busy || submitting || !plannerConfig?.configured} onClick={generate}>{submitting ? '処理中…' : revisions.length ? '新しい制作案を生成' : 'Three Picks制作案を生成'}</button></div>
    {!plannerConfig?.configured && <p className="revenue-warning">OPENAI_API_KEYを設定すると制作案を生成できます。</p>}
    {revisions.map((revision, index) => <details key={revision.requestId} open={index === 0}><summary>Revision {revision.revisionNumber} · {jobStatusLabel(revision.status)}</summary>
      {revision.output && <><p><strong>Hook:</strong> {revision.output.hook}</p><div className="revenue-three-picks-cards">{revision.productCards.map(card => <article key={card.id}><span>PICK {card.pickNumber}</span><strong>{card.productName}</strong><p>{card.shortAppeal}</p><small>{String(card.verifiedFact?.value ?? '—')}</small>{card.price && <small>{card.price.currency} {card.price.amount}</small>}</article>)}</div><p><strong>Summary:</strong> {revision.output.summary}</p><p><strong>CTA:</strong> {revision.output.cta}</p></>}
      {revision.planId && <button disabled={busy || submitting || !composerConfig?.configured || revision.compositions?.some(item => ['queued', 'rendering'].includes(item.status))} onClick={() => compose(revision.planId)}>Shorts MP4を合成</button>}
      {!composerConfig?.configured && revision.planId && <p className="revenue-warning">private bucketsとFFmpeg/FFprobeのパスを設定すると合成できます。</p>}
      {revision.compositions?.map(composition => <div key={composition.id} className="revenue-composition-status"><span>{jobStatusLabel(composition.status)}</span>{composition.safeErrorCode && <small>Safe error: {composition.safeErrorCode}</small>}{composition.output && <><small>{composition.output.pixelWidth}×{composition.output.pixelHeight} · {composition.output.fps}fps · {composition.output.durationSeconds}秒 · SHA {composition.output.contentSha256.slice(0, 12)}…</small><button onClick={() => preview(composition.output.id)}>Previewを開く</button></>}</div>)}
      {previewUrl && <video controls preload="metadata" src={previewUrl}>完成動画を再生できません。</video>}
    </details>)}
  </section>
}

function CampaignBoard({ campaigns = [], creativeProductionConfig, videoGenerationConfig, imageToVideoConfig, productAssetRevisionConfig, multiProductConfig, composerConfig, busy, onCreateThreePicks, onGenerateThreePicks, onCompose, onPreview, onGenerateProduction, onGenerateVideo, onCreateAssetRevision, onGenerateImageVideo, onRegisterPublication }) {
  return <section className="revenue-campaign-board" aria-labelledby="campaign-board-heading">
    <ThreePicksIntake campaigns={campaigns} busy={busy} assetRevisionConfig={productAssetRevisionConfig} onCreate={onCreateThreePicks} onCreateAssetRevision={onCreateAssetRevision} />
    <div className="revenue-section-heading"><div><p className="revenue-kicker">CAMPAIGN LEARNING LINEAGE</p><h2 id="campaign-board-heading">Campaign実験台帳</h2><p>Opportunityから商品、訴求、Iteration、公開動画までを一続きで確認します。</p></div><span>{campaigns.length} Campaign</span></div>
    {!campaigns.length && <div className="revenue-state"><h3>Campaignはまだありません</h3><p>AI分析カードから人間が商品を確認し、最初のIterationを登録してください。</p></div>}
    <div className="revenue-campaign-list">{campaigns.map(campaign => <article key={campaign.id} className="revenue-campaign">
      <header><div><h3>{campaign.name}</h3><p>{campaign.objective || '目的メモなし'}</p></div><span className={`revenue-status is-${campaign.status}`}>{campaignStatusLabel(campaign.status)}</span></header>
      <div className="revenue-origin-list">{campaign.origins?.map(origin => <span key={origin.id}>{origin.contextKind === 'tracking' ? '継続観測' : '発掘'} · Rank #{origin.rankPosition ?? '—'} · {origin.scoreVersion || '—'}</span>)}</div>
      {campaign.iterations?.map(iteration => <section key={iteration.id} className="revenue-iteration">
        <div className="revenue-product-heading"><strong>Iteration #{iteration.iterationNumber}</strong><span>{iterationStatusLabel(iteration.status)}</span></div>
        {iteration.product && <div className="revenue-selected-product"><div><b>{iteration.product.productName}</b><small>{iteration.product.merchant || '販売元未入力'} · {iteration.product.discoveryChannel} · 検索語「{iteration.product.searchKeyword}」</small></div><a href={iteration.product.affiliateUrl || iteration.product.productUrl} target="_blank" rel="noopener noreferrer">商品を確認</a></div>}
        <dl><div><dt>訴求仮説</dt><dd>{iteration.appealHypothesis}</dd></div><div><dt>Hook</dt><dd>{iteration.hookText}</dd></div><div><dt>台本・構成</dt><dd className="revenue-prewrap">{iteration.contentOutline?.text || '—'}</dd></div>{iteration.scriptText && <div><dt>台本本文</dt><dd className="revenue-prewrap">{iteration.scriptText}</dd></div>}</dl>
        {iteration.product && <CreativeProductionPanel iteration={iteration} config={creativeProductionConfig} videoGenerationConfig={videoGenerationConfig} imageToVideoConfig={imageToVideoConfig} busy={busy} onGenerate={onGenerateProduction} onGenerateVideo={onGenerateVideo} onCreateAssetRevision={onCreateAssetRevision} onGenerateImageVideo={onGenerateImageVideo} />}
        {iteration.productSet && <><div className="revenue-three-picks-lineage">{iteration.productSet.items.map(item => <span key={item.id}>PICK {item.presentationOrder} · {item.productName} · Asset Revision #{item.assetRevision?.revisionNumber}</span>)}</div><ThreePicksPanel iteration={iteration} plannerConfig={multiProductConfig} composerConfig={composerConfig} busy={busy} onGeneratePlan={onGenerateThreePicks} onCompose={onCompose} onPreview={onPreview} /></>}
        {iteration.publication && <div className="revenue-publication"><span>YouTube Video ID: {iteration.publication.youtubeVideoId}</span><a href={iteration.publication.canonicalUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(iteration.publication.youtubeVideoId)}`} target="_blank" rel="noopener noreferrer">公開動画を開く</a></div>}
        {!iteration.publication && <PublicationRegistrationForm iterationId={iteration.id} busy={busy} onRegister={onRegisterPublication} />}
        <details><summary>監査情報</summary><p>Iteration: {iteration.id}<br />Treatment fingerprint: {iteration.treatmentFingerprint || '—'}<br />AI Analysis: {iteration.sourceAnalysisId || campaign.primaryAnalysisId || '—'}</p></details>
      </section>)}
    </article>)}</div>
  </section>
}

export function RevenueLabView({ state, error, busy, onReload, onRun, onTrack, onAnalyze, onReview, onProductSearch, onProductDecision, onCreateCampaign, onCreateThreePicks, onGenerateThreePicks, onCompose, onPreview, onGenerateProduction, onGenerateVideo, onCreateAssetRevision, onGenerateImageVideo, onRegisterPublication, onSave }) {
  if (!state) return <main className="revenue-shell" aria-busy="true"><div className="revenue-state"><h2>Revenue Lab</h2><p>収益機会を読み込んでいます…</p></div></main>
  const eligible = state.queries.filter(query => query.enabled && !queryNeedsScores(query))
  const enabledQueries = state.queries.filter(query => query.enabled)
  const lookbackDays = [...new Set(enabledQueries.map(query => query.lookbackDays).filter(Boolean))]
  const latestRun = state.latestRun
  const scoreVersion = state.opportunities[0]?.scoreVersion || 'youtube-v1'
  const analysisByItem = new Map((state.analyses || []).map(analysis => [analysis.sourceItemId, analysis]))
  const productSearchByAnalysis = new Map((state.productSearches || []).map(search => [search.analysisId, search]))
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
    <OpportunitySection title="本日の発掘TOP3" description="本日のsearch.listで発掘した候補です。過去動画が再登場する場合もあります。" items={state.opportunities || []} configured={state.config.configured} analysisByItem={analysisByItem} productSearchByAnalysis={productSearchByAnalysis} productConfig={state.config.products} busy={busy} onReview={onReview} onProductSearch={onProductSearch} onProductDecision={onProductDecision} onCreateCampaign={onCreateCampaign} />
    <OpportunitySection title="継続観測・急伸TOP3" description="発見後7日間、6時間以上の間隔で実測した成長候補です。" items={state.trackingOpportunities || []} tracking configured={state.config.configured} analysisByItem={analysisByItem} productSearchByAnalysis={productSearchByAnalysis} productConfig={state.config.products} busy={busy} onReview={onReview} onProductSearch={onProductSearch} onProductDecision={onProductDecision} onCreateCampaign={onCreateCampaign} />
    <CampaignBoard campaigns={state.campaigns || []} creativeProductionConfig={state.config.creativeProduction} videoGenerationConfig={state.config.videoGeneration} imageToVideoConfig={state.config.imageToVideo} productAssetRevisionConfig={state.config.productAssetRevisions} multiProductConfig={state.config.multiProductShorts} composerConfig={state.config.finalComposition} busy={busy} onCreateThreePicks={onCreateThreePicks} onGenerateThreePicks={onGenerateThreePicks} onCompose={onCompose} onPreview={onPreview} onGenerateProduction={onGenerateProduction} onGenerateVideo={onGenerateVideo} onCreateAssetRevision={onCreateAssetRevision} onGenerateImageVideo={onGenerateImageVideo} onRegisterPublication={onRegisterPublication} />
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
    try { const result = await action(); await reload(); return result }
    catch (failure) { setError(failure.message); throw failure }
    finally { setBusy(false) }
  }
  const review = (analysis, decision) => perform(() => createRevenueAnalysisReview(
    analysis.id, decision, decision === analysis.output?.recommendation ? 'agree' : 'disagree',
  )).catch(() => {})
  return <RevenueLabView state={state} error={error} busy={busy} onReload={reload} onRun={queries => { perform(() => enqueueEnabledRevenueQueries(queries)).catch(() => {}) }} onTrack={() => { perform(enqueueRevenueTracking).catch(() => {}) }} onAnalyze={() => { perform(() => enqueueRevenueAnalysis(1)).catch(() => {}) }} onReview={review} onProductSearch={analysisId => { perform(() => enqueueProductSearch(analysisId)).catch(() => {}) }} onProductDecision={(candidateId, analysisId, decision) => { perform(() => createProductCandidateDecision(candidateId, analysisId, decision)).catch(() => {}) }} onCreateCampaign={(analysisId, input) => perform(() => createManualCampaignRequest(analysisId, input))} onCreateThreePicks={input => perform(() => createThreePicksCampaignRequest(input))} onGenerateThreePicks={(iterationId, idempotencyKey) => perform(() => enqueueThreePicksPlan(iterationId, idempotencyKey))} onCompose={(planId, idempotencyKey) => perform(() => enqueueFinalComposition(planId, idempotencyKey))} onPreview={outputId => loadFinalCompositionPreview(outputId)} onGenerateProduction={(iterationId, idempotencyKey) => perform(() => enqueueCreativeProductionPlan(iterationId, idempotencyKey))} onGenerateVideo={(planId, sceneNumber, idempotencyKey, regenerate) => perform(() => enqueueVideoGeneration(planId, sceneNumber, idempotencyKey, regenerate))} onCreateAssetRevision={(assetId, i2vAllowed, createNineSixteen) => perform(() => createProductAssetRevision(assetId, i2vAllowed, createNineSixteen))} onGenerateImageVideo={(planId, sceneNumber, revisionId, idempotencyKey, regenerate) => perform(() => enqueueImageVideoGeneration(planId, sceneNumber, revisionId, idempotencyKey, regenerate))} onRegisterPublication={(iterationId, input) => { perform(() => registerCampaignPublication(iterationId, input)).catch(() => {}) }} onSave={(id, values) => { perform(() => updateRevenueQuery(id, values)).catch(() => {}) }} />
}
