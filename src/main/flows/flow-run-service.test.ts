import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { FLOW_SCHEMA_VERSION, type Flow, type FlowRun } from '../../shared/flows-types'
import type { Store } from '../persistence'
import { FlowRunService } from './flow-run-service'
import type { FlowNodeDispatcher, FlowNodeResult } from './flow-node-dispatcher'
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

const agentFlow: Flow = {
  id: 'flow-1',
  name: 'Flow',
  nodes: [
    { id: 'trigger', config: { kind: 'trigger-manual' }, position: { x: 0, y: 0 } },
    {
      id: 'agent',
      config: {
        kind: 'agent-prompt',
        agentId: 'claude',
        prompt: 'go',
        workspaceMode: 'new_per_run',
        projectId: 'repo-1'
      },
      position: { x: 100, y: 0 }
    }
  ],
  edges: [{ id: 'e1', source: 'trigger', target: 'agent' }],
  enabled: true,
  schemaVersion: FLOW_SCHEMA_VERSION,
  createdAt: 0,
  updatedAt: 0
}

function completed(): FlowNodeResult {
  return {
    status: 'completed',
    output: null,
    usage: null,
    exitCode: null,
    workspaceId: 'repo-1::/tmp/ws',
    workspaceDisplayName: 'ws',
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    error: null
  }
}

function setup(opts: { headless?: boolean } = {}) {
  const backend = new FakeBackend()
  backend.flows = [agentFlow]
  const dispatchNode = vi.fn(async () => completed())
  const headlessDispatcher: FlowNodeDispatcher | null = opts.headless ? { dispatchNode } : null
  const service = new FlowRunService(
    { getRepo: () => undefined } as unknown as Store,
    new JsonFlowRepository(backend),
    { headlessDispatcher }
  )
  return { backend, service, dispatchNode }
}

const liveWindow = {
  isDestroyed: () => false,
  send: () => {}
} as unknown as WebContents

describe('FlowRunService', () => {
  it('runs agent nodes headlessly when no window is attached', async () => {
    const { service, dispatchNode } = setup({ headless: true })
    const run = await service.runNow('flow-1')
    expect(dispatchNode).toHaveBeenCalledTimes(1)
    expect(run.status).toBe('completed')
  })

  it('still uses the headless path while an attached window is not ready', async () => {
    const { service, dispatchNode } = setup({ headless: true })
    service.setWebContents(liveWindow)
    await service.runNow('flow-1')
    expect(dispatchNode).toHaveBeenCalledTimes(1)
  })

  it('prefers the renderer once it reports ready', async () => {
    const { service, dispatchNode } = setup({ headless: true })
    // Answering from `send` mimics the renderer replying to the dispatch request.
    service.setWebContents({
      isDestroyed: () => false,
      send: (_channel: string, request: { flowRunId: string; nodeId: string }) => {
        setTimeout(
          () =>
            service.reportNodeResult({
              flowRunId: request.flowRunId,
              nodeId: request.nodeId,
              status: 'completed'
            }),
          0
        )
      }
    } as unknown as WebContents)
    service.setRendererReady()
    const run = await service.runNow('flow-1')
    expect(dispatchNode).not.toHaveBeenCalled()
    expect(run.status).toBe('completed')
  })

  it('marks an agent node unavailable with neither renderer nor headless path', async () => {
    const { service } = setup()
    const run = await service.runNow('flow-1')
    expect(run.status).toBe('failed')
    expect(run.nodeRuns.find((entry) => entry.nodeId === 'agent')?.status).toBe(
      'skipped_unavailable'
    )
  })

  it('records an unexecuted scheduled occurrence', () => {
    const { service } = setup()
    const run = service.recordUnexecutedRun({
      flow: agentFlow,
      scheduledFor: 1_000,
      status: 'skipped_missed',
      error: 'too late'
    })
    expect(run).toMatchObject({
      status: 'skipped_missed',
      trigger: 'scheduled',
      scheduledFor: 1_000,
      error: 'too late'
    })
    // The snapshot is frozen, so later edits do not rewrite history.
    expect(run.flowSnapshot).not.toBe(agentFlow)
  })

  it('refuses a second concurrent run of the same flow', async () => {
    const { service } = setup({ headless: true })
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow = new FlowRunService(
      { getRepo: () => undefined } as unknown as Store,
      new JsonFlowRepository(Object.assign(new FakeBackend(), { flows: [agentFlow] })),
      { headlessDispatcher: { dispatchNode: async () => (await gate, completed()) } }
    )
    const first = slow.runNow('flow-1')
    await expect(slow.runNow('flow-1')).rejects.toThrow('already running')
    release()
    await first
    expect(service.isRunning('flow-1')).toBe(false)
  })

  it('stamps scheduledFor on a scheduled run', async () => {
    const { service } = setup({ headless: true })
    const run = await service.runScheduled('flow-1', 5_000)
    expect(run.trigger).toBe('scheduled')
    expect(run.scheduledFor).toBe(5_000)
  })
})
