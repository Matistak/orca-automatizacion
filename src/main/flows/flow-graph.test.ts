import { describe, expect, it } from 'vitest'
import { FLOW_SCHEMA_VERSION, type Flow, type FlowNode } from '../../shared/flows-types'
import { topologicalOrder, validateFlowGraph } from './flow-graph'

function flow(nodes: FlowNode[], edges: Flow['edges']): Flow {
  return {
    id: 'f',
    name: 'f',
    nodes,
    edges,
    enabled: true,
    schemaVersion: FLOW_SCHEMA_VERSION,
    createdAt: 0,
    updatedAt: 0
  }
}

const trigger: FlowNode = { id: 't', config: { kind: 'trigger-manual' }, position: { x: 0, y: 0 } }
function agent(id: string): FlowNode {
  return {
    id,
    config: { kind: 'agent-prompt', agentId: 'claude', prompt: 'p', workspaceMode: 'new_per_run' },
    position: { x: 0, y: 0 }
  }
}

describe('validateFlowGraph', () => {
  it('accepts a well-formed linear DAG', () => {
    const v = validateFlowGraph(
      flow([trigger, agent('a')], [{ id: 'e', source: 't', target: 'a' }])
    )
    expect(v.ok).toBe(true)
    expect(v.errors).toEqual([])
  })

  it('errors when there is no trigger', () => {
    const v = validateFlowGraph(flow([agent('a')], []))
    expect(v.ok).toBe(false)
    expect(v.errors.some((e) => e.code === 'no_trigger')).toBe(true)
  })

  it('errors when there are multiple triggers', () => {
    const second: FlowNode = {
      id: 't2',
      config: { kind: 'trigger-manual' },
      position: { x: 0, y: 0 }
    }
    const v = validateFlowGraph(flow([trigger, second], []))
    expect(v.errors.some((e) => e.code === 'multiple_triggers')).toBe(true)
  })

  it('errors on a dangling edge', () => {
    const v = validateFlowGraph(flow([trigger], [{ id: 'e', source: 't', target: 'ghost' }]))
    expect(v.errors.some((e) => e.code === 'dangling_edge')).toBe(true)
  })

  it('errors on a cycle', () => {
    const v = validateFlowGraph(
      flow(
        [trigger, agent('a'), agent('b')],
        [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e2', source: 'a', target: 'b' },
          { id: 'e3', source: 'b', target: 'a' }
        ]
      )
    )
    expect(v.errors.some((e) => e.code === 'cycle')).toBe(true)
  })

  it('warns on an unreachable node', () => {
    const v = validateFlowGraph(flow([trigger, agent('orphan')], []))
    expect(v.ok).toBe(true)
    expect(v.warnings.some((w) => w.code === 'unreachable' && w.nodeId === 'orphan')).toBe(true)
  })
})

describe('topologicalOrder', () => {
  it('orders nodes so predecessors precede successors', () => {
    const order = topologicalOrder(
      flow(
        [trigger, agent('a'), agent('b')],
        [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e2', source: 'a', target: 'b' }
        ]
      )
    )
    const ids = order.map((n) => n.id)
    expect(ids.indexOf('t')).toBeLessThan(ids.indexOf('a'))
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'))
  })

  it('throws on a cycle', () => {
    expect(() =>
      topologicalOrder(
        flow(
          [agent('a'), agent('b')],
          [
            { id: 'e1', source: 'a', target: 'b' },
            { id: 'e2', source: 'b', target: 'a' }
          ]
        )
      )
    ).toThrow(/cycle/i)
  })
})
