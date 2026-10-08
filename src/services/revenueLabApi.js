const ROOT = '/api/revenue'

async function request(path, options = {}) {
  const response = await fetch(`${ROOT}${path}`, {
    ...options,
    headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.data) {
    const error = new Error(payload?.error?.message || 'Revenue Labとの通信に失敗しました。')
    error.code = payload?.error?.code || 'REVENUE_API_ERROR'
    error.status = response.status
    error.details = payload?.error?.details || null
    throw error
  }
  return payload.data
}

export function loadRevenueDashboard() {
  return request('/dashboard?limit=3')
}

export function updateRevenueQuery(id, values) {
  return request(`/queries/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(values),
  })
}

export function enqueueRevenueQuery(sourceQueryId) {
  return request('/jobs', {
    method: 'POST',
    body: JSON.stringify({ sourceQueryId }),
  })
}

export async function enqueueEnabledRevenueQueries(queries) {
  const eligible = queries.filter(query => query.enabled && query.buyerIntent != null && query.commerceFit != null)
  const results = []
  for (const query of eligible) results.push(await enqueueRevenueQuery(query.id))
  return results
}

export { request as revenueRequest }
