import { describe, expect, it } from 'vitest'
import type { FlowEdge, FlowNodeRun } from '../../../../shared/flows-types'
import { getFlowEdgeTone } from './flow-edge-run-tone'

const edge: FlowEdge = { id: 'e1', source: 'a', target: 'b' }

function runs(status: FlowNodeRun['status'] | null): Map<string, FlowNodeRun> {
  if (!status) {
    return new Map()
  }
  return new Map([
    [
      'b',
      {
        nodeId: 'b',
        status,
        output: null,
        usage: null,
        terminalSessionId: null,
        terminalPaneKey: null,
        terminalPtyId: null,
        error: null,
        startedAt: 1,
        completedAt: null
      } as FlowNodeRun
    ]
  ])
}

describe('getFlowEdgeTone', () => {
  it('is idle before the target is reached', () => {
    expect(getFlowEdgeTone(edge, runs(null))).toBe('idle')
    expect(getFlowEdgeTone(edge, runs('pending'))).toBe('idle')
  })

  it('is active while the target works', () => {
    expect(getFlowEdgeTone(edge, runs('dispatched'))).toBe('active')
  })

  it('follows the target outcome', () => {
    expect(getFlowEdgeTone(edge, runs('completed'))).toBe('completed')
    expect(getFlowEdgeTone(edge, runs('dispatch_failed'))).toBe('failed')
    expect(getFlowEdgeTone(edge, runs('skipped_unavailable'))).toBe('skipped')
  })
})
