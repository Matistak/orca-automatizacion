import { describe, expect, it } from 'vitest'
import {
  FLOW_SCHEMA_VERSION,
  type Flow,
  type FlowNode,
  type FlowRun
} from '../../shared/flows-types'
import { JsonFlowRepository } from './json-flow-repository'
import type { FlowStoreBackend } from './flow-store-backend'
import { FlowExecutionEngine } from './flow-execution-engine'
import type {
  FlowExecutionContext,
  FlowNodeDispatcher,
  FlowNodeResult
} from './flow-node-dispatcher'

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

function result(overrides: Partial<FlowNodeResult> = {}): FlowNodeResult {
  return {
    status: 'completed',
    output: null,
    usage: null,
    exitCode: null,
    workspaceId: null,
    workspaceDisplayName: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    error: null,
    ...overrides
  }
}

function outputSnapshot(content: string) {
  return { format: 'plain_text' as const, content, capturedAt: 0, truncated: false }
}

/** Dispatcher scripted per node id; records the (interpolated) config it saw. */
class ScriptedDispatcher implements FlowNodeDispatcher {
  seen: FlowNode[] = []
  constructor(private readonly script: Record<string, FlowNodeResult>) {}
  async dispatchNode(args: {
    node: FlowNode
    context: FlowExecutionContext
  }): Promise<FlowNodeResult> {
    this.seen.push(args.node)
    return this.script[args.node.id] ?? result()
  }
}

function makeFlow(nodes: FlowNode[], edges: Flow['edges']): Flow {
  return {
    id: 'flow-1',
    name: 'Test flow',
    nodes,
    edges,
    enabled: true,
    schemaVersion: FLOW_SCHEMA_VERSION,
    createdAt: 0,
    updatedAt: 0
  }
}

const trigger: FlowNode = {
  id: 'trg',
  config: { kind: 'trigger-manual' },
  position: { x: 0, y: 0 }
}

function agentNode(id: string, prompt = 'do work'): FlowNode {
  return {
    id,
    config: {
      kind: 'agent-prompt',
      agentId: 'claude',
      prompt,
      workspaceMode: 'new_per_run',
      projectId: 'repo-1'
    },
    position: { x: 0, y: 0 }
  }
}

function shellNode(id: string, command = 'echo hi'): FlowNode {
  return {
    id,
    config: { kind: 'shell-command', command, timeoutSeconds: 30 },
    position: { x: 0, y: 0 }
  }
}

describe('FlowExecutionEngine', () => {
  it('runs a linear flow end to end and persists node runs', async () => {
    const backend = new FakeBackend()
    const repo = new JsonFlowRepository(backend)
    const flow = makeFlow([trigger, agentNode('a')], [{ id: 'e1', source: 'trg', target: 'a' }])
    const engine = new FlowExecutionEngine(repo, new ScriptedDispatcher({ a: result() }))

    const { run, status } = await engine.run(flow, 'manual')

    expect(status).toBe('completed')
    const stored = repo.getRun(run.id)!
    expect(stored.status).toBe('completed')
    expect(stored.completedAt).not.toBeNull()
    expect(stored.nodeRuns.map((n) => n.nodeId).sort()).toEqual(['a', 'trg'])
    expect(stored.nodeRuns.every((n) => n.status === 'completed')).toBe(true)
  })

  it('chains agent → shell and passes upstream output into the command', async () => {
    const backend = new FakeBackend()
    const repo = new JsonFlowRepository(backend)
    const flow = makeFlow(
      [trigger, agentNode('a'), shellNode('s', 'run {{a.output}}')],
      [
        { id: 'e1', source: 'trg', target: 'a' },
        { id: 'e2', source: 'a', target: 's' }
      ]
    )
    const dispatcher = new ScriptedDispatcher({
      a: result({ output: outputSnapshot('42') }),
      s: result({ exitCode: 0 })
    })
    const engine = new FlowExecutionEngine(repo, dispatcher)

    const { status } = await engine.run(flow, 'manual')

    expect(status).toBe('completed')
    const shellSeen = dispatcher.seen.find((n) => n.id === 's')!
    expect(shellSeen.config).toMatchObject({ command: 'run 42' })
  })

  it('follows the true branch of a condition and skips the false branch', async () => {
    const backend = new FakeBackend()
    const repo = new JsonFlowRepository(backend)
    const condition: FlowNode = {
      id: 'c',
      config: { kind: 'condition', expression: { source: 'exit-code', equals: 0 } },
      position: { x: 0, y: 0 }
    }
    const flow = makeFlow(
      [trigger, shellNode('s'), condition, agentNode('yes'), agentNode('no')],
      [
        { id: 'e1', source: 'trg', target: 's' },
        { id: 'e2', source: 's', target: 'c' },
        { id: 'e3', source: 'c', sourceHandle: 'true', target: 'yes' },
        { id: 'e4', source: 'c', sourceHandle: 'false', target: 'no' }
      ]
    )
    const dispatcher = new ScriptedDispatcher({ s: result({ exitCode: 0 }) })
    const engine = new FlowExecutionEngine(repo, dispatcher)

    const { run, status } = await engine.run(flow, 'manual')

    expect(status).toBe('completed')
    expect(dispatcher.seen.map((n) => n.id)).toContain('yes')
    expect(dispatcher.seen.map((n) => n.id)).not.toContain('no')
    const stored = repo.getRun(run.id)!
    expect(stored.nodeRuns.find((n) => n.nodeId === 'no')!.status).toBe('skipped_unavailable')
    expect(stored.nodeRuns.find((n) => n.nodeId === 'yes')!.status).toBe('completed')
  })

  it('marks a run failed and skips downstream nodes when a node fails', async () => {
    const backend = new FakeBackend()
    const repo = new JsonFlowRepository(backend)
    const flow = makeFlow(
      [trigger, agentNode('a'), shellNode('s')],
      [
        { id: 'e1', source: 'trg', target: 'a' },
        { id: 'e2', source: 'a', target: 's' }
      ]
    )
    const dispatcher = new ScriptedDispatcher({
      a: result({ status: 'dispatch_failed', error: 'boom' })
    })
    const engine = new FlowExecutionEngine(repo, dispatcher)

    const { run, status } = await engine.run(flow, 'manual')

    expect(status).toBe('failed')
    expect(dispatcher.seen.map((n) => n.id)).not.toContain('s')
    const stored = repo.getRun(run.id)!
    expect(stored.nodeRuns.find((n) => n.nodeId === 's')!.status).toBe('skipped_unavailable')
  })

  it('rejects a flow containing a cycle', async () => {
    const backend = new FakeBackend()
    const repo = new JsonFlowRepository(backend)
    const flow = makeFlow(
      [trigger, agentNode('a'), agentNode('b')],
      [
        { id: 'e1', source: 'trg', target: 'a' },
        { id: 'e2', source: 'a', target: 'b' },
        { id: 'e3', source: 'b', target: 'a' }
      ]
    )
    const engine = new FlowExecutionEngine(repo, new ScriptedDispatcher({}))

    await expect(engine.run(flow, 'manual')).rejects.toThrow(/cycle/i)
  })

  it('freezes the flow snapshot so later edits do not affect the run', async () => {
    const backend = new FakeBackend()
    const repo = new JsonFlowRepository(backend)
    const flow = makeFlow([trigger, agentNode('a')], [{ id: 'e1', source: 'trg', target: 'a' }])
    const engine = new FlowExecutionEngine(repo, new ScriptedDispatcher({ a: result() }))

    const { run } = await engine.run(flow, 'manual')
    flow.nodes.push(agentNode('late'))

    expect(repo.getRun(run.id)!.flowSnapshot.nodes).toHaveLength(2)
  })
})
