import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FLOW_MISSED_RUN_GRACE_MINUTES,
  findScheduleTriggerNode,
  flowMissedRunGraceMs,
  isFlowScheduleEligible,
  latestFlowOccurrenceAtOrBefore,
  nextFlowOccurrenceAfter
} from './flow-schedule'
import { FLOW_SCHEMA_VERSION, type Flow, type FlowNode } from './flows-types'

function flowWith(nodes: FlowNode[], overrides: Partial<Flow> = {}): Flow {
  return {
    id: 'flow-1',
    name: 'Flow',
    nodes,
    edges: nodes.length > 1 ? [{ id: 'e1', source: nodes[0]!.id, target: nodes[1]!.id }] : [],
    enabled: true,
    schemaVersion: FLOW_SCHEMA_VERSION,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function scheduleNode(
  config: Partial<Extract<FlowNode['config'], { kind: 'trigger-schedule' }>> = {}
): FlowNode {
  return {
    id: 'trigger',
    config: {
      kind: 'trigger-schedule',
      rrule: '0 9 * * *',
      dtstart: Date.UTC(2026, 0, 1),
      timezone: 'UTC',
      ...config
    },
    position: { x: 0, y: 0 }
  }
}

const shellNode: FlowNode = {
  id: 'shell',
  config: { kind: 'shell-command', command: 'echo hi', timeoutSeconds: 10, workspaceId: 'r::/w' },
  position: { x: 100, y: 0 }
}

describe('flow-schedule', () => {
  it('finds the schedule trigger', () => {
    expect(findScheduleTriggerNode(flowWith([scheduleNode(), shellNode]))?.id).toBe('trigger')
  })

  it('has no trigger on a manual flow', () => {
    const manual: FlowNode = {
      id: 't',
      config: { kind: 'trigger-manual' },
      position: { x: 0, y: 0 }
    }
    expect(findScheduleTriggerNode(flowWith([manual]))).toBeUndefined()
    expect(nextFlowOccurrenceAfter(flowWith([manual]), 0)).toBeNull()
  })

  it('falls back to the default grace window', () => {
    expect(flowMissedRunGraceMs(flowWith([scheduleNode()]))).toBe(
      DEFAULT_FLOW_MISSED_RUN_GRACE_MINUTES * 60 * 1000
    )
  })

  it('uses a per-node grace window when set', () => {
    expect(flowMissedRunGraceMs(flowWith([scheduleNode({ missedRunGraceMinutes: 30 })]))).toBe(
      30 * 60 * 1000
    )
  })

  it('returns null instead of throwing on an unparseable rrule', () => {
    const flow = flowWith([scheduleNode({ rrule: 'not-a-schedule' })])
    expect(nextFlowOccurrenceAfter(flow, Date.UTC(2026, 0, 2))).toBeNull()
    expect(latestFlowOccurrenceAtOrBefore(flow, Date.UTC(2026, 0, 2))).toBeNull()
  })

  it('advances to a strictly later occurrence', () => {
    const flow = flowWith([scheduleNode(), shellNode])
    const first = nextFlowOccurrenceAfter(flow, flow.createdAt)!
    expect(nextFlowOccurrenceAfter(flow, first)).toBeGreaterThan(first)
  })

  it('is ineligible while disabled, unscheduled, or invalid', () => {
    expect(isFlowScheduleEligible(flowWith([scheduleNode(), shellNode]))).toBe(true)
    expect(isFlowScheduleEligible(flowWith([scheduleNode(), shellNode], { enabled: false }))).toBe(
      false
    )
    expect(
      isFlowScheduleEligible(
        flowWith([
          { id: 't', config: { kind: 'trigger-manual' }, position: { x: 0, y: 0 } },
          shellNode
        ])
      )
    ).toBe(false)
    const invalid = flowWith([
      scheduleNode(),
      { ...shellNode, config: { kind: 'shell-command', command: '  ', timeoutSeconds: 10 } }
    ])
    expect(isFlowScheduleEligible(invalid)).toBe(false)
  })
})
