import type { CapabilityState, GroupStatus } from './api'

export const CAPABILITY_LABEL: Record<CapabilityState, string> = {
  not_configured: 'Not configured', setup_required: 'Setup required', verifying: 'Verifying',
  connected: 'Connected', degraded: 'Degraded', disconnected: 'Disconnected',
}
export const CAPABILITY_CLASS: Record<CapabilityState, string> = {
  not_configured: '', setup_required: '', verifying: 'wn', connected: 'ok', degraded: 'wn', disconnected: 'er',
}
export const GROUP_LABEL: Record<GroupStatus, string> = { open: 'Open', resolved: 'Resolved', ignored: 'Ignored' }
export const GROUP_CLASS: Record<GroupStatus, string> = { open: 'wn', resolved: 'ok', ignored: '' }

// Maps a number to a bar height percentage, never zero so an empty hour still shows a baseline.
export function barHeights(values: number[]): number[] {
  const max = Math.max(1, ...values)
  return values.map((v) => Math.max(3, Math.round((v / max) * 100)))
}
export function usagePercent(used: number, cap: number): number {
  return cap <= 0 ? 0 : Math.min(100, Math.round((used / cap) * 100))
}
export function maskedKey(prefix: string): string { return `${prefix}${'•'.repeat(8)}` }
