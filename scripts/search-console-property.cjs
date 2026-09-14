'use strict'
const readable = level => ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(level)
function siteCovers(property, siteUrl) {
  if (typeof property !== 'string' || property.length > 2048) return false
  try {
    const target = new URL(siteUrl)
    if (!/^https?:$/.test(target.protocol) || target.username || target.password) return false
    if (property.startsWith('sc-domain:')) {
      const domain = property.slice(10)
      if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(domain)) return false
      return target.hostname === domain.toLowerCase() || target.hostname.endsWith(`.${domain.toLowerCase()}`)
    }
    const prefix = new URL(property)
    return /^https?:$/.test(prefix.protocol) && !prefix.username && !prefix.password && !prefix.search && !prefix.hash
      && prefix.origin === target.origin && target.href.startsWith(prefix.href)
  } catch { return false }
}
function propertyChoice(item, siteUrl) {
  const matches = siteCovers(item.siteUrl, siteUrl), allowed = readable(item.permissionLevel)
  return { siteUrl: item.siteUrl, permissionLevel: item.permissionLevel, matches, selectable: matches && allowed,
    label: !matches ? '登録URLの対象外' : !allowed ? '対象URLに一致・閲覧権限未確認' : item.siteUrl.startsWith('sc-domain:') ? '登録URLを含むドメイン' : '登録URLに一致するURLプレフィックス' }
}
module.exports = { siteCovers, propertyChoice, readable }
