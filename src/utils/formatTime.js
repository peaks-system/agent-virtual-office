// Shared time formatting utility
// compact: "5s", "3m", "1h"
// descriptive: "now", "5s ago", "3m ago"
// `now`: the clock to measure against — components pass the one value useNowTick returns for the
// render so every label in it agrees; defaults to the system clock.
import { t } from '../i18n'

export function formatTimeAgo(ts, { compact = false, now = Date.now() } = {}) {
  if (!ts || !Number.isFinite(ts)) return compact ? t('time.compactSeconds', '{0}s').replace('{0}', '0') : t('time.now', 'now')
  const diff = Math.floor((now - ts) / 1000)
  if (diff < 0) return compact ? t('time.compactSeconds', '{0}s').replace('{0}', '0') : t('time.now', 'now')
  if (!compact && diff < 5) return t('time.now', 'now')
  if (diff < 60) return t(compact ? 'time.compactSeconds' : 'time.secondsAgo', compact ? '{0}s' : '{0}s ago').replace('{0}', diff)
  if (diff < 3600) return t(compact ? 'time.compactMinutes' : 'time.minutesAgo', compact ? '{0}m' : '{0}m ago').replace('{0}', Math.floor(diff / 60))
  return t(compact ? 'time.compactHours' : 'time.hoursAgo', compact ? '{0}h' : '{0}h ago').replace('{0}', Math.floor(diff / 3600))
}
