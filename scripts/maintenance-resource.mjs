export function resourceKind(url, contentType = '') {
  const mime = String(contentType).split(';')[0].trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (/xml$|\+xml$/.test(mime)) return 'xml'
  if (mime) return 'asset'
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (/\.xml$/.test(pathname)) return 'xml-candidate'
    if (/\.(?:png|jpe?g|gif|webp|svg|css|js|pdf|txt|ico)$/.test(pathname)) return 'asset-candidate'
  } catch {}
  return 'unknown'
}
