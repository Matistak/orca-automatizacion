import { afterEach, describe, expect, it } from 'vitest'
import {
  FLOW_SCHEMA_VERSION,
  type Flow,
  type FlowNodeRun,
  type FlowRun
} from '../../shared/flows-types'
import { MAX_FLOW_RUNS_PER_FLOW } from '../../shared/flow-run-retention'
import type { FlowRepository } from './flow-repository'
import { JsonFlowRepository } from './json-flow-repository'
import { SqliteFlowRepository } from './sqlite-flow-repository'
import type { FlowStoreBackend } from './flow-store-backend'

/**
 * One behavioural contract, two backends. This is what makes the SQLite
 * migration a wiring change: any implementation of FlowRepository that passes
 * this suite is a drop-in replacement. Add cases here, not in a backend-specific
 * test, whenever the interface gains behaviour.
 */

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

const IMPLEMENTATIONS: {
  name: string
  create: () => { repo: FlowRepository; close?: () => void }
}[] = [
  {
    name: 'JsonFlowRepository',
    create: () => ({ repo: new JsonFlowRepository(new FakeBackend()) })
  },
  {
    name: 'SqliteFlowRepository',
    create: () => {
      const repo = new SqliteFlowRepository()
      return { repo, close: () => repo.close() }
    }
  }
]

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

describe.each(IMPLEMENTATIONS)('FlowRepository contract — $name', ({ create }) => {
  let repo: FlowRepository
  let close: (() => void) | undefined

  function makeRepo(): FlowRepository {
    const created = create()
    repo = created.repo
    close = created.close
    return repo
  }

  afterEach(() => {
    close?.()
    close = undefined
  })

  describe('flow CRUD', () => {
    it('creates a flow with schema version and defaults', () => {
      const repo = makeRepo()
      const flow = repo.createFlow({ name: '  My flow  ' })
      expect(flow.name).toBe('My flow')
      expect(flow.enabled).toBe(false)
      expect(flow.schemaVersion).toBe(FLOW_SCHEMA_VERSION)
      expect(flow.nodes).toEqual([])
      expect(repo.getFlow(flow.id)).toEqual(flow)
    })

    it('falls back to a placeholder name when blank', () => {
      const repo = makeRepo()
      expect(repo.createFlow({ name: '   ' }).name).toBe('Untitled flow')
    })

    it('round-trips nodes, edges and description', () => {
      const repo = makeRepo()
      const created = repo.createFlow({
        name: 'Graph',
        description: 'two nodes',
        nodes: [
          { id: 'n1', config: { kind: 'trigger-manual' }, position: { x: 1, y: 2 } },
          {
            id: 'n2',
            label: 'check',
            config: { kind: 'shell-command', command: 'git status', timeoutSeconds: 30 },
            position: { x: 3, y: 4 }
          }
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', sourceHandle: 'true' }]
      })
      expect(repo.getFlow(created.id)).toEqual(created)
    })

    it('updates a flow and bumps updatedAt', () => {
      const repo = makeRepo()
      const flow = repo.createFlow({ name: 'A' })
      const updated = repo.updateFlow(flow.id, { name: 'B', enabled: true })
      expect(updated.name).toBe('B')
      expect(updated.enabled).toBe(true)
      expect(updated.updatedAt).toBeGreaterThanOrEqual(flow.updatedAt)
      expect(repo.getFlow(flow.id)).toEqual(updated)
    })

    it('throws updating a missing flow', () => {
      const repo = makeRepo()
      expect(() => repo.updateFlow('nope', { name: 'x' })).toThrow('Flow not found.')
    })

    it('deletes a flow and cascades its runs', () => {
      const repo = makeRepo()
      const flow = repo.createFlow({ name: 'A' })
      repo.appendRun(makeRun({ id: 'r1', flowId: flow.id }))
      repo.appendRun(makeRun({ id: 'r2', flowId: 'other' }))
      repo.deleteFlow(flow.id)
      expect(repo.getFlow(flow.id)).toBeUndefined()
      expect(repo.listRunsByFlow(flow.id)).toEqual([])
      expect(repo.getRun('r2')).toBeDefined()
    })

    it('summaries omit heavy payloads and carry lastRunAt', () => {
      const repo = makeRepo()
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

    it('summaries are sorted by name and omit nextRunAt for manual flows', () => {
      const repo = makeRepo()
      repo.createFlow({ name: 'zeta' })
      repo.createFlow({ name: 'alpha' })
      const summaries = repo.listFlowSummaries()
      expect(summaries.map((summary) => summary.name)).toEqual(['alpha', 'zeta'])
      expect(summaries[0].nextRunAt).toBeUndefined()
      expect(summaries[0].lastRunAt).toBeUndefined()
    })
  })

  describe('runs', () => {
    it('stamps sequential run numbers per flow', () => {
      const repo = makeRepo()
      const a = repo.appendRun(makeRun({ id: 'r1', flowId: 'f1' }))
      const b = repo.appendRun(makeRun({ id: 'r2', flowId: 'f1' }))
      const c = repo.appendRun(makeRun({ id: 'r3', flowId: 'f2' }))
      expect(a.runNumber).toBe(1)
      expect(b.runNumber).toBe(2)
      expect(c.runNumber).toBe(1)
    })

    it('freezes the flow snapshot at append time', () => {
      const repo = makeRepo()
      const flow = repo.createFlow({ name: 'A' })
      const run = repo.appendRun(
        makeRun({ id: 'r1', flowId: flow.id, flowSnapshot: structuredClone(flow) })
      )
      repo.updateFlow(flow.id, { name: 'renamed' })
      expect(repo.getRun(run.id)?.flowSnapshot.name).toBe('A')
    })

    it('upserts a node run by nodeId', () => {
      const repo = makeRepo()
      repo.appendRun(makeRun({ id: 'r1', flowId: 'f1', status: 'running' }))
      repo.updateNodeRun('r1', makeNodeRun('n1', { status: 'dispatched' }))
      repo.updateNodeRun('r1', makeNodeRun('n1', { status: 'completed' }))
      repo.updateNodeRun('r1', makeNodeRun('n2'))
      const run = repo.getRun('r1')!
      expect(run.nodeRuns).toHaveLength(2)
      expect(run.nodeRuns.find((entry) => entry.nodeId === 'n1')?.status).toBe('completed')
    })

    it('throws updating a node run on a missing run', () => {
      const repo = makeRepo()
      expect(() => repo.updateNodeRun('nope', makeNodeRun('n1'))).toThrow('Flow run not found.')
    })

    it('rolls up the run status and completion time', () => {
      const repo = makeRepo()
      repo.appendRun(makeRun({ id: 'r1', flowId: 'f1', status: 'running' }))
      const updated = repo.updateRunStatus('r1', 'failed', 42)
      expect(updated).toMatchObject({ status: 'failed', completedAt: 42 })
      expect(repo.getRun('r1')).toMatchObject({ status: 'failed', completedAt: 42 })
    })

    it('throws rolling up a missing run', () => {
      const repo = makeRepo()
      expect(() => repo.updateRunStatus('nope', 'completed', 1)).toThrow('Flow run not found.')
    })

    it('lists runs newest-first and respects limit', () => {
      const repo = makeRepo()
      repo.appendRun(makeRun({ id: 'old', flowId: 'f1', startedAt: 1 }))
      repo.appendRun(makeRun({ id: 'new', flowId: 'f1', startedAt: 9 }))
      repo.appendRun(makeRun({ id: 'other', flowId: 'f2', startedAt: 5 }))
      expect(repo.listRunsByFlow('f1').map((run) => run.id)).toEqual(['new', 'old'])
      expect(repo.listRunsByFlow('f1', 1).map((run) => run.id)).toEqual(['new'])
    })

    it('finds the latest scheduled run by occurrence, ignoring manual ones', () => {
      const repo = makeRepo()
      repo.appendRun(
        makeRun({ id: 's1', flowId: 'f1', trigger: 'scheduled', scheduledFor: 100, startedAt: 100 })
      )
      repo.appendRun(
        makeRun({ id: 's2', flowId: 'f1', trigger: 'scheduled', scheduledFor: 300, startedAt: 310 })
      )
      repo.appendRun(makeRun({ id: 'm1', flowId: 'f1', trigger: 'manual', startedAt: 999 }))
      expect(repo.findLatestScheduledRun('f1')?.id).toBe('s2')
      expect(repo.findLatestScheduledRun('f2')).toBeUndefined()
    })

    it('preserves the error reason on unexecuted scheduled runs', () => {
      const repo = makeRepo()
      repo.appendRun(
        makeRun({
          id: 'r1',
          flowId: 'f1',
          trigger: 'scheduled',
          status: 'skipped_missed',
          scheduledFor: 7,
          error: 'Missed by 13h.'
        })
      )
      expect(repo.getRun('r1')).toMatchObject({ error: 'Missed by 13h.', scheduledFor: 7 })
    })

    it('retention caps final runs but never evicts a running one', () => {
      const repo = makeRepo()
      repo.appendRun(makeRun({ id: 'running', flowId: 'f1', status: 'running', startedAt: 0 }))
      for (let i = 0; i < MAX_FLOW_RUNS_PER_FLOW + 5; i++) {
        repo.appendRun(makeRun({ id: `done-${i}`, flowId: 'f1', startedAt: i + 1 }))
      }
      const runs = repo.listRunsByFlow('f1')
      expect(runs.filter((run) => run.status === 'completed')).toHaveLength(MAX_FLOW_RUNS_PER_FLOW)
      expect(runs.some((run) => run.id === 'running')).toBe(true)
    })

    it('pruneRuns keeps the newest runs of the requested flow only', () => {
      const repo = makeRepo()
      repo.appendRun(makeRun({ id: 'a', flowId: 'f1', startedAt: 1 }))
      repo.appendRun(makeRun({ id: 'b', flowId: 'f1', startedAt: 2 }))
      repo.appendRun(makeRun({ id: 'c', flowId: 'f2', startedAt: 3 }))
      repo.pruneRuns('f1', 1)
      expect(repo.listRunsByFlow('f1').map((run) => run.id)).toEqual(['b'])
      expect(repo.listRunsByFlow('f2').map((run) => run.id)).toEqual(['c'])
    })
  })
})
