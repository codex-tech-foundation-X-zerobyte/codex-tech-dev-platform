import type { CapabilityState, GroupStatus } from '../lib/api'
import { CAPABILITY_CLASS, CAPABILITY_LABEL, GROUP_CLASS, GROUP_LABEL } from '../lib/status'

// Status is always text plus colour, never colour alone.
export const CapabilityBadge = ({ state }: { state: CapabilityState }) => <span className={`bd ${CAPABILITY_CLASS[state]}`}>{CAPABILITY_LABEL[state]}</span>
export const GroupBadge = ({ status }: { status: GroupStatus }) => <span className={`bd ${GROUP_CLASS[status]}`}>{GROUP_LABEL[status]}</span>
