import { beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import type { Flow, FlowNode, FlowRun } from '../../shared/flows-types'
import type { Repo } from '../../shared/types'
import { createAutomationDispatchToken } from '../automations/dispatch-tokens'
import { resolveFlowWorkspaceProvenance } from './flow-workspace-provenance'

const repo = { id: 'repo-1', path: '/repos/one', name: 'one' } as unknown as Repo

const agentNode: FlowNode = {
  id: 'node-1',
  position: { x: 0, y: 0 },
  label: 'Review changes',
  config: {
    kind: 'agent-prompt',
    agentId: 'claude',
    prompt: 'go',
    workspaceMode: 'new_per_run',
    projectId: 'repo-1'
  }
}

function makeRun(overrides?: Partial<FlowRun>): FlowRun {
  const flowSnapshot: Flow = {
    id: 'flow-1',
    name: 'Nightly audit',
    nodes: [agentNode],
    edges: [],
    enabled: true,
    schemaVersion: 1,
    createdAt: 1,
    updatedAt: 1
  }
  return {
    id: 'run-1',
    flowId: 'flow-1',
    flowSnapshot,
    status: 'running',
    trigger: 'manual',
    nodeRuns: [],
    startedAt: 1,
    completedAt: null,
    runNumber: 7,
    ...overrides
  }
}

let token: string

function request(
  overrides?: Partial<Parameters<typeof resolveFlowWorkspaceProvenance>[0]['request']>
) {
  return {
    kind: 'flow' as const,
    flowId: 'flow-1',
    flowRunId: 'run-1',
    nodeId: 'node-1',
    dispatchToken: token,
    createRequestId: 'create-1',
    ...overrides
  }
}

function resolve(run: FlowRun | undefined, overrides?: Parameters<typeof request>[0]) {
  return resolveFlowWorkspaceProvenance({
    authority: { getFlowRun: () => run },
    repoSelector: 'repo-1',
    repo,
    request: request(overrides)
  })
}

describe('resolveFlowWorkspaceProvenance', () => {
  beforeEach(() => {
    token = createAutomationDispatchToken('flow-1', 'run-1')
  })

  it('mints provenance for an in-flight agent node', () => {
    const provenance = resolve(makeRun())

    expect(provenance).toMatchObject({
      kind: 'created-by-flow',
      flowId: 'flow-1',
      flowNameSnapshot: 'Nightly audit',
      flowRunId: 'run-1',
      flowRunNumber: 7,
      nodeId: 'node-1',
      nodeLabelSnapshot: 'Review changes',
      projectId: 'repo-1'
    })
  })

  it('rejects an unknown run', () => {
    expect(() => resolve(undefined)).toThrow(ZodError)
  })

  it('rejects a run that already finished', () => {
    expect(() => resolve(makeRun({ status: 'completed' }))).toThrow(ZodError)
  })

  it('rejects a node id that is not in the frozen snapshot', () => {
    expect(() => resolve(makeRun(), { nodeId: 'node-missing' })).toThrow(ZodError)
  })

  it('rejects a node that is not new-per-run', () => {
    const run = makeRun()
    run.flowSnapshot.nodes = [
      {
        ...agentNode,
        config: { ...agentNode.config, workspaceMode: 'existing' } as FlowNode['config']
      }
    ]
    expect(() => resolve(run)).toThrow(ZodError)
  })

  it('rejects a node that already reached a final status', () => {
    const run = makeRun({
      nodeRuns: [
        {
          nodeId: 'node-1',
          status: 'completed',
          output: null,
          usage: null,
          terminalSessionId: null,
          terminalPaneKey: null,
          terminalPtyId: null,
          error: null,
          startedAt: 1,
          completedAt: 2
        }
      ]
    })
    expect(() => resolve(run)).toThrow(ZodError)
  })

  it('rejects a repo selector that does not match the node project', () => {
    expect(() =>
      resolveFlowWorkspaceProvenance({
        authority: { getFlowRun: () => makeRun() },
        repoSelector: 'repo-2',
        repo,
        request: request()
      })
    ).toThrow(ZodError)
  })

  it('rejects an invalid dispatch token', () => {
    expect(() => resolve(makeRun(), { dispatchToken: 'not-a-token' })).toThrow(ZodError)
  })

  it('rejects a second use of the same reserved token', () => {
    expect(resolve(makeRun())).toMatchObject({ kind: 'created-by-flow' })
    expect(() => resolve(makeRun(), { createRequestId: 'create-2' })).toThrow(ZodError)
  })
})
