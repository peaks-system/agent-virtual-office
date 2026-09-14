export const isStaffRunActive = run => ['queued', 'running'].includes(run?.status)

export function staffStartBlocked({ project, settings, request, approveAstra, astraReason, submitting, runId, lookup, run }) {
  if (!project) return 'プロジェクトを選択してください。'
  if (settings?.category !== 'general') return 'サイト設定で「一般サイト」を選び、保存してください。'
  if (!settings?.permissions?.ai) return 'サイト設定で「AIチームの検討・記事案作成」を許可して保存してください。'
  if (!request.trim()) return '依頼文を入力してください。'
  if (approveAstra && astraReason.trim().length < 5) return 'Astraが必要な理由を5文字以上で入力してください。'
  if (submitting) return '依頼を送信しています。'
  if (runId && lookup === 'checking') return '保存された実行IDを確認しています。長く続く場合は実行表示をリセットできます。'
  if (runId && lookup === 'unavailable') return '実行状態を確認できません。再確認するか、注意事項を確認して実行表示をリセットしてください。'
  if (isStaffRunActive(run)) return '共同作業が実行中です。完了を待つか、実行を中止してください。'
  return ''
}

export async function lookupStaffRun(id, projectId, { fetcher = fetch, signal, timeoutMs = 10000 } = {}) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timer
  try {
    return await Promise.race([
      (async () => {
        const response = await fetcher(`/api/staff/runs/${encodeURIComponent(id)}`, { signal: controller.signal })
        if (response.status === 404) return { lookup: 'missing', run: null }
        if (!response.ok) return { lookup: 'unavailable', run: null }
        const run = await response.json()
        if (run.id !== id || run.projectId !== projectId || !['queued', 'running', 'awaiting-human', 'error', 'cancelled'].includes(run.status)) return { lookup: 'unavailable', run: null }
        return { lookup: 'ready', run }
      })(),
      new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve({ lookup: 'unavailable', run: null }) }, timeoutMs) }),
    ])
  } catch {
    // Surface bounded, non-sensitive failure state in the UI; never reflect transport details.
    return { lookup: 'unavailable', run: null }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
