import {
  latestAutomationOccurrenceAtOrBefore,
  nextAutomationOccurrenceAfter
} from './automation-schedules'
import { validateFlowGraph } from './flow-graph'
import type { Flow, FlowNode } from './flows-types'

/** Same default as automations: half a day of catch-up after a missed slot. */
export const DEFAULT_FLOW_MISSED_RUN_GRACE_MINUTES = 720

type ScheduleTriggerConfig = Extract<FlowNode['config'], { kind: 'trigger-schedule' }>

/** The flow's schedule trigger, or undefined when it is manual-only. */
export function findScheduleTriggerNode(flow: Flow): FlowNode | undefined {
  return flow.nodes.find((node) => node.config.kind === 'trigger-schedule')
}

function scheduleConfig(flow: Flow): ScheduleTriggerConfig | undefined {
  const config = findScheduleTriggerNode(flow)?.config
  return config?.kind === 'trigger-schedule' ? config : undefined
}

export function flowMissedRunGraceMs(flow: Flow): number {
  const minutes = scheduleConfig(flow)?.missedRunGraceMinutes
  return (minutes ?? DEFAULT_FLOW_MISSED_RUN_GRACE_MINUTES) * 60 * 1000
}

/**
 * When the flow fires next after `after`, or null when it has no schedule
 * trigger / an unparseable rrule. Unlike automations, this is computed on demand
 * instead of persisted: the schedule lives inside a node the editor rewrites
 * freely, so a stored nextRunAt would drift out of sync on every save.
 */
export function nextFlowOccurrenceAfter(flow: Flow, after: number): number | null {
  const config = scheduleConfig(flow)
  if (!config) {
    return null
  }
  try {
    return nextAutomationOccurrenceAfter(config.rrule, config.dtstart, after)
  } catch {
    return null
  }
}

/** The occurrence that should already have fired at or before `now`, if any. */
export function latestFlowOccurrenceAtOrBefore(flow: Flow, now: number): number | null {
  const config = scheduleConfig(flow)
  if (!config) {
    return null
  }
  try {
    return latestAutomationOccurrenceAtOrBefore(config.rrule, config.dtstart, now)
  } catch {
    return null
  }
}

/**
 * Whether the scheduler should consider this flow at all. An invalid graph is
 * excluded here rather than failing at dispatch, so a half-edited flow does not
 * append a failed run every tick.
 */
export function isFlowScheduleEligible(flow: Flow): boolean {
  return flow.enabled && Boolean(scheduleConfig(flow)) && validateFlowGraph(flow).ok
}
