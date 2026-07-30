import { describe, expect, it } from 'vitest'
import {
  FLOW_SCHEMA_VERSION,
  type Flow,
  type FlowNodeRun,
  type FlowRun
} from '../../shared/flows-types'
import { MAX_FLOW_RUNS_PER_FLOW } from '../../shared/flow-run-retention'
import { JsonFlowRepository } from './json-flow-repository'
import type { FlowStoreBackend } from './flow-store-backend'

class FakeBackend implements FlowStoreBackend {
  flows: Flow[] = []
  flowRuns: FlowRun[] = []
  readFlows(): Flow[] {
    return this.flows
  }
  writeFlows(flows: Flow[]): void {
    this.flows = flows
  }
  readFlowRuns(): FlowRun[] {
    return this.flowRuns
  }
  writeFlowRuns(runs: FlowRun[]): void {
    this.flowRuns = runs
  }
}

function makeRepo() {
  const backend = new FakeBackend()
  return { backend, repo: new JsonFlowRepository(backend) }
}

function makeNodeRun(nodeId: string, overrides: Partial<FlowNodeRun> = {}): FlowNodeRun {
  return {
    nodeId,
    status: 'completed',
    output: null,
    usage: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    error: null,
    startedAt: 0,
    completedAt: 1,
    ...overrides
  }
}

function makeRun(overrides: Partial<FlowRun> & Pick<FlowRun, 'id' | 'flowId'>): FlowRun {
  return {
    flowSnapshot: { id: overrides.flowId } as Flow,
    status: 'completed',
    trigger: 'manual',
    nodeRuns: [],
    startedAt: 0,
    completedAt: null,
    ...overrides
  }
}

describe('JsonFlowRepository — flow CRUD', () => {
  it('creates a flow with schema version and defaults', () => {
    const { repo } = makeRepo()
    const flow = repo.createFlow({ name: '  My flow  ' })
    expect(flow.name).toBe('My flow')
    expect(flow.enabled).toBe(false)
    expect(flow.schemaVersion).toBe(FLOW_SCHEMA_VERSION)
    expect(flow.nodes).toEqual([])
    expect(repo.getFlow(flow.id)).toEqual(flow)
  })

  it('falls back to a placeholder name when blank', () => {
    const { repo } = makeRepo()
    expect(repo.createFlow({ name: '   ' }).name).toBe('Untitled flow')
  })

  it('updates a flow and bumps updatedAt', () => {
    const { repo } = makeRepo()
    const flow = repo.createFlow({ name: 'A' })
    const updated = repo.updateFlow(flow.id, { name: 'B', enabled: true })
    expect(updated.name).toBe('B')
    expect(updated.enabled).toBe(true)
    expect(updated.updatedAt).toBeGreaterThanOrEqual(flow.updatedAt)
  })

  it('throws updating a missing flow', () => {
    const { repo } = makeRepo()
    expect(() => repo.updateFlow('nope', { name: 'x' })).toThrow('Flow not found.')
  })

  it('deletes a flow and cascades its runs', () => {
    const { backend, repo } = makeRepo()
    const flow = repo.createFlow({ name: 'A' })
    repo.appendRun(makeRun({ id: 'r1', flowId: flow.id }))
    repo.appendRun(makeRun({ id: 'r2', flowId: 'other' }))
    repo.deleteFlow(flow.id)
    expect(repo.getFlow(flow.id)).toBeUndefined()
    expect(backend.flowRuns.map((r) => r.id)).toEqual(['r2'])
  })

  it('summaries omit heavy payloads and carry lastRunAt', () => {
    const { repo } = makeRepo()
    const flow = repo.createFlow({
      name: 'A',
      nodes: [{ id: 'n1', config: { kind: 'trigger-manual' }, position: { x: 0, y: 0 } }]
    })
    repo.appendRun(makeRun({ id: 'r1', flowId: flow.id, startedAt: 5 }))
    repo.appendRun(makeRun({ id: 'r2', flowId: flow.id, startedAt: 9 }))
    const [summary] = repo.listFlowSummaries()
    expect(summary).toMatchObject({ id: flow.id, nodeCount: 1, lastRunAt: 9 })
    expect(summary).not.toHaveProperty('nodes')
  })
})

describe('JsonFlowRepository — runs', () => {
  it('stamps sequential run numbers per flow', () => {
    const { repo } = makeRepo()
    const a = repo.appendRun(makeRun({ id: 'r1', flowId: 'f1' }))
    const b = repo.appendRun(makeRun({ id: 'r2', flowId: 'f1' }))
    const c = repo.appendRun(makeRun({ id: 'r3', flowId: 'f2' }))
    expect(a.runNumber).toBe(1)
    expect(b.runNumber).toBe(2)
    expect(c.runNumber).toBe(1)
  })

  it('freezes the flow snapshot at append time', () => {
    const { repo } = makeRepo()
    const flow = repo.createFlow({ name: 'A' })
    const run = repo.appendRun(
      makeRun({ id: 'r1', flowId: flow.id, flowSnapshot: structuredClone(flow) })
    )
    repo.updateFlow(flow.id, { name: 'renamed' })
    expect(repo.getRun(run.id)?.flowSnapshot.name).toBe('A')
  })

  it('upserts a node run by nodeId', () => {
    const { repo } = makeRepo()
    repo.appendRun(makeRun({ id: 'r1', flowId: 'f1', status: 'running' }))
    repo.updateNodeRun('r1', makeNodeRun('n1', { status: 'dispatched' }))
    repo.updateNodeRun('r1', makeNodeRun('n1', { status: 'completed' }))
    repo.updateNodeRun('r1', makeNodeRun('n2'))
    const run = repo.getRun('r1')!
    expect(run.nodeRuns).toHaveLength(2)
    expect(run.nodeRuns.find((n) => n.nodeId === 'n1')?.status).toBe('completed')
  })

  it('throws updating a node run on a missing run', () => {
    const { repo } = makeRepo()
    expect(() => repo.updateNodeRun('nope', makeNodeRun('n1'))).toThrow('Flow run not found.')
  })

  it('lists runs newest-first and respects limit', () => {
    const { repo } = makeRepo()
    repo.appendRun(makeRun({ id: 'old', flowId: 'f1', startedAt: 1 }))
    repo.appendRun(makeRun({ id: 'new', flowId: 'f1', startedAt: 9 }))
    expect(repo.listRunsByFlow('f1').map((r) => r.id)).toEqual(['new', 'old'])
    expect(repo.listRunsByFlow('f1', 1).map((r) => r.id)).toEqual(['new'])
  })

  it('retention caps final runs but never evicts a running one', () => {
    const { repo } = makeRepo()
    repo.appendRun(makeRun({ id: 'running', flowId: 'f1', status: 'running', startedAt: 0 }))
    for (let i = 0; i < MAX_FLOW_RUNS_PER_FLOW + 5; i++) {
      repo.appendRun(makeRun({ id: `done-${i}`, flowId: 'f1', startedAt: i + 1 }))
    }
    const runs = repo.listRunsByFlow('f1')
    expect(runs.filter((r) => r.status === 'completed')).toHaveLength(MAX_FLOW_RUNS_PER_FLOW)
    expect(runs.some((r) => r.id === 'running')).toBe(true)
  })
})
