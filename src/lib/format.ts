const dt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
export function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : dt.format(d)
}
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, size)))
}
export function rangeText(total: number, page: number, size: number): string {
  if (total === 0) return 'No results'
  const from = (page - 1) * size + 1
  return `Showing ${from.toLocaleString('en-GB')} to ${Math.min(total, page * size).toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')}`
}
