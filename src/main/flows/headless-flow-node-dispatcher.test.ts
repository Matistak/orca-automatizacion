import { describe, expect, it, vi } from 'vitest'
import {
  FLOW_SCHEMA_VERSION,
  type Flow,
  type FlowNode,
  type FlowRun
} from '../../shared/flows-types'
import type { Repo } from '../../shared/types'
import type { FlowExecutionContext } from './flow-node-dispatcher'
import type { FlowRepository } from './flow-repository'
import {
  buildHeadlessFlowWorkspaceName,
  createHeadlessFlowNodeDispatcher,
  type HeadlessFlowRuntime
} from './headless-flow-node-dispatcher'

const agentNode: FlowNode = {
  id: 'agent',
  label: 'Audit',
  config: {
    kind: 'agent-prompt',
    agentId: 'claude',
    prompt: 'Review the diff',
    workspaceMode: 'new_per_run',
    projectId: 'repo-1'
  },
  position: { x: 0, y: 0 }
}

const flowSnapshot: Flow = {
  id: 'flow-1',
  name: 'Nightly audit',
  nodes: [agentNode],
  edges: [],
  enabled: true,
  schemaVersion: FLOW_SCHEMA_VERSION,
  createdAt: 0,
  updatedAt: 0
}

const run: FlowRun = {
  id: 'run-1',
  flowId: 'flow-1',
  flowSnapshot,
  status: 'running',
  trigger: 'scheduled',
  nodeRuns: [],
  startedAt: 0,
  completedAt: null,
  runNumber: 4
}

function context(): FlowExecutionContext {
  return {
    flowId: 'flow-1',
    flowName: 'Nightly audit',
    flowRunId: 'run-1',
    runNumber: 4,
    trigger: 'scheduled',
    results: new Map(),
    previousNodeId: null
  }
}

function repository(overrides: Partial<FlowRepository> = {}): FlowRepository {
  return { getRun: () => run, ...overrides } as unknown as FlowRepository
}

/** Loose overrides: the real runtime types are far wider than these fakes need. */
function runtime(overrides: Record<string, unknown> = {}): HeadlessFlowRuntime {
  return {
    createManagedWorktree: vi.fn(async () => ({
      worktree: { id: 'repo-1::/tmp/ws', displayName: 'ws' },
      startupTerminal: { handle: 'h1', tabId: 'tab-1', paneKey: 'pane-1', ptyId: 'pty-1' }
    })),
    launchAgentTerminal: vi.fn(async () => ({
      handle: 'h1',
      tabId: 'tab-1',
      paneKey: 'pane-1',
      ptyId: 'pty-1',
      worktreeId: 'repo-1::/tmp/existing'
    })),
    showManagedWorktree: vi.fn(async () => ({ displayName: 'existing' })),
    waitForTerminal: vi.fn(async () => ({ satisfied: true })),
    readTerminal: vi.fn(async () => ({ tail: ['done'] })),
    ...overrides
  } as unknown as HeadlessFlowRuntime
}

const getRepo = (): Repo => ({ id: 'repo-1', name: 'demo', path: '/tmp/demo' }) as unknown as Repo

describe('buildHeadlessFlowWorkspaceName', () => {
  it('carries the flow, node and run number', () => {
    expect(
      buildHeadlessFlowWorkspaceName({
        flowName: 'Nightly audit',
        node: agentNode,
        runNumber: 4,
        createdAt: Date.UTC(2026, 0, 2, 9)
      })
    ).toBe('flow-nightly-audit-audit-4')
  })

  it('falls back to a timestamp when the run has no number', () => {
    expect(
      buildHeadlessFlowWorkspaceName({
        flowName: 'x',
        node: agentNode,
        runNumber: null,
        createdAt: Date.UTC(2026, 0, 2, 9)
      })
    ).toBe('flow-x-audit-20260102T0900')
  })
})

describe('createHeadlessFlowNodeDispatcher', () => {
  it('creates a workspace, launches the agent and captures its output', async () => {
    const rt = runtime()
    const dispatcher = createHeadlessFlowNodeDispatcher({
      runtime: rt,
      repository: repository(),
      getRepo
    })
    const result = await dispatcher.dispatchNode({ node: agentNode, context: context() })
    expect(result.status).toBe('completed')
    expect(result.workspaceId).toBe('repo-1::/tmp/ws')
    expect(result.terminalPaneKey).toBe('pane-1')
    expect(result.output?.content).toBe('done')
  })

  it('stamps flow provenance on the workspace it creates', async () => {
    const createManagedWorktree = vi.fn(async (_args: { automationProvenance?: unknown }) => ({
      worktree: { id: 'repo-1::/tmp/ws', displayName: 'ws' },
      startupTerminal: { handle: 'h1' }
    }))
    const dispatcher = createHeadlessFlowNodeDispatcher({
      runtime: runtime({ createManagedWorktree }),
      repository: repository(),
      getRepo
    })
    await dispatcher.dispatchNode({ node: agentNode, context: context() })
    expect(createManagedWorktree.mock.calls[0]?.[0]).toMatchObject({
      automationProvenance: expect.objectContaining({
        kind: 'created-by-flow',
        flowId: 'flow-1',
        flowRunId: 'run-1',
        nodeId: 'agent'
      })
    })
  })

  it('reuses an existing workspace when the node is not new_per_run', async () => {
    const launchAgentTerminal = vi.fn(async () => ({
      handle: 'h1',
      worktreeId: 'repo-1::/tmp/existing'
    }))
    const dispatcher = createHeadlessFlowNodeDispatcher({
      runtime: runtime({ launchAgentTerminal }),
      repository: repository(),
      getRepo
    })
    const result = await dispatcher.dispatchNode({
      node: {
        ...agentNode,
        config: {
          kind: 'agent-prompt',
          agentId: 'claude',
          prompt: 'go',
          workspaceMode: 'existing',
          workspaceId: 'repo-1::/tmp/existing'
        }
      },
      context: context()
    })
    expect(launchAgentTerminal).toHaveBeenCalled()
    expect(result.workspaceId).toBe('repo-1::/tmp/existing')
    expect(result.status).toBe('completed')
  })

  it('fails the node when the agent never goes idle', async () => {
    const dispatcher = createHeadlessFlowNodeDispatcher({
      runtime: runtime({
        waitForTerminal: vi.fn(async () => ({ satisfied: false, blockedReason: 'awaiting input' }))
      }),
      repository: repository(),
      getRepo
    })
    const result = await dispatcher.dispatchNode({ node: agentNode, context: context() })
    expect(result.status).toBe('dispatch_failed')
    expect(result.error).toContain('awaiting input')
    // The workspace still exists, so history keeps a way back into it.
    expect(result.workspaceId).toBe('repo-1::/tmp/ws')
  })

  it('fails when no agent terminal started', async () => {
    const dispatcher = createHeadlessFlowNodeDispatcher({
      runtime: runtime({
        createManagedWorktree: vi.fn(async () => ({
          worktree: { id: 'repo-1::/tmp/ws' },
          startupTerminal: null,
          warning: 'agent binary missing'
        }))
      }),
      repository: repository(),
      getRepo
    })
    const result = await dispatcher.dispatchNode({ node: agentNode, context: context() })
    expect(result.status).toBe('dispatch_failed')
    expect(result.error).toBe('agent binary missing')
  })

  it('refuses a node kind it cannot run', async () => {
    const dispatcher = createHeadlessFlowNodeDispatcher({
      runtime: runtime(),
      repository: repository(),
      getRepo
    })
    const result = await dispatcher.dispatchNode({
      node: {
        id: 'shell',
        config: { kind: 'shell-command', command: 'echo hi', timeoutSeconds: 5 },
        position: { x: 0, y: 0 }
      },
      context: context()
    })
    expect(result.status).toBe('dispatch_failed')
    expect(result.error).toContain('shell-command')
  })

  it('fails when the run is gone', async () => {
    const dispatcher = createHeadlessFlowNodeDispatcher({
      runtime: runtime(),
      repository: repository({ getRun: () => undefined }),
      getRepo
    })
    const result = await dispatcher.dispatchNode({ node: agentNode, context: context() })
    expect(result.status).toBe('dispatch_failed')
    expect(result.error).toContain('no longer available')
  })
})
