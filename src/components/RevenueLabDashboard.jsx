import React, { useCallback, useEffect, useRef, useState } from 'react'
import { collectYouTubeAnalytics, createCampaignIteration, createDirectProductCampaign as createDirectProductCampaignRequest, createManualCampaign as createManualCampaignRequest, createProductAssetRevision, createProductCandidateDecision, createRevenueAnalysisReview, createThreePicksV2Campaign as createThreePicksCampaignRequest, enqueueCreativeAudioArtifactGeneration, enqueueCreativeAudioGeneration, enqueueCreativeProductionPlan, enqueueEnabledRevenueQueries, enqueueFinalComposition, enqueueFinalCompositionV2, enqueueImageVideoGeneration, enqueueProductSearch, enqueueRevenueAnalysis, enqueueRevenueTracking, enqueueThreePicksPlan, enqueueThreePicksV2Plan, enqueueVideoGeneration, hardDeleteDraftCampaign, loadFinalCompositionPreview, loadRevenueDashboard, registerCampaignPublication, startYouTubeAnalyticsOAuth, updateDraftCampaignIteration, updateRevenueQuery, voidCampaign } from '../services/revenueLabApi'
import { buildWorkspaceUrl, campaignFromLocation, createLatestRequestSequence, deriveAttentionItems, deriveWorkspace, installRevenueRefreshLifecycle, planGenerationFeedback, preferredOperatorCampaignId, shouldPollRevenueLab } from './revenueLabWorkspace'
import './revenueLabDashboard.css'

const EMPTY = { config: { configured: false, missing: [], analysis: { configured: false, missing: ['OPENAI_API_KEY'] }, creativeProduction: { configured: false, missing: ['OPENAI_API_KEY'] }, multiProductShorts: { configured: false, missing: ['OPENAI_API_KEY'] }, multiProductShortsV2: { configured: false, missing: ['OPENAI_API_KEY'], templateId: 'hero-carousel-v2' }, textToSpeech: { configured: false, missing: ['ELEVENLABS_API_KEY'] }, finalComposition: { configured: false, missing: ['REVENUE_LAB_FFMPEG_PATH'] }, finalCompositionV2: { configured: false, missing: ['REVENUE_LAB_PRODUCT_ASSET_BUCKET', 'REVENUE_LAB_CREATIVE_AUDIO_BUCKET', 'REVENUE_LAB_COMPOSITION_BUCKET', 'REVENUE_LAB_FFMPEG_PATH', 'REVENUE_LAB_FFPROBE_PATH'] }, productAssetRevisions: { configured: false, missing: ['REVENUE_LAB_PRODUCT_ASSET_BUCKET'] }, videoGeneration: { configured: false, missing: ['POLLO_API_KEY'], provider: 'pollo', requestedModel: 'pollo-v2' }, imageToVideo: { configured: false, missing: ['POLLO_API_KEY', 'REVENUE_LAB_PRODUCT_ASSET_BUCKET'], provider: 'pollo', requestedModel: 'wan-v2-2-flash' }, products: { configured: false, missing: ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'] }, youtubeAnalytics: { configured: false, missing: ['YOUTUBE_ANALYTICS_CLIENT_ID', 'YOUTUBE_ANALYTICS_CLIENT_SECRET'] } }, queries: [], opportunities: [], trackingOpportunities: [], analyses: [], productSearches: [], campaigns: [], youtubeAnalyticsConnection: null, youtubeAnalyticsFlow: { status: 'idle', errorCode: null }, latestJob: null, latestRun: null, latestTrackingRun: null }

function jstDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const pick = type => parts.find(part => part.type === type)?.value
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

export function analyticsDefaultRange(publishedAt, now = new Date()) {
  const endDate = jstDate(new Date(now.getTime() - 86_400_000))
  const publishedDate = jstDate(publishedAt)
  return { startDate: publishedDate && publishedDate <= endDate ? publishedDate : endDate, endDate }
}

export function nullableMetric(value, suffix = '') {
  return value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toLocaleString('ja-JP')}${suffix}`
}

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
  const detailRef = useRef(null)
  const reviewUrl = videoReviewUrl(item)
  const velocity = velocityPresentation(item.velocityMode)
  const reasons = opportunityReasons(item)
  const productName = analysis?.output?.product_or_theme_name || item.title
  const openDetails = () => { if (detailRef.current) detailRef.current.open = true }
  return <article className="revenue-opportunity">
    <span className="revenue-rank">#{index + 1}</span>
    {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />}
    <div><p className="revenue-channel">{item.merchant || item.channelTitle || 'merchant未確認'}</p><h3>{productName}</h3>
      <div className="revenue-opportunity-summary"><strong>Opportunity {scoreLabel(item.opportunityScore)}</strong>{tracking && <span>継続上昇</span>}{analysis?.status === 'succeeded' && <span>分析済み</span>}</div>
      <div className="revenue-opportunity-actions"><button type="button" onClick={openDetails}>商品登録</button><button type="button" onClick={openDetails}>Three Picksへ</button></div>
      <details ref={detailRef} className="revenue-opportunity-detail"><summary>詳細を見る</summary><dl className="revenue-review-metrics">
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
      <details className="revenue-score-details"><summary>内部評価</summary><dl>
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
      <AnalysisPanel analysis={analysis} productSearch={productSearch} productConfig={productConfig} busy={busy} onReview={onReview} onProductSearch={onProductSearch} onProductDecision={onProductDecision} onCreateCampaign={onCreateCampaign} /></details>
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

function AnalyticsConnectionPanel({ config, connection, flow, busy, onConnect }) {
  const status = connection?.connectionStatus || (flow?.status === 'authorizing' ? 'authorizing' : 'disconnected')
  const labels = { connected: '接続済み', authorizing: '認証待ち', reauth_required: '再認証が必要', revoked: '失効', error: '接続エラー', disconnected: '未接続' }
  return <section className="revenue-analytics-panel" aria-labelledby="youtube-analytics-heading">
    <div><p className="revenue-kicker">PHASE 3B · OWNER ANALYTICS</p><h2 id="youtube-analytics-heading">YouTube Analytics</h2><p>公開動画の実績をCampaign Iterationへ紐付けます。認証情報はこの画面やSupabaseへ保存しません。</p></div>
    <div className="revenue-analytics-status"><span className={`revenue-status is-${status}`}>{labels[status] || status}</span>
      {connection && <strong>{connection.channelTitle} <small>{connection.channelId}</small></strong>}
      {connection?.lastVerifiedAt && <small>最終確認: {publishedLabel(connection.lastVerifiedAt)}</small>}
      {flow?.errorCode && <small className="revenue-warning">{flow.errorCode}</small>}
    </div>
    <button className="corp-primary" disabled={busy || !config?.configured || flow?.status === 'authorizing'} onClick={onConnect}>{status === 'reauth_required' ? 'YouTube Analyticsを再接続' : 'YouTube Analyticsを接続'}</button>
    {!config?.configured && <p className="revenue-warning">サーバー側に {config?.missing?.join(' / ') || 'OAuth設定'} を設定してください。</p>}
    {flow?.status === 'authorizing' && <p className="revenue-warning">system browserでGoogle認証を完了してください。この画面は接続状態を自動確認します。</p>}
  </section>
}

function PerformanceSnapshot({ snapshot }) {
  if (!snapshot) return <p className="revenue-product-facts">Performance Snapshotはまだありません。</p>
  return <div className="revenue-performance"><strong>最新Performance</strong><dl>
    <div><dt>Views</dt><dd>{nullableMetric(snapshot.views)}</dd></div>
    <div><dt>Watch time</dt><dd>{nullableMetric(snapshot.estimatedMinutesWatched, '分')}</dd></div>
    <div><dt>平均視聴時間</dt><dd>{nullableMetric(snapshot.averageViewDuration, '秒')}</dd></div>
    <div><dt>平均視聴率</dt><dd>{nullableMetric(snapshot.averageViewPercentage, '%')}</dd></div>
    <div><dt>登録 + / -</dt><dd>{nullableMetric(snapshot.subscribersGained)} / {nullableMetric(snapshot.subscribersLost)}</dd></div>
    <div><dt>Like / Comment / Share</dt><dd>{nullableMetric(snapshot.likes)} / {nullableMetric(snapshot.comments)} / {nullableMetric(snapshot.shares)}</dd></div>
  </dl><small>対象 {snapshot.requestedStartDate}〜{snapshot.requestedEndDate} · data through {snapshot.dataThroughDate || '未確定'} · {snapshot.queryVersion} · 取得 {publishedLabel(snapshot.capturedAt)}</small></div>
}

function PublicationAnalyticsForm({ publication, connection, busy, onCollect }) {
  const [range, setRange] = useState(() => analyticsDefaultRange(publication.publishedAt))
  const connected = connection?.connectionStatus === 'connected'
  return <form className="revenue-analytics-form" onSubmit={event => { event.preventDefault(); onCollect(publication.id, range) }}>
    <strong>Manual Performance Snapshot</strong>
    <label>開始日<input type="date" required value={range.startDate || ''} onChange={event => setRange({ ...range, startDate: event.target.value })} /></label>
    <label>終了日<input type="date" required value={range.endDate || ''} onChange={event => setRange({ ...range, endDate: event.target.value })} /></label>
    <button type="submit" disabled={busy || !connected}>Analyticsを取得</button>
    {!connected && <small>{connection?.connectionStatus === 'reauth_required' ? '再認証してから取得してください。' : 'YouTube Analyticsを接続すると取得できます。'}</small>}
  </form>
}

function IterationCreativeForm({ campaignId, iteration, busy, createNew = false, onUpdate, onCreate }) {
  const [form, setForm] = useState({
    appealHypothesis: iteration.appealHypothesis || '', hookText: iteration.hookText || '',
    contentOutline: iteration.contentOutline?.text || '', scriptText: iteration.scriptText || '',
  })
  const update = (name, value) => setForm(previous => ({ ...previous, [name]: value }))
  return <details className="revenue-iteration-operation"><summary>{createNew ? 'この内容から新Iterationを作る' : '公開前の内容を編集'}</summary>
    <form onSubmit={event => { event.preventDefault(); createNew ? onCreate(campaignId, iteration.id, form) : onUpdate(iteration.id, form) }}>
      <label>訴求仮説<textarea required maxLength={1000} value={form.appealHypothesis} onChange={event => update('appealHypothesis', event.target.value)} /></label>
      <label>Hook<textarea required maxLength={500} value={form.hookText} onChange={event => update('hookText', event.target.value)} /></label>
      <label>台本・構成<textarea required maxLength={5000} value={form.contentOutline} onChange={event => update('contentOutline', event.target.value)} /></label>
      <label>台本本文（任意）<textarea maxLength={20000} value={form.scriptText} onChange={event => update('scriptText', event.target.value)} /></label>
      <button type="submit" disabled={busy}>{createNew ? '新しいdraft Iterationを作成' : 'draftを上書き保存'}</button>
      <small>{createNew ? '公開済みIterationは変更せず、新しい実験単位として保存します。' : 'Campaign・Iteration・商品・Commerce lineageのIDは維持されます。'}</small>
    </form>
  </details>
}

function CampaignDisposition({ campaign, busy, onDelete, onVoid }) {
  const [reason, setReason] = useState('duplicate')
  const [note, setNote] = useState('')
  if (campaign.canHardDelete) return <div className="revenue-campaign-disposition"><p>Publication・Analytics・成果がなく、draftだけのため削除できます。</p><button type="button" disabled={busy} onClick={() => {
    if (window.confirm('このCampaignとdraft Iterationを完全に削除します。元に戻せません。')) onDelete(campaign.id)
  }}>下書きCampaignを削除</button></div>
  return <details className="revenue-campaign-disposition"><summary>重複・誤登録として無効化</summary><form onSubmit={event => { event.preventDefault(); onVoid(campaign.id, reason, note) }}>
    <label>理由<select value={reason} onChange={event => setReason(event.target.value)}><option value="duplicate">重複</option><option value="mistake">誤登録</option><option value="test">テスト</option><option value="other">その他</option></select></label>
    <label>補足{reason === 'other' ? '（必須）' : '（任意）'}<textarea required={reason === 'other'} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
    <button type="submit" disabled={busy || (reason === 'other' && !note.trim())}>Campaignを無効化</button><small>Publication・Performance・lineageは削除されません。</small>
  </form></details>
}

const emptyDirectAsset = () => ({ assetUrl: '', assetKind: 'hero', assetSource: 'self_owned', usagePermission: 'owned', label: '' })
const emptyDirectProductForm = () => ({
  merchant: '', productName: '', productUrl: '', affiliateUrl: '',
  priceAmount: '', currency: 'JPY', productCategory: '', verifiedFacts: '', cautions: '', productNotes: '',
  isOwnProduct: false, assets: [emptyDirectAsset()],
})

function DirectProductIntake({ busy, onCreate }) {
  const [form, setForm] = useState(emptyDirectProductForm)
  const [submissionKey, setSubmissionKey] = useState(newCampaignIdempotencyKey)
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(null)
  const submittingRef = useRef(false)
  const update = (name, value) => { setSaved(null); setForm(previous => ({ ...previous, [name]: value })) }
  const updateAsset = (index, name, value) => setForm(previous => ({
    ...previous, assets: previous.assets.map((asset, assetIndex) => assetIndex === index ? { ...asset, [name]: value } : asset),
  }))
  return <section id="direct-product-intake" className="revenue-direct-intake" aria-labelledby="direct-product-heading">
    <h2 id="direct-product-heading" className="revenue-visually-hidden">商品を手動登録</h2>
    <details className="revenue-manual-product"><summary>＋ 商品を手動登録</summary><form onSubmit={async event => {
      event.preventDefault()
      if (submittingRef.current) return
      submittingRef.current = true; setSubmitting(true)
      try {
        const result = await onCreate({ ...form, idempotencyKey: submissionKey, priceAmount: form.priceAmount === '' ? null : Number(form.priceAmount) })
        setSaved(result || { created: true })
        setForm(emptyDirectProductForm())
        setSubmissionKey(newCampaignIdempotencyKey())
      } catch {
        // Shared Dashboard alert presents the sealed API error.
      } finally { submittingRef.current = false; setSubmitting(false) }
    }}><p>商品情報と利用可能な素材を登録します。制作案はThree PicksでAIが作成します。</p>
      <fieldset><legend>商品</legend>
        <label>商品名<input required maxLength={240} value={form.productName} onChange={event => update('productName', event.target.value)} /></label>
        <label>merchant<input required maxLength={80} value={form.merchant} onChange={event => update('merchant', event.target.value)} /></label>
        <label>商品URL（HTTPS）<input required type="url" value={form.productUrl} onChange={event => update('productUrl', event.target.value)} /></label>
        <label>commerce destination（任意）<input type="url" value={form.affiliateUrl} onChange={event => update('affiliateUrl', event.target.value)} placeholder="未入力時は商品URLを使用" /></label>
      </fieldset>
      <fieldset><legend>Product Asset</legend>
        <p className="revenue-product-facts">素材URLと利用可否を登録してください。許諾不明素材は制作に使用しません。</p>
        {form.assets.map((asset, index) => <div className="revenue-asset-input" key={index}>
          <label>素材URL（HTTPS）<input required type="url" value={asset.assetUrl} onChange={event => updateAsset(index, 'assetUrl', event.target.value)} /></label>
          <label>素材利用可否<select value={asset.usagePermission} onChange={event => updateAsset(index, 'usagePermission', event.target.value)}><option value="owned">保有素材</option><option value="licensed">利用許可済み</option><option value="authorized_reference">参照許可済み</option><option value="unknown">利用可否不明</option></select></label>
          <details><summary>素材の詳細</summary><div className="revenue-form-pair"><label>素材種別<select value={asset.assetKind} onChange={event => updateAsset(index, 'assetKind', event.target.value)}><option value="hero">メイン</option><option value="detail">詳細</option><option value="package">パッケージ</option><option value="lifestyle">利用シーン</option><option value="logo">ロゴ</option><option value="other">その他</option></select></label><label>入手元<select value={asset.assetSource} onChange={event => updateAsset(index, 'assetSource', event.target.value)}><option value="self_owned">自社保有</option><option value="brand_supplied">ブランド提供</option><option value="licensed_library">ライセンス素材</option><option value="retailer_reference">販売ページ参照</option><option value="other">その他</option></select></label></div><label>素材メモ（任意）<input maxLength={160} value={asset.label} onChange={event => updateAsset(index, 'label', event.target.value)} /></label></details>
          <button type="button" onClick={() => update('assets', form.assets.filter((_, assetIndex) => assetIndex !== index))}>素材を外す</button>
        </div>)}
        <button type="button" disabled={form.assets.length >= 10} onClick={() => update('assets', [...form.assets, emptyDirectAsset()])}>素材を追加</button>
      </fieldset>
      <details className="revenue-product-fact-confirmation"><summary>確認済み事実の詳細 · {form.verifiedFacts.trim() ? '入力済み' : '入力してください'}</summary><fieldset>
        <p className="revenue-product-facts">人間が確認した内容だけを登録します。AIは商品事実を補完しません。</p>
        <label>確認済み事実<textarea required maxLength={4000} value={form.verifiedFacts} onChange={event => update('verifiedFacts', event.target.value)} placeholder="例：容量500ml（商品資料で確認）" /></label>
        <div className="revenue-form-pair"><label>価格（任意）<input type="number" min="0" step="0.01" value={form.priceAmount} onChange={event => update('priceAmount', event.target.value)} /></label><label>通貨<input required maxLength={3} value={form.currency} onChange={event => update('currency', event.target.value.toUpperCase())} /></label></div>
        <label>カテゴリ（任意）<input maxLength={120} value={form.productCategory} onChange={event => update('productCategory', event.target.value)} /></label>
        <label>注意事項（任意）<textarea maxLength={2000} value={form.cautions} onChange={event => update('cautions', event.target.value)} /></label>
        <label>運用メモ（任意）<textarea maxLength={1000} value={form.productNotes} onChange={event => update('productNotes', event.target.value)} /></label>
        <label className="revenue-own-product"><input type="checkbox" checked={form.isOwnProduct} onChange={event => update('isOwnProduct', event.target.checked)} />自社商品</label>
      </fieldset></details>
      {saved && <p className="revenue-save-success" role="status"><strong>商品を登録しました。</strong> Three Picksの商品候補へ反映されます。{saved.idempotentReplay ? ' 同一操作は既存記録へ統合されました。' : ''}</p>}
      <button className="corp-primary" disabled={busy || submitting} type="submit">{submitting ? '保存中…' : saved ? '続けて商品を追加' : '商品を登録'}</button>
    </form></details>
  </section>
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

const THREE_PICKS_ASSET_PERMISSIONS = new Set(['owned', 'licensed', 'authorized_reference'])

function compactProductLabel(value, fallback = '商品') {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  return Array.from(text || fallback).slice(0, 40).join('')
}

function candidateFactBadge(factEntry) {
  if (!factEntry) return '確認済み事実なし'
  const value = typeof factEntry[1] === 'object' ? factEntry[1]?.value : factEntry[1]
  return Array.from(String(value ?? factEntry[0]).trim().replace(/\s+/g, ' ')).slice(0, 48).join('')
}

export function buildThreePicksCandidatePool(campaigns = []) {
  const seen = new Set(); const candidates = []
  for (const campaign of campaigns) for (const iteration of campaign.iterations || []) {
    const product = iteration.product
    if (!product?.id || seen.has(product.id)) continue
    seen.add(product.id)
    const factEntry = Object.entries(product.verifiedFacts || {}).find(([, value]) => value != null && String(value).trim() !== '') || null
    const permittedAssets = (product.assets || []).filter(asset => asset.creativeEligible
      || THREE_PICKS_ASSET_PERMISSIONS.has(asset.usagePermission))
    const revisions = permittedAssets.flatMap(asset => (asset.revisions || []).map(revision => ({
      ...revision, assetId: asset.id, assetPermission: asset.usagePermission,
    }))).filter(revision => revision.availabilityStatus === 'available'
      && THREE_PICKS_ASSET_PERMISSIONS.has(revision.permissionSnapshot || revision.assetPermission))
    const commerceDestination = product.affiliateUrl || product.productUrl || null
    const ineligibleReasons = []
    if (!factEntry) ineligibleReasons.push('確認済み事実がありません')
    if (!commerceDestination) ineligibleReasons.push('commerce destinationがありません')
    if (!permittedAssets.length) ineligibleReasons.push('利用許可済みProduct Assetがありません')
    if (permittedAssets.length && !revisions.length) ineligibleReasons.push('Asset Revisionがありません')
    candidates.push({
      product, asset: permittedAssets[0] || null, imageAsset: (product.assets || []).find(asset => asset.assetUrl) || null,
      revision: revisions[0] || null, revisions: revisions.slice(0, 4), verifiedFactRef: factEntry?.[0] || null,
      displayName: compactProductLabel(product.productName), factBadge: candidateFactBadge(factEntry),
      shortAppeal: 'Three Picks制作案の生成時に作成',
      verifiedFactsAvailable: Boolean(factEntry), commerceDestinationAvailable: Boolean(commerceDestination),
      productAssetAvailable: permittedAssets.length > 0, assetRevisionAvailable: revisions.length > 0,
      eligible: ineligibleReasons.length === 0, ineligibleReasons,
    })
  }
  return candidates
}

export function toggleThreePicksSelection(selected, productId, checked) {
  if (!checked) return selected.filter(id => id !== productId)
  if (selected.includes(productId) || selected.length >= 3) return selected
  return [...selected, productId]
}

export function canCreateThreePicks(selected, candidates) {
  return selected.length === 3 && new Set(selected).size === 3
    && selected.every(id => candidates.find(candidate => candidate.product.id === id)?.eligible)
}

function ThreePicksIntake({ campaigns, busy, assetRevisionConfig, onCreate, onCreateAssetRevision }) {
  const candidates = buildThreePicksCandidatePool(campaigns)
  const eligibleCount = candidates.filter(candidate => candidate.eligible).length
  const [selected, setSelected] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [saved, setSaved] = useState(false)
  const keyRef = useRef(newCampaignIdempotencyKey())
  const canSubmit = canCreateThreePicks(selected, candidates)
  const openDirectProductIntake = () => {
    const intake = document.getElementById('direct-product-intake')
    const details = intake?.querySelector('details')
    if (details) details.open = true
    intake?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const submit = async event => {
    event.preventDefault(); if (!canSubmit || submitting || busy) return
    setSubmitting(true)
    try {
      await onCreate({ idempotencyKey: keyRef.current, campaignName: 'おすすめ3選 Shorts v2',
        objective: '実商品画像を主役に35〜45秒で3商品を紹介する',
        items: selected.map(id => {
          const entry = candidates.find(candidate => candidate.product.id === id)
          return { curatedProductId: id, productAssetRevisionIds: entry.revisions.map(revision => revision.id), verifiedFactRef: entry.verifiedFactRef }
        }) })
      setSaved(true)
    } finally { setSubmitting(false) }
  }
  return <section className="revenue-three-picks-intake" aria-labelledby="three-picks-intake-heading">
    <div className="revenue-section-heading"><div><p className="revenue-kicker">STEP 2 · THREE PICKS制作</p><h2 id="three-picks-intake-heading">Three Picksを作成</h2><p>3商品を表示順に選びます。順位付けではありません。</p></div><span>Human selection</span></div>
    <div className="revenue-three-picks-toolbar"><strong>商品候補pool</strong><span>{eligibleCount}件 eligible / {candidates.length}件</span><span aria-live="polite">選択数 {selected.length} / 3</span></div>
    {eligibleCount < 3 && <div className="revenue-three-picks-shortage"><p className="revenue-warning">eligibleな商品が3件必要です。候補を追加するか、不足している準備を完了してください。</p><button type="button" onClick={openDirectProductIntake}>商品を追加</button></div>}
    {!candidates.length && <p className="revenue-three-picks-empty">商品候補はまだありません。既存のDirect Product Intakeから登録してください。</p>}
    <div className="revenue-three-picks-pool">{candidates.map(candidate => {
      const selectedIndex = selected.indexOf(candidate.product.id)
      const selectionDisabled = selectedIndex < 0 && (!candidate.eligible || selected.length >= 3)
      return <article key={candidate.product.id} className={`revenue-three-picks-candidate ${candidate.eligible ? 'is-eligible' : 'is-ineligible'}`}>
        <label className="revenue-three-picks-check"><input type="checkbox" aria-label={`${candidate.product.productName}を選択`} checked={selectedIndex >= 0} disabled={busy || submitting || saved || selectionDisabled} onChange={event => setSelected(current => toggleThreePicksSelection(current, candidate.product.id, event.target.checked))} /><span>{selectedIndex >= 0 ? `PICK ${selectedIndex + 1}` : '選択'}</span></label>
        {candidate.imageAsset?.assetUrl ? <img src={candidate.imageAsset.assetUrl} alt={`${candidate.product.productName}の商品画像`} /> : <div className="revenue-three-picks-no-image">画像なし</div>}
        <div className="revenue-three-picks-candidate-copy"><h3>{candidate.displayName}</h3>
          <p className={`revenue-three-picks-eligibility ${candidate.eligible ? 'is-eligible' : 'is-ineligible'}`}><strong>{candidate.eligible ? 'eligible' : 'not eligible'}</strong>{candidate.eligible ? ' · Three Picksに使用できます' : ` · ${candidate.ineligibleReasons.join(' / ')}`}</p>
          <p className="revenue-three-picks-short-appeal"><strong>短い訴求</strong> {candidate.shortAppeal}</p>
          <span className="revenue-fact-badge">{candidate.factBadge}</span>
          {!candidate.assetRevisionAvailable && candidate.asset && <button type="button" disabled={busy || submitting || !assetRevisionConfig?.configured} onClick={async () => { setSubmitting(true); try { await onCreateAssetRevision(candidate.asset.id, false, false) } finally { setSubmitting(false) } }}>Asset Revisionを準備</button>}
          <details className="revenue-audit-details"><summary>詳細・監査情報</summary><dl><div><dt>merchant</dt><dd>{candidate.product.merchant || '未登録'}</dd></div><div><dt>verified facts</dt><dd>{candidate.verifiedFactsAvailable ? 'あり' : 'なし'}</dd></div><div><dt>Product Asset</dt><dd>{candidate.productAssetAvailable ? 'あり' : 'なし'}</dd></div><div><dt>Asset Revision</dt><dd>{candidate.assetRevisionAvailable ? `あり · #${candidate.revision.revisionNumber}` : 'なし'}</dd></div><div><dt>commerce destination</dt><dd>{candidate.commerceDestinationAvailable ? 'あり' : 'なし'}</dd></div></dl></details>
        </div>
      </article>
    })}</div>
    <form className="revenue-three-picks-create" onSubmit={submit}>
      {saved && <p className="revenue-save-success" role="status"><strong>Three Picks Campaignを保存しました。</strong> 台帳から制作案を生成できます。</p>}
      <p className="revenue-three-picks-template">Creative Archetype v2 · 35〜45秒 · hero-carousel-v2</p>
      <button className="corp-primary" disabled={busy || submitting || saved || !canSubmit}>{saved ? '保存済み' : submitting ? '保存中…' : 'Three Picks v2を作成'}</button>
    </form>
  </section>
}

export function threePicksCardPresentation(card) {
  const snapshot = card?.cardSnapshot || {}
  return {
    displayName: snapshot.display_name || card?.productName || '商品',
    shortAppeal: card?.shortAppeal || '',
    factBadge: snapshot.fact_badge || snapshot.on_screen_text || String(card?.verifiedFact?.value ?? '—'),
    tts: snapshot.tts || card?.shortAppeal || '',
  }
}

export function initialAudioLiveValidationArtifactId(artifacts = []) {
  if (artifacts.some(item => item.status !== 'planned')) return null
  const planned = artifacts.filter(item => item.status === 'planned')
  const byOrder = (left, right) => Number(left.segmentOrder || 0) - Number(right.segmentOrder || 0)
  return ([...planned].filter(item => item.sceneId === 'hook').sort(byOrder)[0] || [...planned].sort(byOrder)[0])?.id || null
}

export function threePicksRevisionSelection(revisions = []) {
  const timestamp = revision => {
    const value = Date.parse(revision?.generatedAt || revision?.createdAt || '')
    return Number.isFinite(value) ? value : 0
  }
  const ordered = [...revisions].sort((left, right) => {
    const revisionDelta = Number(right?.revisionNumber || 0) - Number(left?.revisionNumber || 0)
    return revisionDelta || timestamp(right) - timestamp(left) || String(right?.requestId || '').localeCompare(String(left?.requestId || ''))
  })
  return { latest: ordered[0] || null, past: ordered.slice(1) }
}

export function audioArtifactsForPlan(revision) {
  if (!revision?.planId) return []
  return (revision.audioArtifacts || []).filter(artifact => artifact.creativeArchetypePlanId === revision.planId)
}

export function creativeAudioStatusCounts(artifacts = []) {
  return {
    ready: artifacts.filter(item => item.status === 'ready').length,
    planned: artifacts.filter(item => item.status === 'planned').length,
    failed: artifacts.filter(item => item.status === 'failed').length,
  }
}

const THREE_PICKS_TIMING = [
  { id: 'hook', label: 'Hook', preferredSeconds: 4, maximumSeconds: 5 },
  { id: 'product-1', label: 'Product 1', preferredSeconds: 10, maximumSeconds: 13 },
  { id: 'product-2', label: 'Product 2', preferredSeconds: 10, maximumSeconds: 13 },
  { id: 'product-3', label: 'Product 3', preferredSeconds: 10, maximumSeconds: 13 },
  { id: 'cta', label: 'CTA', preferredSeconds: 5, maximumSeconds: 6 },
]

export function threePicksTimingPreflight(artifacts = []) {
  const scenes = THREE_PICKS_TIMING.map(scene => {
    const sceneArtifacts = artifacts.filter(artifact => artifact.sceneId === scene.id)
    const ready = sceneArtifacts.length > 0 && sceneArtifacts.every(artifact => artifact.status === 'ready'
      && Number(artifact.durationSeconds) > 0)
    const narrationSeconds = ready
      ? sceneArtifacts.reduce((sum, artifact) => sum + Number(artifact.durationSeconds), 0) : null
    const requiredSeconds = ready
      ? Math.max(scene.preferredSeconds * 30, Math.ceil((narrationSeconds + 0.5) * 30)) / 30 : null
    const overflowSeconds = ready ? Math.max(0, requiredSeconds - scene.maximumSeconds) : null
    return { ...scene, segmentCount: sceneArtifacts.length, ready,
      narrationSeconds: narrationSeconds == null ? null : Number(narrationSeconds.toFixed(3)),
      requiredSeconds: requiredSeconds == null ? null : Number(requiredSeconds.toFixed(3)),
      overflowSeconds: overflowSeconds == null ? null : Number(overflowSeconds.toFixed(3)),
      fit: ready && overflowSeconds === 0 }
  })
  const allReady = scenes.every(scene => scene.ready)
  return { scenes, allReady, fit: allReady && scenes.every(scene => scene.fit),
    totalRequiredSeconds: allReady ? Number(scenes.reduce((sum, scene) => sum + scene.requiredSeconds, 0).toFixed(3)) : null }
}

export function threePicksGenerationFeedback(revision, failure, latestJob = null) {
  const hydrated = planGenerationFeedback(revision, latestJob)
  if (hydrated) return hydrated
  if (failure) return { kind: 'error', message: failure.message || '制作案を生成できませんでした。商品説明の形式を確認してください。' }
  return null
}

export function ThreePicksGenerationFeedback({ feedback }) {
  if (!feedback) return null
  const className = feedback.kind === 'error' ? 'revenue-warning' : feedback.kind === 'success' ? 'revenue-success' : 'revenue-product-facts'
  return <div className={className}
    role={feedback.kind === 'error' ? 'alert' : 'status'}><p>{feedback.message}{feedback.detail && <><br /><small>{feedback.detail}</small></>}</p>
    {feedback.audit && <details className="revenue-audit-details"><summary>AI生成エラー監査情報</summary>
      <small>HTTP: {feedback.audit.httpStatus}<br />Provider code: {feedback.audit.providerErrorCode}<br />
        Provider type: {feedback.audit.providerErrorType}<br />Reason: {feedback.audit.reason}</small></details>}</div>
}

function ThreePicksScriptReview({ output }) {
  if (!output) return null
  const metaByField = new Map((output.soft_copy_fields || []).map(item => [item.field, item]))
  const normalizedMode = field => ({ human_edited: 'manual_edited', manual_edit: 'manual_edited', manually_edited: 'manual_edited' })[metaByField.get(field)?.generation_mode] || metaByField.get(field)?.generation_mode
  const modeLabel = field => ({ ai_generated: 'AI生成', ai_repaired: '自動修正', canonical_fallback: '安全文', manual_edited: '手動修正' })[normalizedMode(field)] || null
  const originBadge = field => modeLabel(field) && <small className={`revenue-copy-mode is-${normalizedMode(field)}`}>{modeLabel(field)}</small>
  const reviewBadge = field => { const meta = metaByField.get(field); const confirmed = meta?.reviewed === true || ['confirmed', 'reviewed'].includes(meta?.review_status); return <small className={`revenue-review-mode ${confirmed ? 'is-confirmed' : 'is-pending'}`}>{confirmed ? '確認済み' : '未確認'}</small> }
  const badges = field => <span className="revenue-copy-badges">{originBadge(field)}{reviewBadge(field)}</span>
  return <section className="revenue-script-review" aria-label="音声生成前の文章確認">
    <h4>音声生成前の文章確認</h4>
    <p className="revenue-script-copy"><strong>Hook TTS:</strong> {output.hook?.tts} {badges('hook')}</p>
    <div className="revenue-three-picks-cards">{[...(output.product_presentations || [])].sort((a, b) => a.presentation_order - b.presentation_order).map((item, index) => <article key={item.product_set_item_id}>
      <span>PICK {item.presentation_order}</span><strong>{item.display_name}</strong><p className="revenue-script-copy"><strong>訴求:</strong> {item.short_appeal} {badges(`products[${index}].short_appeal`)}</p><small className="revenue-fact-badge">{item.fact_badge}</small><p className="revenue-script-copy"><strong>TTS:</strong> {item.tts} {badges(`products[${index}].tts`)}</p>
    </article>)}</div>
    <p className="revenue-script-copy"><strong>CTA TTS:</strong> {output.cta?.tts} {badges('cta')}</p>
  </section>
}

function ThreePicksPanel({ iteration, plannerConfig, textToSpeechConfig, composerConfig, busy, latestJob = null, onGeneratePlan, onGenerateAudio, onGenerateAudioArtifact, onCompose, onPreview }) {
  const [submitting, setSubmitting] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [compositionError, setCompositionError] = useState('')
  const [generationFailure, setGenerationFailure] = useState(null)
  const keyRef = useRef(newCampaignIdempotencyKey())
  const revisions = iteration.archetypePlans || []
  const isV2 = iteration.productSet?.archetype === 'three_picks_v2'
  const revisionSelection = threePicksRevisionSelection(revisions)
  const visibleRevisions = isV2 ? [revisionSelection.latest].filter(Boolean) : revisions
  const activeLayoutId = ['multi-product-shorts-plan-v4', 'multi-product-shorts-plan-v5'].includes(revisionSelection.latest?.schemaVersion)
    ? 'hero-product-layout-v2' : 'hero-product-layout-v1'
  const generationFeedback = threePicksGenerationFeedback(revisionSelection.latest, generationFailure, latestJob)
  useEffect(() => { setGenerationFailure(null) }, [revisionSelection.latest?.requestId, revisionSelection.latest?.status])
  const generate = async () => {
    setSubmitting(true); setGenerationFailure(null)
    try {
      await onGeneratePlan(iteration.id, keyRef.current)
      keyRef.current = newCampaignIdempotencyKey()
    } catch (failure) {
      setGenerationFailure(failure)
    } finally { setSubmitting(false) }
  }
  const compose = async planId => {
    setSubmitting(true); setCompositionError('')
    try { await onCompose(planId, keyRef.current); keyRef.current = newCampaignIdempotencyKey() }
    catch (failure) { setCompositionError(failure?.message || 'MP4合成を開始できませんでした。') }
    finally { setSubmitting(false) }
  }
  const generateAudio = async planId => { setSubmitting(true); try { await onGenerateAudio(planId, keyRef.current); keyRef.current = newCampaignIdempotencyKey() } finally { setSubmitting(false) } }
  const generateAudioArtifact = async artifactId => { setSubmitting(true); try { await onGenerateAudioArtifact(artifactId, keyRef.current); keyRef.current = newCampaignIdempotencyKey() } finally { setSubmitting(false) } }
  const preview = async outputId => { const result = await onPreview(outputId); setPreviewUrl(result.previewUrl) }
  return <section className="revenue-three-picks-panel">
    <div className="revenue-product-heading"><strong>{isV2 ? 'Creative Archetype v2 Plan' : 'Three Picks Plan'}</strong><button className="corp-primary" disabled={busy || submitting || !plannerConfig?.configured} onClick={generate}>{submitting ? '処理中…' : revisions.length ? '新しい制作案を生成' : 'Three Picks制作案を生成'}</button></div>
    <ThreePicksGenerationFeedback feedback={generationFeedback} />
    {isV2 && <p className="revenue-three-picks-template"><strong>固定テンプレート:</strong> hero-carousel-v2 · {activeLayoutId} · 35〜45秒</p>}
    {!plannerConfig?.configured && <p className="revenue-warning">OPENAI_API_KEYを設定すると制作案を生成できます。</p>}
    {visibleRevisions.map((revision, index) => { const revisionArtifacts = isV2 ? audioArtifactsForPlan(revision) : revision.audioArtifacts || []; const counts = creativeAudioStatusCounts(revisionArtifacts); const timingPreflight = threePicksTimingPreflight(revisionArtifacts); return <details key={`${revision.planId || 'no-plan'}:${revision.requestId}`} open={index === 0}><summary>{isV2 ? <><strong>制作案 Revision {revision.revisionNumber}</strong> · 最新 · artifact {revisionArtifacts.length}件 · ready {counts.ready} / planned {counts.planned} / failed {counts.failed}</> : <>制作案 {revisions.length - index} · {jobStatusLabel(revision.status)}</>}</summary>
      {revision.output && (isV2
        ? <><p><strong>Hook:</strong> {revision.output.hook?.display_text}</p><ThreePicksScriptReview output={revision.output} /><p><strong>CTA:</strong> {revision.output.cta?.display_text}</p></>
        : <><p><strong>Hook:</strong> {revision.output.hook}</p><div className="revenue-three-picks-cards">{revision.productCards.map(card => { const view = threePicksCardPresentation(card); return <article key={card.id}><span>PICK {card.pickNumber}</span><strong>{view.displayName}</strong><p>{view.shortAppeal}</p><small className="revenue-fact-badge">{view.factBadge}</small><details><summary>ナレーション原稿</summary><p>{view.tts}</p></details></article> })}</div><p><strong>Summary:</strong> {revision.output.summary}</p><p><strong>CTA:</strong> {revision.output.cta}</p></>)}
      {isV2 && revision.planId && (() => { const artifacts = revisionArtifacts; const plannedCount = artifacts.filter(item => item.status === 'planned').length; const initialTargetId = initialAudioLiveValidationArtifactId(artifacts); return <div className="revenue-audio-readiness"><details><summary><strong>TTS narration segments</strong> <span>{artifacts.filter(item => item.status === 'ready').length} / {artifacts.length} ready</span></summary><p>ElevenLabsでsegment単位に生成し、字幕cueにはFFprobe実測durationを使います。</p>{initialTargetId && <p className="revenue-product-facts">初回Live ValidationではHookの最初のsegmentだけを生成できます。</p>}<div className="revenue-audio-segments">{artifacts.map(item => { const canGenerateSingle = item.status === 'planned' && (!initialTargetId || item.id === initialTargetId); return <article key={`${revision.planId}:${item.id}`}><div><strong>{item.sceneId || 'scene'} · {item.segmentId}</strong><span>{jobStatusLabel(item.status)}</span></div>{item.inputText && <p>{item.inputText}</p>}{item.id === initialTargetId && <small>初回Live Validation推奨</small>}{item.status === 'planned' && <button type="button" disabled={busy || submitting || !textToSpeechConfig?.configured || !canGenerateSingle} onClick={() => generateAudioArtifact(item.id)}>このsegmentだけ音声生成</button>}</article> })}</div></details><button type="button" disabled={busy || submitting || !textToSpeechConfig?.configured || plannedCount === 0 || Boolean(initialTargetId)} onClick={() => generateAudio(revision.planId)}>全planned segmentを生成（{plannedCount}件 / 最大15件）</button>{artifacts.some(item => item.status === 'submission_uncertain') && <p className="revenue-warning">送信結果を確認できないsegmentがあります。二重課金防止のため自動再送信しません。</p>}{artifacts.some(item => item.status === 'failed') && <p className="revenue-warning">音声生成に失敗したsegmentがあります。無音fallbackは行いません。</p>}<details className="revenue-audit-details"><summary>TTS履歴・監査情報</summary>{artifacts.map(item => <p key={`${revision.planId}:${item.id}`}>{item.segmentId} · {jobStatusLabel(item.status)}{item.durationSeconds ? ` · ${item.durationSeconds}秒` : ''}{item.safeErrorCode ? ` · ${item.safeErrorCode}` : ''}</p>)}</details></div> })()}
      {isV2 && revision.planId && <section className="revenue-audio-readiness" aria-label="Composition timing preflight"><strong>Composition timing preflight</strong>{timingPreflight.scenes.map(scene => <div key={scene.id} className="revenue-composition-status"><span>{scene.label} {scene.ready ? `${scene.requiredSeconds.toFixed(2)}s / max ${scene.maximumSeconds.toFixed(2)}s` : `計測待ち / max ${scene.maximumSeconds.toFixed(2)}s`}</span><small>{!scene.ready ? 'ready音声の実測durationが必要です' : scene.fit ? 'fit' : `${scene.overflowSeconds.toFixed(2)}s overflow — TTS原稿を短縮してください`}</small></div>)}</section>}
      {revision.planId && <button disabled={busy || submitting || !composerConfig?.configured || (isV2 && (!revisionArtifacts.length || revisionArtifacts.some(item => item.status !== 'ready') || !timingPreflight.fit)) || revision.compositions?.some(item => ['queued', 'rendering'].includes(item.status))} onClick={() => compose(revision.planId)}>Shorts MP4を合成</button>}
      {compositionError && <p className="revenue-warning" role="alert">{compositionError}</p>}
      {isV2 && revision.planId && !textToSpeechConfig?.configured && <p className="revenue-warning">private launcherにElevenLabs model / voice / API key、FFprobe、専用audio bucketを設定してください。</p>}
      {!composerConfig?.configured && revision.planId && <p className="revenue-warning">{isV2 ? `MP4合成に必要なprivate storage・FFmpeg/FFprobe・描画fontを確認してください。未準備: ${(composerConfig?.missing || []).join(', ') || 'runtime設定'}` : 'private bucketsとFFmpeg/FFprobeのパスを設定すると合成できます。'}</p>}
      {revision.compositions?.map(composition => <div key={composition.id} className="revenue-composition-status"><span>{jobStatusLabel(composition.status)}</span>{composition.safeErrorCode && <small>Safe error: {composition.safeErrorCode}</small>}{composition.output && <><small>{composition.output.pixelWidth}×{composition.output.pixelHeight} · {composition.output.durationSeconds}秒</small><button onClick={() => preview(composition.output.id)}>Previewを開く</button></>}<details className="revenue-audit-details"><summary>履歴・監査情報</summary><small>provider: {composition.provider} {composition.providerVersion}<br />fingerprint: {composition.compositionFingerprint}{composition.output && <><br />SHA: {composition.output.contentSha256}<br />fps: {composition.output.fps}</>}</small></details></div>)}
      <details className="revenue-audit-details"><summary>制作案の履歴・監査情報</summary><p>Revision: {revision.revisionNumber}<br />Prompt: {revision.promptVersion}<br />Schema: {revision.schemaVersion}<br />Request: {revision.requestId}<br />Plan: {revision.planId || '未生成'}</p></details>
      {previewUrl && <video controls preload="metadata" src={previewUrl}>完成動画を再生できません。</video>}
    </details> })}
    {isV2 && revisionSelection.past.length > 0 && <details className="revenue-audit-details"><summary>過去の制作案・監査情報（{revisionSelection.past.length}件）</summary>{revisionSelection.past.map(revision => { const artifacts = audioArtifactsForPlan(revision); const counts = creativeAudioStatusCounts(artifacts); return <article key={`${revision.planId || 'no-plan'}:${revision.requestId}`}><strong>Revision {revision.revisionNumber} · {jobStatusLabel(revision.status)}</strong><p>artifact {artifacts.length}件 · ready {counts.ready} / planned {counts.planned} / failed {counts.failed}<br />Request: {revision.requestId}<br />Plan: {revision.planId || '未生成'}</p></article> })}</details>}
  </section>
}

function RevenueWorkspace({ state, requestedCampaignId, busy, onReload, onSelectCampaign, onGeneratePlan, onGenerateAudio, onCompose, onPreview, onCollectAnalytics }) {
  const [actionError, setActionError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const keyRef = useRef(newCampaignIdempotencyKey())
  const model = deriveWorkspace(state, requestedCampaignId)
  const { campaign, iteration, latestRevision: revision, primaryAction } = model
  const runPrimary = async () => {
    if (primaryAction.disabled) return
    setActionError('')
    try {
      if (primaryAction.id === 'generate-plan') await onGeneratePlan(iteration.id, keyRef.current)
      if (primaryAction.id === 'generate-audio') await onGenerateAudio(revision.planId, keyRef.current)
      if (primaryAction.id === 'compose') await onCompose(revision.planId, keyRef.current)
      if (primaryAction.id === 'preview') { const result = await onPreview(primaryAction.outputId); setPreviewUrl(result.previewUrl) }
      if (primaryAction.id === 'analytics') await onCollectAnalytics?.(model.publication.id)
      keyRef.current = newCampaignIdempotencyKey()
    } catch (failure) { setActionError(failure?.message || '操作を開始できませんでした。') }
  }
  const configReason = primaryAction.id === 'generate-plan' && !state.config.multiProductShortsV2?.configured ? '制作案生成の接続設定が必要です'
    : primaryAction.id === 'generate-audio' && !state.config.textToSpeech?.configured ? 'ナレーション生成の接続設定が必要です'
      : primaryAction.id === 'compose' && !state.config.finalCompositionV2?.configured ? 'MP4生成の接続設定が必要です'
        : primaryAction.id === 'analytics' && !onCollectAnalytics ? 'Analytics接続が必要です' : ''
  const actionDisabled = busy || primaryAction.disabled || Boolean(configReason)
  const actionReason = primaryAction.reason || configReason
  const artifacts = revision?.audioArtifacts || []
  const revisions = [...(iteration?.archetypePlans || [])].sort((a, b) => Number(b.revisionNumber || 0) - Number(a.revisionNumber || 0))
  const pastRevisions = revisions.filter(item => item !== revision)
  return <section className="revenue-workspace" aria-label="Revenue Lab workspace">
    <header className="revenue-workspace-header">
      <div className="revenue-workspace-title"><span>Revenue Lab</span><strong>{campaign?.name || 'Active Campaignなし'}</strong><small>{iteration ? `Iteration ${iteration.iterationNumber}` : 'Iteration —'} · {revision ? `Creative Revision ${revision.revisionNumber}` : 'Creative Revision —'}</small></div>
      <ol className="revenue-workspace-progress" aria-label="制作進捗">{model.steps.map(step => <li key={step.id} className={`${step.complete ? 'is-complete' : ''}${step.current ? ' is-current' : ''}`}><span>{step.complete ? '✓' : step.current ? '●' : '○'}</span>{step.label}</li>)}</ol>
      <div className="revenue-workspace-next"><small>次のアクション</small><strong>{model.nextAction}</strong></div>
      <div className="revenue-workspace-actions"><button className="corp-primary" type="button" disabled={actionDisabled} onClick={runPrimary}>{busy ? '処理中…' : primaryAction.label}</button><button type="button" onClick={onReload} disabled={busy}>Revenue Lab更新</button><ThreePicksGenerationFeedback feedback={model.planFeedback} />{actionReason && <p className="revenue-warning">{actionReason}</p>}{actionError && <p className="revenue-warning" role="alert">{actionError}</p>}</div>
    </header>
    {!!model.active.length && <label className="revenue-campaign-select">Campaign<select value={campaign?.id || ''} onChange={event => onSelectCampaign(event.target.value)}>{model.active.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {!campaign && <div className="revenue-state"><h3>Active Campaignがありません</h3><p>商品を登録してCampaignを作成してください。</p></div>}
    {campaign && <>
      <div className="revenue-workspace-steps">{model.steps.map((step, index) => <section key={step.id} className={`revenue-workspace-step${step.complete ? ' is-complete' : ''}${step.current ? ' is-current' : ''}`}><header><span>{index + 1}</span><h3>{step.label}</h3><small>{step.complete ? '完了' : step.current ? '作業中' : '未着手'}</small></header>{step.current && step.id === 'product' && <p>制作対象の商品を登録してください。</p>}{step.current && step.id === 'plan' && <p>商品情報からThree Picks v2の制作案を生成します。</p>}{step.current && step.id === 'audio' && <><p>最新Revisionの全原稿を確認してから音声を生成してください。{artifacts.length ? ` ${artifacts.filter(item => item.status === 'ready').length} / ${artifacts.length} ready` : ''}</p><ThreePicksScriptReview output={revision?.output} /><p className="revenue-product-facts">segment単体生成などのLive Validation操作は「商品候補・検証・監査ツール」に収納しています。</p></>}{step.current && step.id === 'video' && <div className="revenue-timing-summary">{model.timing.scenes.map(scene => <p key={scene.id}>{scene.label} {scene.ready ? `${scene.required.toFixed(2)}s / max ${scene.maximum.toFixed(2)}s` : `計測待ち / max ${scene.maximum.toFixed(2)}s`}</p>)}</div>}{step.current && step.id === 'publication' && <p>{model.publication ? '公開実績を更新してください。' : 'Previewを確認して公開情報を登録してください。'}</p>}</section>)}</div>
      {previewUrl && <video className="revenue-workspace-preview" controls preload="metadata" src={previewUrl}>完成動画を再生できません。</video>}
      <details className="revenue-audit-details revenue-workspace-audit"><summary>監査情報</summary>
        <p>Campaign: {campaign.id}<br />Iteration: {iteration?.id || '—'}<br />Revision: {revision?.revisionNumber || '—'}<br />Prompt: {revision?.promptVersion || '—'}<br />Schema: {revision?.schemaVersion || '—'}<br />Request: {revision?.requestId || '—'}<br />Plan: {revision?.planId || '—'}</p>
        {!!pastRevisions.length && <details><summary>過去Revision（{pastRevisions.length}件）</summary>{pastRevisions.map(item => <p key={item.planId || item.requestId}>Revision {item.revisionNumber} · {jobStatusLabel(item.status)}</p>)}</details>}
        {(campaign.iterations || []).filter(item => item.id !== iteration?.id).length > 0 && <details><summary>過去Iteration</summary>{campaign.iterations.filter(item => item.id !== iteration?.id).map(item => <p key={item.id}>Iteration {item.iterationNumber}</p>)}</details>}
      </details>
    </>}
    {model.legacy && <details className="revenue-legacy"><summary>Legacy・読取専用</summary><p>Three Picks v1は監査目的でのみ表示します。制作案・音声・MP4の操作はできません。</p></details>}
    {!!model.archive.length && <details className="revenue-archive"><summary>Archive（{model.archive.length}件）</summary>{model.archive.map(item => <article key={item.id}><strong>{item.name}</strong><small>{campaignStatusLabel(item.status)}</small></article>)}</details>}
  </section>
}

function OperatorProductionWorkspace({ state, requestedCampaignId, busy, onGeneratePlan, onGenerateAudio, onCompose, onPreview, onOpenPublication }) {
  const [actionError, setActionError] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const keyRef = useRef(newCampaignIdempotencyKey())
  const campaignId = preferredOperatorCampaignId(state, requestedCampaignId)
  const model = campaignId ? deriveWorkspace(state, campaignId) : { campaign: null, iteration: null, latestRevision: null, primaryAction: { id: 'none', label: '', disabled: true }, timing: { ready: false }, composition: null, planFeedback: null }
  const { campaign, iteration, latestRevision: revision, primaryAction } = model
  const runPrimary = async () => {
    if (primaryAction.disabled) return
    setActionError('')
    try {
      if (primaryAction.id === 'generate-plan') await onGeneratePlan(iteration.id, keyRef.current)
      if (primaryAction.id === 'generate-audio') await onGenerateAudio(revision.planId, keyRef.current)
      if (primaryAction.id === 'compose') await onCompose(revision.planId, keyRef.current)
      if (primaryAction.id === 'preview') { const result = await onPreview(primaryAction.outputId); setPreviewUrl(result.previewUrl) }
      keyRef.current = newCampaignIdempotencyKey()
    } catch (failure) { setActionError(failure?.message || '操作を開始できませんでした。') }
  }
  const configReason = primaryAction.id === 'generate-plan' && !state.config.multiProductShortsV2?.configured ? '制作案生成の接続設定が必要です'
    : primaryAction.id === 'generate-audio' && !state.config.textToSpeech?.configured ? 'ナレーション生成の接続設定が必要です'
      : primaryAction.id === 'compose' && !state.config.finalCompositionV2?.configured ? 'MP4生成の接続設定が必要です' : ''
  const actionDisabled = busy || primaryAction.disabled || Boolean(configReason)
  const actionReason = primaryAction.reason || configReason
  const audioReady = model.timing.ready
  const videoOutput = model.composition?.output || null
  return <section className="revenue-workspace revenue-operator-production" aria-label="Revenue Lab workspace">
    <div className="revenue-section-heading"><div><p className="revenue-kicker">PRODUCTION</p><h2>制作</h2><p>{campaign?.name || 'おすすめ3選 Shorts v2'}</p></div></div>
    {!campaign && <div className="revenue-state"><h3>制作対象がありません</h3><p>おすすめ3選 Shorts v2のCampaignを商品画面から作成してください。</p></div>}
    {campaign && <>
      <section className="revenue-production-artifact"><h3>原稿</h3>{revision?.output ? <ThreePicksScriptReview output={revision.output} /> : <p>原稿生成が必要です。</p>}{primaryAction.id === 'generate-plan' && <button className="corp-primary" type="button" disabled={actionDisabled} onClick={runPrimary}>{primaryAction.label}</button>}{model.planFeedback?.kind === 'error' && <ThreePicksGenerationFeedback feedback={model.planFeedback} />}</section>
      <section className="revenue-production-artifact"><h3>音声</h3><p className={`revenue-artifact-status ${audioReady ? 'is-ready' : 'is-attention'}`}>{audioReady ? '✓ 音声完成' : '音声生成が必要'}</p>{primaryAction.id === 'generate-audio' && <button className="corp-primary" type="button" disabled={actionDisabled} onClick={runPrimary}>{primaryAction.label}</button>}</section>
      <section className="revenue-production-artifact"><h3>動画</h3><p className={`revenue-artifact-status ${videoOutput ? 'is-ready' : 'is-attention'}`}>{videoOutput ? '✓ 動画完成' : '動画生成が必要'}</p>{videoOutput && <p>{videoOutput.durationSeconds == null ? '尺未取得' : `${videoOutput.durationSeconds}秒`}</p>}{primaryAction.id === 'compose' && <button className="corp-primary" type="button" disabled={actionDisabled} onClick={runPrimary}>{primaryAction.label}</button>}{videoOutput && <button type="button" onClick={runPrimary}>Previewを開く</button>}{actionReason && <p className="revenue-warning">{actionReason}</p>}</section>
      {previewUrl && <video className="revenue-workspace-preview" controls preload="metadata" src={previewUrl}>完成動画を再生できません。</video>}
      {videoOutput && <button className="corp-primary revenue-publish-next" type="button" onClick={onOpenPublication}>公開準備へ進む</button>}
      {actionError && <p className="revenue-warning" role="alert">{actionError}</p>}
    </>}
  </section>
}

const OPERATIONS_AREAS = [
  ['today', '今日やること'], ['products', '商品'], ['production', '制作'], ['publication', '公開・分析'],
]

function RevenueOperationsNav({ activeArea, onChange, busy, onReload, auditOpen, onToggleAudit }) {
  return <header className="revenue-operations-header">
    <div><p className="revenue-kicker">REVENUE LAB</p><h2>通常運用</h2><p>AIが進め、人の確認や判断が必要な仕事だけをここに集めます。</p></div>
    <div className="revenue-header-actions"><button type="button" onClick={onReload} disabled={busy}>更新</button><button type="button" aria-expanded={auditOpen} onClick={onToggleAudit}>設定・監査</button></div>
    <nav className="revenue-operations-nav" aria-label="Revenue Lab 通常運用">{OPERATIONS_AREAS.map(([id, label]) => <button key={id} type="button" className={activeArea === id ? 'is-active' : ''} aria-current={activeArea === id ? 'page' : undefined} onClick={() => onChange(id)}>{label}</button>)}</nav>
  </header>
}

function TodayOperations({ state, onOpenArea, onSelectCampaign }) {
  const items = deriveAttentionItems(state)
  return <section className="revenue-operations-area" aria-labelledby="revenue-today-heading">
    <div className="revenue-section-heading"><div><p className="revenue-kicker">HUMAN ATTENTION</p><h2 id="revenue-today-heading">今日やること</h2><p>確認や判断が必要な制作物だけを表示しています。</p></div><span>{items.length}件</span></div>
    {!items.length && <div className="revenue-state"><h3>今すぐ確認する項目はありません</h3><p>AIの処理が進むと、確認が必要な項目がここに届きます。</p></div>}
    <div className="revenue-attention-list">{items.map(item => <article key={item.id} className="revenue-attention-card">
      <div><strong>{item.status}</strong><h3>{item.campaignName}</h3></div>
      <p>{item.detail}</p>
      <button className="corp-primary" type="button" onClick={() => { onSelectCampaign(item.campaignId); onOpenArea(item.area) }}>{item.cta}</button>
    </article>)}</div>
  </section>
}

const PRODUCT_URL_TRACKING_PARAMS = new Set(['ref', 'tag', 'linkcode', 'creative', 'creativeasin', 'ascsubtag', 'camp', 'adid'])

function normalizedProductUrl(value) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || PRODUCT_URL_TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key)
    }
    parsed.searchParams.sort()
    const query = parsed.searchParams.toString()
    return `${host}${path}${query ? `?${query}` : ''}`
  } catch {
    return String(value).trim().toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '') || null
  }
}

function normalizedProductText(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s\u3000]+/g, ' ')
}

function hasRegisteredFacts(value) {
  if (value == null) return false
  if (typeof value !== 'object') return String(value).trim() !== ''
  return Object.values(value).some(entry => entry != null && (typeof entry === 'object' ? hasRegisteredFacts(entry) : String(entry).trim() !== ''))
}

function registeredProductRecords(campaigns) {
  return campaigns.flatMap(campaign => (campaign.iterations || []).flatMap(iteration => {
    const timestampFallback = iteration.updatedAt || iteration.createdAt || campaign.updatedAt || campaign.createdAt || null
    if (iteration.product) {
      const product = iteration.product
      return [{
        recordId: product.id || `${campaign.id}:${iteration.id}`, canonicalId: product.canonicalProductId || product.id || null,
        sourceId: product.sourceProductId || product.externalProductId || product.providerProductId || product.sku || null,
        sourceNamespace: product.provider || product.sourceKind || product.discoveryChannel || product.merchant || 'product',
        name: product.productName, merchant: product.merchant,
        productUrl: product.productUrl, destinationUrl: product.affiliateUrl || product.productUrl,
        assets: product.assets || [], facts: product.verifiedFacts || product.factsSnapshot,
        updatedAt: product.updatedAt || product.createdAt || product.humanVerifiedAt || timestampFallback,
        campaignName: campaign.name, iterationId: iteration.id,
      }]
    }
    return (iteration.productSet?.items || []).map(item => {
      const product = item.product || {}; const snapshot = item.productSnapshot || {}
      return {
        recordId: item.id || `${campaign.id}:${iteration.id}:${item.presentationOrder || 0}`,
        canonicalId: item.canonicalProductId || item.curatedProductId || item.productId || product.canonicalProductId || product.id || snapshot.canonicalProductId || snapshot.curatedProductId || snapshot.id || null,
        sourceId: item.sourceProductId || item.externalProductId || product.sourceProductId || product.externalProductId || product.providerProductId || snapshot.sourceProductId || snapshot.externalProductId || snapshot.providerProductId || snapshot.sku || null,
        sourceNamespace: item.provider || product.provider || product.sourceKind || snapshot.provider || snapshot.sourceKind || product.merchant || snapshot.merchant || 'product',
        name: item.productName || product.productName || snapshot.productName || snapshot.product_name,
        merchant: item.merchant || product.merchant || snapshot.merchant,
        productUrl: item.productUrl || product.productUrl || snapshot.productUrl || snapshot.product_url,
        destinationUrl: item.destination?.url || item.affiliateUrl || product.affiliateUrl || product.productUrl || snapshot.affiliateUrl || snapshot.affiliate_url || snapshot.productUrl || snapshot.product_url,
        assets: item.assetRevisions?.length ? item.assetRevisions : item.assetRevision ? [item.assetRevision] : product.assets || [],
        facts: item.verifiedFact || item.verifiedFacts || product.verifiedFacts || snapshot.verifiedFacts || snapshot.verified_facts,
        updatedAt: item.updatedAt || item.createdAt || iteration.productSet?.updatedAt || iteration.productSet?.createdAt || timestampFallback,
        campaignName: campaign.name, iterationId: iteration.id,
      }
    })
  }))
}

function representativeIsBetter(candidate, current) {
  const candidateRank = [Boolean(candidate.merchant), Boolean(candidate.destinationUrl), candidate.assets.length > 0, hasRegisteredFacts(candidate.facts)]
  const currentRank = [Boolean(current.merchant), Boolean(current.destinationUrl), current.assets.length > 0, hasRegisteredFacts(current.facts)]
  for (let index = 0; index < candidateRank.length; index += 1) if (candidateRank[index] !== currentRank[index]) return candidateRank[index]
  return Date.parse(candidate.updatedAt || 0) > Date.parse(current.updatedAt || 0)
}

export function groupRegisteredProducts(campaigns = []) {
  const groups = []; const aliases = new Map()
  for (const record of registeredProductRecords(campaigns)) {
    const strongAliases = []
    if (record.canonicalId) strongAliases.push(`canonical:${record.canonicalId}`)
    if (record.sourceId) strongAliases.push(`source:${normalizedProductText(record.sourceNamespace)}:${normalizedProductText(record.sourceId)}`)
    const commerceUrl = normalizedProductUrl(record.productUrl || record.destinationUrl)
    if (commerceUrl) strongAliases.push(`url:${commerceUrl}`)
    const title = normalizedProductText(record.name); const merchant = normalizedProductText(record.merchant)
    const recordAliases = strongAliases.length ? strongAliases : title && merchant ? [`title-merchant:${merchant}:${title}`] : [`record:${record.recordId}`]
    let group = recordAliases.map(alias => aliases.get(alias)).find(Boolean)
    if (!group) { group = { records: [], representative: record }; groups.push(group) }
    group.records.push(record)
    if (representativeIsBetter(record, group.representative)) group.representative = record
    for (const alias of recordAliases) aliases.set(alias, group)
  }
  return groups.map(group => {
    const representative = group.representative
    return {
      id: representative.canonicalId || representative.recordId, name: representative.name,
      merchant: representative.merchant, url: representative.destinationUrl || representative.productUrl,
      relatedRecordCount: group.records.length, records: group.records,
    }
  })
}

function RegisteredProducts({ campaigns = [] }) {
  const products = groupRegisteredProducts(campaigns)
  return <section className="revenue-registered-products"><div className="revenue-section-heading"><div><p className="revenue-kicker">REGISTERED</p><h2>登録済み商品</h2></div><span>{products.length}件</span></div>
    {!products.length && <div className="revenue-state"><h3>登録済み商品はありません</h3><p>商品登録から制作対象を追加してください。</p></div>}
    <div className="revenue-registered-grid">{products.map((product, index) => <article key={`${product.id}:${index}`}><strong>{product.name || '商品名未設定'}</strong><small>{product.merchant || 'merchant未設定'}</small><span className="revenue-related-record-count">関連レコード {product.relatedRecordCount}件</span>{product.url && <a href={product.url} target="_blank" rel="noopener noreferrer">商品ページ</a>}<details><summary>詳細を見る</summary><ul>{product.records.map(record => <li key={`${record.recordId}:${record.iterationId}`}><strong>{record.name || '商品名未設定'}</strong><small>Record ID: {record.recordId}</small><small>{record.merchant || 'merchant未設定'} · {record.assets.length ? 'Product Assetあり' : 'Product Assetなし'} · {hasRegisteredFacts(record.facts) ? 'verified factsあり' : 'verified factsなし'}</small>{record.destinationUrl && <a href={record.destinationUrl} target="_blank" rel="noopener noreferrer">関連商品ページ</a>}</li>)}</ul></details></article>)}</div>
  </section>
}

function PublicationOperations({ state, requestedCampaignId, busy, onSelectCampaign, onPreview, onRegisterPublication, onCollectAnalytics }) {
  const [previewUrl, setPreviewUrl] = useState('')
  const model = deriveWorkspace(state, requestedCampaignId)
  const { campaign, iteration, latestRevision: revision, composition, publication } = model
  const fields = revision?.output?.soft_copy_fields || []
  const scriptConfirmed = fields.length > 0 && fields.every(field => field.reviewed === true || ['confirmed', 'reviewed'].includes(field.review_status))
  const productItems = iteration?.productSet?.items || []
  const linksReady = iteration?.product ? Boolean(iteration.product.affiliateUrl || iteration.product.productUrl) : productItems.length > 0 && productItems.every(item => item.affiliateUrl || item.productUrl)
  const openPreview = async () => { if (!composition?.output?.id) return; const result = await onPreview(composition.output.id); setPreviewUrl(result.previewUrl) }
  return <section className="revenue-operations-area" aria-labelledby="revenue-publication-heading">
    <div className="revenue-section-heading"><div><p className="revenue-kicker">PUBLISH & LEARN</p><h2 id="revenue-publication-heading">公開・分析</h2><p>完成動画から公開登録、公開後実績までを一か所で確認します。</p></div></div>
    {!!model.active.length && <label className="revenue-campaign-select">Campaign<select value={campaign?.id || ''} onChange={event => onSelectCampaign(event.target.value)}>{model.active.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    {!campaign && <div className="revenue-state"><h3>公開対象がありません</h3><p>制作から動画を完成させてください。</p></div>}
    {campaign && <><div className="revenue-publication-readiness">
      <article className={composition ? 'is-ready' : ''}><span>{composition ? '✓' : '○'}</span><strong>動画完成</strong></article>
      <article className={scriptConfirmed ? 'is-ready' : 'is-attention'}><span>{scriptConfirmed ? '✓' : '!'}</span><strong>原稿確認{scriptConfirmed ? '済み' : 'が必要'}</strong></article>
      <article className={linksReady ? 'is-ready' : 'is-attention'}><span>{linksReady ? '✓' : '!'}</span><strong>商品リンク{linksReady ? '登録済み' : '未登録'}</strong></article>
      <article className={publication ? 'is-ready' : 'is-attention'}><span>{publication ? '✓' : '○'}</span><strong>{publication ? 'YouTube投稿済み' : 'YouTube未投稿'}</strong></article>
    </div>
    {composition?.output && <section className="revenue-publish-video"><div><h3>完成動画</h3><p>{campaign.name} · Revision {revision?.revisionNumber || '—'}</p></div><button type="button" onClick={openPreview}>Previewを開く</button></section>}
    {previewUrl && <video className="revenue-workspace-preview" controls preload="metadata" src={previewUrl}>完成動画を再生できません。</video>}
    {!publication && iteration && composition && <section className="revenue-publication-registration"><h3>Publication登録</h3><PublicationRegistrationForm iterationId={iteration.id} busy={busy} onRegister={onRegisterPublication} /></section>}
    {publication && <><div className="revenue-publication"><span>{publication.publicationTitle || '公開タイトル未設定'}</span><a href={publication.canonicalUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(publication.youtubeVideoId)}`} target="_blank" rel="noopener noreferrer">公開動画を開く</a></div><PublicationAnalyticsForm publication={publication} connection={state.youtubeAnalyticsConnection} busy={busy} onCollect={onCollectAnalytics} /><PerformanceSnapshot snapshot={publication.latestPerformance} /></>}
    </>}
  </section>
}

function OperatorPublicationOperations({ state, requestedCampaignId, busy, onPreview, onRegisterPublication, onCollectAnalytics, onOpenArea }) {
  const [previewUrl, setPreviewUrl] = useState('')
  const [showRegistration, setShowRegistration] = useState(false)
  const campaignId = preferredOperatorCampaignId(state, requestedCampaignId)
  const model = campaignId ? deriveWorkspace(state, campaignId) : { campaign: null, iteration: null, latestRevision: null, composition: null, publication: null }
  const { campaign, iteration, latestRevision: revision, composition, publication } = model
  const fields = revision?.output?.soft_copy_fields || []
  const scriptConfirmed = fields.length > 0 && fields.every(field => field.reviewed === true || ['confirmed', 'reviewed'].includes(field.review_status))
  const productItems = iteration?.product ? [iteration.product] : iteration?.productSet?.items || []
  const linksReady = productItems.length > 0 && productItems.every(item => item.affiliateUrl || item.productUrl)
  const openPreview = async () => { if (!composition?.output?.id) return; const result = await onPreview(composition.output.id); setPreviewUrl(result.previewUrl) }
  const output = revision?.output || {}
  const publicationTitle = publication?.publicationTitle || output.youtube_title || campaign?.name || '未設定'
  const description = output.youtube_description || output.description || output.cta?.display_text || '未設定'
  const disclosure = output.amazon_associate_disclosure || '未設定'
  return <section className="revenue-operations-area" aria-labelledby="revenue-publication-heading">
    <div className="revenue-section-heading"><div><p className="revenue-kicker">PUBLISH & LEARN</p><h2 id="revenue-publication-heading">公開・分析</h2><p>{campaign?.name || 'おすすめ3選 Shorts v2'}</p></div></div>
    {!campaign && <div className="revenue-state"><h3>公開対象がありません</h3><p>制作から動画を完成させてください。</p></div>}
    {campaign && <>
      <div className="revenue-publication-readiness">
        <article className={composition ? 'is-ready' : 'is-attention'}><span>{composition ? '✓' : '!'}</span><div><strong>{composition ? '動画完成' : '動画が未完成'}</strong>{!composition && <button type="button" onClick={() => onOpenArea('production')}>制作を確認</button>}</div></article>
        <article className={scriptConfirmed ? 'is-ready' : 'is-attention'}><span>{scriptConfirmed ? '✓' : '!'}</span><div><strong>{scriptConfirmed ? '原稿確認済み' : '原稿確認が必要'}</strong>{!scriptConfirmed && <button type="button" onClick={() => onOpenArea('production')}>原稿を確認</button>}</div></article>
        <article className={linksReady ? 'is-ready' : 'is-attention'}><span>{linksReady ? '✓' : '!'}</span><div><strong>{linksReady ? '商品リンク登録済み' : '商品リンク未登録'}</strong>{!linksReady && <button type="button" onClick={() => onOpenArea('products')}>商品リンクを登録</button>}</div></article>
        <article className={publication ? 'is-ready' : ''}><span>{publication ? '✓' : '○'}</span><div><strong>{publication ? 'YouTube投稿済み' : 'YouTube未投稿'}</strong>{!publication && <a href="#revenue-publish-copy">投稿内容を確認</a>}</div></article>
      </div>
      <section id="revenue-publish-copy" className="revenue-publish-copy"><h3>投稿内容</h3><dl><div><dt>公開タイトル</dt><dd>{publicationTitle}</dd></div><div><dt>概要欄</dt><dd>{description}</dd></div><div><dt>Amazonアソシエイト開示文</dt><dd>{disclosure}</dd></div><div><dt>商品リンク</dt><dd>{productItems.length ? productItems.map(item => <span key={item.id || item.productName}>{item.productName || item.displayName || '商品'}: {item.affiliateUrl || item.productUrl || '未登録'}</span>) : '未登録'}</dd></div></dl></section>
      {composition?.output && <section className="revenue-publish-video"><div><h3>動画Preview</h3><p>{composition.output.durationSeconds == null ? '尺未取得' : `${composition.output.durationSeconds}秒`}</p></div><button type="button" onClick={openPreview}>Previewを開く</button></section>}
      {previewUrl && <video className="revenue-workspace-preview" controls preload="metadata" src={previewUrl}>完成動画を再生できません。</video>}
      {!publication && iteration && composition && !showRegistration && <button className="revenue-publication-entry" type="button" onClick={() => setShowRegistration(true)}>YouTube投稿済み・Video IDを入力</button>}
      {!publication && iteration && composition && showRegistration && <section className="revenue-publication-registration"><PublicationRegistrationForm iterationId={iteration.id} busy={busy} onRegister={onRegisterPublication} /></section>}
      {publication && <><div className="revenue-publication"><span>{publication.publicationTitle || '公開タイトル未設定'}</span><a href={publication.canonicalUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(publication.youtubeVideoId)}`} target="_blank" rel="noopener noreferrer">公開動画を開く</a></div><PublicationAnalyticsForm publication={publication} connection={state.youtubeAnalyticsConnection} busy={busy} onCollect={onCollectAnalytics} /><PerformanceSnapshot snapshot={publication.latestPerformance} /></>}
    </>}
  </section>
}

function CampaignBoard({ campaigns = [], analyticsConnection, creativeProductionConfig, videoGenerationConfig, imageToVideoConfig, productAssetRevisionConfig, multiProductConfig, multiProductV2Config, textToSpeechConfig, composerConfig, composerV2Config, busy, onCreateThreePicks, onGenerateThreePicks, onGenerateThreePicksV2, onGenerateAudio, onGenerateAudioArtifact, onCompose, onComposeV2, onPreview, onGenerateProduction, onGenerateVideo, onCreateAssetRevision, onGenerateImageVideo, onRegisterPublication, onCollectAnalytics, onUpdateIteration, onCreateIteration, onDeleteCampaign, onVoidCampaign }) {
  const visible = campaigns.filter(campaign => campaign.status !== 'voided')
  const voided = campaigns.filter(campaign => campaign.status === 'voided')
  const campaignCard = campaign => <article key={campaign.id} className={`revenue-campaign${campaign.status === 'voided' ? ' is-voided' : ''}`}>
    <header><div><h3>{campaign.name}</h3><p>{campaign.objective || '目的メモなし'}</p></div><span className={`revenue-status is-${campaign.status}`}>{campaignStatusLabel(campaign.status)}</span></header>
    {campaign.status === 'voided' && <p className="revenue-warning">無効理由: {({ duplicate: '重複', mistake: '誤登録', test: 'テスト', other: 'その他' })[campaign.voidReason] || campaign.voidReason}{campaign.voidNote ? ` — ${campaign.voidNote}` : ''}</p>}
    <div className="revenue-origin-list">{campaign.lineageKind === 'direct_product' && <span>Direct Product · Opportunity/AI Analysisなし</span>}{campaign.origins?.map(origin => <span key={origin.id}>{origin.contextKind === 'tracking' ? '継続観測' : '発掘'} · Rank #{origin.rankPosition ?? '—'} · {origin.scoreVersion || '—'}</span>)}</div>
    {campaign.iterations?.map(iteration => <section key={iteration.id} className="revenue-iteration">
      <div className="revenue-product-heading"><strong>Iteration #{iteration.iterationNumber}</strong><span>{iterationStatusLabel(iteration.status)}</span></div>
      {iteration.product && <div className="revenue-selected-product"><div><b>{iteration.product.productName}{iteration.product.isOwnProduct ? ' · 自社商品' : ''}</b><small>{iteration.product.merchant || '販売元未入力'} · {iteration.product.productCategory || iteration.product.discoveryChannel}{iteration.product.searchKeyword ? ` · 検索語「${iteration.product.searchKeyword}」` : ''}</small>{iteration.product.translationOrigin && <small>Commerce lineage: AI「{iteration.product.translationOrigin.originalAiKeyword}」{iteration.product.translationOrigin.humanOverrideKeyword ? ` → 人間修正「${iteration.product.translationOrigin.humanOverrideKeyword}」` : ' → AI ready/人間承認'} → 選定商品</small>}{campaign.lineageKind === 'direct_product' && <small>商品事実: 人間確認済みDirect Product · Creative仮説とは分離</small>}</div><a href={iteration.product.affiliateUrl || iteration.product.productUrl} target="_blank" rel="noopener noreferrer">商品を確認</a></div>}
      {campaign.lineageKind === 'direct_product' && iteration.product && <details className="revenue-product-fact-detail"><summary>商品事実と正本素材</summary><p>{iteration.product.verifiedFacts?.summary || '確認済み事実なし'}</p>{iteration.product.cautions && <p><strong>注意:</strong> {iteration.product.cautions}</p>}<ul>{iteration.product.assets?.map(asset => <li key={asset.id}><a href={asset.assetUrl} target="_blank" rel="noopener noreferrer">{asset.label || `素材 ${asset.ordinal}`}</a> · {asset.assetKind} · {asset.assetSource} · {asset.usagePermission}{asset.creativeEligible ? '（利用条件記録済み）' : '（自動制作には使用不可）'}</li>)}</ul></details>}
      {!iteration.registrationOnly && <dl><div><dt>訴求仮説</dt><dd>{iteration.appealHypothesis}</dd></div><div><dt>Hook</dt><dd>{iteration.hookText}</dd></div><div><dt>台本・構成</dt><dd className="revenue-prewrap">{iteration.contentOutline?.text || '—'}</dd></div>{iteration.scriptText && <div><dt>台本本文</dt><dd className="revenue-prewrap">{iteration.scriptText}</dd></div>}</dl>}
      {iteration.registrationOnly && <p className="revenue-product-facts">商品登録が完了しています。CreativeはThree Picks制作案で生成します。</p>}
      {!iteration.registrationOnly && campaign.status !== 'voided' && iteration.status === 'draft' && !iteration.publication && <IterationCreativeForm campaignId={campaign.id} iteration={iteration} busy={busy} onUpdate={onUpdateIteration} onCreate={onCreateIteration} />}
      {!iteration.registrationOnly && campaign.status !== 'voided' && (iteration.status !== 'draft' || iteration.publication) && <IterationCreativeForm campaignId={campaign.id} iteration={iteration} busy={busy} createNew onUpdate={onUpdateIteration} onCreate={onCreateIteration} />}
      {!iteration.registrationOnly && campaign.status !== 'voided' && iteration.product && <CreativeProductionPanel iteration={iteration} config={creativeProductionConfig} videoGenerationConfig={videoGenerationConfig} imageToVideoConfig={imageToVideoConfig} busy={busy} onGenerate={onGenerateProduction} onGenerateVideo={onGenerateVideo} onCreateAssetRevision={onCreateAssetRevision} onGenerateImageVideo={onGenerateImageVideo} />}
      {campaign.status !== 'voided' && iteration.productSet && <>
        <div className="revenue-three-picks-lineage">{iteration.productSet.items.map(item => <span key={item.id}>PICK {item.presentationOrder} · {item.productName}{iteration.productSet.archetype === 'three_picks_v2' ? ` · ${item.assetRevisions?.length || 1}素材` : ''}</span>)}</div>
        <details className="revenue-audit-details"><summary>Product Setの履歴・監査情報</summary>{iteration.productSet.items.map(item => <p key={item.id}>PICK {item.presentationOrder} · Asset Revision #{item.assetRevision?.revisionNumber} · {item.assetRevision?.contentSha256 || 'SHA未取得'}</p>)}</details>
        {iteration.productSet.archetype === 'three_picks_v1'
          ? <details className="revenue-legacy"><summary>Legacy・読取専用</summary><p>Three Picks v1の制作案・音声・MP4操作は無効です。</p></details>
          : <ThreePicksPanel iteration={iteration} plannerConfig={multiProductV2Config} textToSpeechConfig={textToSpeechConfig} composerConfig={composerV2Config} busy={busy} onGeneratePlan={onGenerateThreePicksV2} onGenerateAudio={onGenerateAudio} onGenerateAudioArtifact={onGenerateAudioArtifact} onCompose={onComposeV2} onPreview={onPreview} />}
      </>}
      {iteration.publication && <><div className="revenue-publication"><span>YouTube Video ID: {iteration.publication.youtubeVideoId}</span><a href={iteration.publication.canonicalUrl || `https://www.youtube.com/watch?v=${encodeURIComponent(iteration.publication.youtubeVideoId)}`} target="_blank" rel="noopener noreferrer">公開動画を開く</a></div><PublicationAnalyticsForm publication={iteration.publication} connection={analyticsConnection} busy={busy} onCollect={onCollectAnalytics} /><PerformanceSnapshot snapshot={iteration.publication.latestPerformance} /></>}
      {!iteration.registrationOnly && campaign.status !== 'voided' && !iteration.publication && <PublicationRegistrationForm iterationId={iteration.id} busy={busy} onRegister={onRegisterPublication} />}
      <details><summary>監査情報</summary><p>Campaign: {campaign.id}<br />Iteration: {iteration.id}<br />Lineage: {campaign.lineageKind || 'opportunity'}<br />Treatment fingerprint: {iteration.treatmentFingerprint || '—'}<br />AI Analysis: {iteration.sourceAnalysisId || campaign.primaryAnalysisId || (campaign.lineageKind === 'direct_product' ? '対象外（Direct Product）' : '—')}</p></details>
    </section>)}
    {campaign.status !== 'voided' && <CampaignDisposition campaign={campaign} busy={busy} onDelete={onDeleteCampaign} onVoid={onVoidCampaign} />}
  </article>
  return <section className="revenue-campaign-board" aria-labelledby="campaign-board-heading">
    <ThreePicksIntake campaigns={campaigns} busy={busy} assetRevisionConfig={productAssetRevisionConfig} onCreate={onCreateThreePicks} onCreateAssetRevision={onCreateAssetRevision} />
    <div className="revenue-section-heading"><div><p className="revenue-kicker">STEP 3–4 · MP4 → 公開・分析</p><h2 id="campaign-board-heading">制作・公開</h2><p>制作案からMP4を作り、公開後の実績まで一続きで確認します。Campaign実験台帳は履歴として維持されます。</p></div><span>{visible.length}件</span></div>
    {!campaigns.length && <div className="revenue-state"><h3>Campaignはまだありません</h3><p>AI分析カードから人間が商品を確認し、最初のIterationを登録してください。</p></div>}
    <div className="revenue-campaign-list">{visible.map(campaignCard)}</div>
    {!!voided.length && <details className="revenue-voided-campaigns"><summary>無効化したCampaign（{voided.length}件）</summary><div className="revenue-campaign-list">{voided.map(campaignCard)}</div></details>}
  </section>
}

export function RevenueLabView({ state, error, busy, requestedCampaignId, initialArea = 'today', onSelectCampaign = () => {}, onReload, onRun, onTrack, onAnalyze, onReview, onProductSearch, onProductDecision, onCreateCampaign, onCreateDirectProduct, onCreateThreePicks, onGenerateThreePicks, onGenerateThreePicksV2, onGenerateAudio, onGenerateAudioArtifact, onCompose, onComposeV2, onPreview, onGenerateProduction, onGenerateVideo, onCreateAssetRevision, onGenerateImageVideo, onRegisterPublication, onUpdateIteration, onCreateIteration, onDeleteCampaign, onVoidCampaign, onConnectAnalytics, onCollectAnalytics, onSave }) {
  const [activeArea, setActiveArea] = useState(() => OPERATIONS_AREAS.some(([id]) => id === initialArea) ? initialArea : 'today')
  const [auditOpen, setAuditOpen] = useState(false)
  if (!state) return <main className="revenue-shell" aria-busy="true"><div className="revenue-state"><h2>Revenue Lab</h2><p>収益機会を読み込んでいます…</p></div></main>
  const eligible = state.queries.filter(query => query.enabled && !queryNeedsScores(query))
  const enabledQueries = state.queries.filter(query => query.enabled)
  const lookbackDays = [...new Set(enabledQueries.map(query => query.lookbackDays).filter(Boolean))]
  const latestRun = state.latestRun
  const scoreVersion = state.opportunities[0]?.scoreVersion || 'youtube-v1'
  const analysisByItem = new Map((state.analyses || []).map(analysis => [analysis.sourceItemId, analysis]))
  const productSearchByAnalysis = new Map((state.productSearches || []).map(search => [search.analysisId, search]))
  return <main className="revenue-shell">
    <RevenueOperationsNav activeArea={activeArea} onChange={setActiveArea} busy={busy} onReload={onReload} auditOpen={auditOpen} onToggleAudit={() => setAuditOpen(value => !value)} />
    {error && <div className="revenue-alert" role="alert">{error}</div>}
    <div hidden={activeArea !== 'today'}><TodayOperations state={state} onOpenArea={setActiveArea} onSelectCampaign={onSelectCampaign} /></div>
    <section hidden={activeArea !== 'products'} className="revenue-operations-area" aria-labelledby="revenue-products-heading">
      <section className="revenue-hero"><div><p className="revenue-kicker">PRODUCT OPERATIONS</p><h2 id="revenue-products-heading">商品</h2><p>新着、継続上昇、登録済み商品、Three Picks候補をまとめて確認します。</p></div><div className="revenue-actions"><button onClick={onTrack} disabled={busy}>継続上昇を更新</button><button className="corp-primary" onClick={() => onRun(eligible)} disabled={busy || eligible.length === 0}>今日の新着を更新</button></div></section>
      {!state.config.configured && <section className="revenue-state revenue-config"><h3>商品候補の取得準備が必要です</h3><p>接続の詳細は設定・監査で確認できます。</p></section>}
      <section className="revenue-analyst-intro"><div><p className="revenue-kicker">PRODUCT REVIEW</p><h2>商品分析</h2><p>候補の商品化仮説と次の行動を確認します。</p></div><button className="corp-primary" disabled={busy || !state.config.analysis?.configured || (!state.opportunities.length && !state.trackingOpportunities.length)} onClick={onAnalyze}>候補をAI分析</button></section>
      <DirectProductIntake busy={busy} onCreate={onCreateDirectProduct} />
      <OpportunitySection title="今日の新着" description="本日の発掘から確認する候補です。" items={state.opportunities || []} configured={state.config.configured} analysisByItem={analysisByItem} productSearchByAnalysis={productSearchByAnalysis} productConfig={state.config.products} busy={busy} onReview={onReview} onProductSearch={onProductSearch} onProductDecision={onProductDecision} onCreateCampaign={onCreateCampaign} />
      <OpportunitySection title="継続上昇" description="登録後も伸びている候補です。" items={state.trackingOpportunities || []} tracking configured={state.config.configured} analysisByItem={analysisByItem} productSearchByAnalysis={productSearchByAnalysis} productConfig={state.config.products} busy={busy} onReview={onReview} onProductSearch={onProductSearch} onProductDecision={onProductDecision} onCreateCampaign={onCreateCampaign} />
      <RegisteredProducts campaigns={state.campaigns || []} />
      <section><div className="revenue-section-heading"><div><p className="revenue-kicker">THREE PICKS</p><h2>Three Picks候補・選択</h2></div></div><ThreePicksIntake campaigns={state.campaigns || []} busy={busy} assetRevisionConfig={state.config.productAssetRevisions} onCreate={onCreateThreePicks} onCreateAssetRevision={onCreateAssetRevision} /></section>
    </section>
    <div hidden={activeArea !== 'production'}><OperatorProductionWorkspace state={state} requestedCampaignId={requestedCampaignId} busy={busy} onGeneratePlan={onGenerateThreePicksV2} onGenerateAudio={onGenerateAudio} onCompose={onComposeV2} onPreview={onPreview} onOpenPublication={() => setActiveArea('publication')} /></div>
    <div hidden={activeArea !== 'publication'}><OperatorPublicationOperations state={state} requestedCampaignId={requestedCampaignId} busy={busy} onPreview={onPreview} onRegisterPublication={onRegisterPublication} onCollectAnalytics={onCollectAnalytics} onOpenArea={setActiveArea} /></div>
    <aside className="revenue-audit-drawer" hidden={!auditOpen} aria-label="設定・監査"><div className="revenue-advanced-tools-body">
    {!state.config.configured && <section className="revenue-state revenue-config"><h3>接続設定が必要です</h3><p>サーバー側の環境変数を設定してください。</p><code>{state.config.missing.join(', ')}</code></section>}
    <nav className="revenue-production-flow" aria-label="旧制作フロー"><strong>商品 → Three Picks制作 → MP4 → 公開・分析</strong></nav>
    <section className="revenue-research-summary" aria-labelledby="revenue-research-heading"><div className="revenue-section-heading"><div><p className="revenue-kicker">AUDIT</p><h2 id="revenue-research-heading">収集・スコア監査</h2></div></div><dl>
      <div className="revenue-summary-wide"><dt>検索テーマ</dt><dd>{enabledQueries.map(query => query.queryText).join(' / ') || '—'}</dd></div><div><dt>最終収集日時（JST）</dt><dd>{publishedLabel(latestRun?.capturedAt)}</dd></div><div><dt>対象期間</dt><dd>{lookbackDays.length ? lookbackDays.map(days => `直近${days}日`).join(' / ') : '—'}</dd></div><div><dt>取得動画数</dt><dd>{metricCount(latestRun?.receivedCount)}</dd></div><div><dt>Score対象動画数</dt><dd>{metricCount(latestRun?.scoredCount)}</dd></div><div><dt>score_version</dt><dd>{scoreVersion}</dd></div><div><dt>最新job状態</dt><dd><span className={`revenue-status is-${state.latestJob?.status || 'unknown'}`}>{jobStatusLabel(state.latestJob?.status)}</span></dd></div><div className="revenue-summary-wide"><dt>次回予定収集時刻</dt><dd>{nextCollectionLabel()}</dd></div>
    </dl></section>
    <CampaignBoard campaigns={state.campaigns || []} analyticsConnection={state.youtubeAnalyticsConnection} creativeProductionConfig={state.config.creativeProduction} videoGenerationConfig={state.config.videoGeneration} imageToVideoConfig={state.config.imageToVideo} productAssetRevisionConfig={state.config.productAssetRevisions} multiProductConfig={state.config.multiProductShorts} multiProductV2Config={state.config.multiProductShortsV2} textToSpeechConfig={state.config.textToSpeech} composerConfig={state.config.finalComposition} composerV2Config={state.config.finalCompositionV2} busy={busy} onCreateThreePicks={onCreateThreePicks} onGenerateThreePicks={onGenerateThreePicks} onGenerateThreePicksV2={onGenerateThreePicksV2} onGenerateAudio={onGenerateAudio} onGenerateAudioArtifact={onGenerateAudioArtifact} onCompose={onCompose} onComposeV2={onComposeV2} onPreview={onPreview} onGenerateProduction={onGenerateProduction} onGenerateVideo={onGenerateVideo} onCreateAssetRevision={onCreateAssetRevision} onGenerateImageVideo={onGenerateImageVideo} onRegisterPublication={onRegisterPublication} onCollectAnalytics={onCollectAnalytics} onUpdateIteration={onUpdateIteration} onCreateIteration={onCreateIteration} onDeleteCampaign={onDeleteCampaign} onVoidCampaign={onVoidCampaign} />
    <AnalyticsConnectionPanel config={state.config.youtubeAnalytics} connection={state.youtubeAnalyticsConnection} flow={state.youtubeAnalyticsFlow} busy={busy} onConnect={onConnectAnalytics} />
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
    </div></aside>
  </main>
}

export default function RevenueLabDashboard() {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reloadSequenceRef = useRef(null)
  if (!reloadSequenceRef.current) reloadSequenceRef.current = createLatestRequestSequence()
  const [requestedCampaignId, setRequestedCampaignId] = useState(() => typeof window === 'undefined' ? null : campaignFromLocation(window.location))
  const reload = useCallback(async () => {
    const requestId = reloadSequenceRef.current.begin()
    setError('')
    try {
      const nextState = await loadRevenueDashboard()
      if (reloadSequenceRef.current.isLatest(requestId)) setState(nextState)
    } catch (failure) {
      if (reloadSequenceRef.current.isLatest(requestId)) { setState(previous => previous || EMPTY); setError(failure.message) }
    }
  }, [])
  useEffect(() => { reload() }, [])
  useEffect(() => {
    const restoreCampaign = () => setRequestedCampaignId(campaignFromLocation(window.location))
    window.addEventListener('popstate', restoreCampaign)
    return () => window.removeEventListener('popstate', restoreCampaign)
  }, [])
  useEffect(() => {
    if (!state || typeof window === 'undefined') return
    const model = deriveWorkspace(state, requestedCampaignId)
    if (!model.campaign || !model.normalized) return
    window.history.replaceState({}, '', buildWorkspaceUrl(window.location, 'revenue', model.campaign.id))
    setRequestedCampaignId(model.campaign.id)
  }, [state, requestedCampaignId])
  useEffect(() => {
    if (!state || typeof window === 'undefined') return undefined
    return installRevenueRefreshLifecycle({ windowRef: window, documentRef: document, refresh: reload, shouldPoll: () => shouldPollRevenueLab(state) })
  }, [reload, state])
  const selectCampaign = campaignId => {
    if (typeof window !== 'undefined') window.history.pushState({}, '', buildWorkspaceUrl(window.location, 'revenue', campaignId))
    setRequestedCampaignId(campaignId)
  }
  const perform = async action => {
    setBusy(true); setError('')
    try { const result = await action(); await reload(); return result }
    catch (failure) { setError(failure.message); throw failure }
    finally { setBusy(false) }
  }
  const review = (analysis, decision) => perform(() => createRevenueAnalysisReview(
    analysis.id, decision, decision === analysis.output?.recommendation ? 'agree' : 'disagree',
  )).catch(() => {})
  return <RevenueLabView state={state} error={error} busy={busy} requestedCampaignId={requestedCampaignId} onSelectCampaign={selectCampaign} onReload={reload} onRun={queries => { perform(() => enqueueEnabledRevenueQueries(queries)).catch(() => {}) }} onTrack={() => { perform(enqueueRevenueTracking).catch(() => {}) }} onAnalyze={() => { perform(() => enqueueRevenueAnalysis(1)).catch(() => {}) }} onReview={review} onProductSearch={analysisId => { perform(() => enqueueProductSearch(analysisId)).catch(() => {}) }} onProductDecision={(candidateId, analysisId, decision) => { perform(() => createProductCandidateDecision(candidateId, analysisId, decision)).catch(() => {}) }} onCreateCampaign={(analysisId, input) => perform(() => createManualCampaignRequest(analysisId, input))} onCreateDirectProduct={input => perform(() => createDirectProductCampaignRequest(input))} onCreateThreePicks={input => perform(() => createThreePicksCampaignRequest(input))} onGenerateThreePicks={(iterationId, idempotencyKey) => perform(() => enqueueThreePicksPlan(iterationId, idempotencyKey))} onGenerateThreePicksV2={(iterationId, idempotencyKey) => perform(() => enqueueThreePicksV2Plan(iterationId, idempotencyKey))} onGenerateAudio={(planId, idempotencyKey) => perform(() => enqueueCreativeAudioGeneration(planId, idempotencyKey))} onGenerateAudioArtifact={(artifactId, idempotencyKey) => perform(() => enqueueCreativeAudioArtifactGeneration(artifactId, idempotencyKey))} onCompose={(planId, idempotencyKey) => perform(() => enqueueFinalComposition(planId, idempotencyKey))} onComposeV2={(planId, idempotencyKey) => perform(() => enqueueFinalCompositionV2(planId, idempotencyKey))} onPreview={outputId => loadFinalCompositionPreview(outputId)} onGenerateProduction={(iterationId, idempotencyKey) => perform(() => enqueueCreativeProductionPlan(iterationId, idempotencyKey))} onGenerateVideo={(planId, sceneNumber, idempotencyKey, regenerate) => perform(() => enqueueVideoGeneration(planId, sceneNumber, idempotencyKey, regenerate))} onCreateAssetRevision={(assetId, i2vAllowed, createNineSixteen) => perform(() => createProductAssetRevision(assetId, i2vAllowed, createNineSixteen))} onGenerateImageVideo={(planId, sceneNumber, revisionId, idempotencyKey, regenerate) => perform(() => enqueueImageVideoGeneration(planId, sceneNumber, revisionId, idempotencyKey, regenerate))} onRegisterPublication={(iterationId, input) => { perform(() => registerCampaignPublication(iterationId, input)).catch(() => {}) }} onUpdateIteration={(iterationId, input) => { perform(() => updateDraftCampaignIteration(iterationId, input)).catch(() => {}) }} onCreateIteration={(campaignId, sourceIterationId, input) => { perform(() => createCampaignIteration(campaignId, sourceIterationId, input)).catch(() => {}) }} onDeleteCampaign={campaignId => { perform(() => hardDeleteDraftCampaign(campaignId)).catch(() => {}) }} onVoidCampaign={(campaignId, reason, note) => { perform(() => voidCampaign(campaignId, reason, note)).catch(() => {}) }} onConnectAnalytics={() => { perform(startYouTubeAnalyticsOAuth).catch(() => {}) }} onCollectAnalytics={(publicationId, range) => { perform(() => collectYouTubeAnalytics(publicationId, range.startDate, range.endDate)).catch(() => {}) }} onSave={(id, values) => { perform(() => updateRevenueQuery(id, values)).catch(() => {}) }} />
}
