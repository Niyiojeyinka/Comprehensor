export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** exponent
  const digits = value >= 100 || exponent === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[exponent]}`
}

export function savingsRatio(original: number, next: number): number {
  if (original <= 0) return 0
  return Math.max(0, 1 - next / original)
}
