import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { FlowNode, FlowNodeRun } from '../../shared/flows-types'
import type { FlowExecutionContext } from './flow-node-dispatcher'
import type { FlowRepository } from './flow-repository'
import { RendererFlowNodeDispatcher } from './renderer-flow-node-dispatcher'

const node: FlowNode = {
  id: 'node-1',
  position: { x: 0, y: 0 },
  config: { kind: 'agent-prompt', agentId: 'claude', prompt: 'go', workspaceMode: 'new_per_run' }
}

const context: FlowExecutionContext = {
  flowId: 'flow-1',
  flowName: 'Flow',
  flowRunId: 'run-1',
  runNumber: 1,
  trigger: 'manual',
  results: new Map(),
  previousNodeId: null
}

function setup(): {
  dispatcher: RendererFlowNodeDispatcher
  sent: unknown[]
  progress: FlowNodeRun[]
} {
  const sent: unknown[] = []
  const progress: FlowNodeRun[] = []
  const repository = {
    updateNodeRun: (_runId: string, nodeRun: FlowNodeRun) => {
      progress.push(nodeRun)
      return {} as never
    }
  } as unknown as FlowRepository
  const webContents = {
    isDestroyed: () => false,
    send: (_channel: string, payload: unknown) => sent.push(payload)
  } as unknown as WebContents
  return {
    dispatcher: new RendererFlowNodeDispatcher(repository, () => webContents),
    sent,
    progress
  }
}

describe('RendererFlowNodeDispatcher', () => {
  it('resolves only once the renderer reports a final status', async () => {
    const { dispatcher, sent, progress } = setup()
    const settled = vi.fn()
    const pending = dispatcher.dispatchAgentNode({ node, context }).then(settled)
    await Promise.resolve()
    expect(sent).toHaveLength(1)

    dispatcher.reportNodeResult({
      flowRunId: 'run-1',
      nodeId: 'node-1',
      status: 'dispatched',
      workspaceId: 'repo-1::/wt',
      terminalSessionId: 'tab-1'
    })
    await Promise.resolve()
    // Live progress is persisted, but the node is still pending.
    expect(progress).toHaveLength(1)
    expect(progress[0].status).toBe('dispatched')
    expect(settled).not.toHaveBeenCalled()

    dispatcher.reportNodeResult({
      flowRunId: 'run-1',
      nodeId: 'node-1',
      status: 'completed',
      workspaceId: 'repo-1::/wt'
    })
    await pending
    expect(settled).toHaveBeenCalledOnce()
  })

  it('skips the node when no window can execute it', async () => {
    const repository = {} as FlowRepository
    const dispatcher = new RendererFlowNodeDispatcher(repository, () => null)
    const result = await dispatcher.dispatchAgentNode({ node, context })
    expect(result.status).toBe('skipped_unavailable')
  })

  it('fails pending nodes when the window goes away', async () => {
    const { dispatcher } = setup()
    const pending = dispatcher.dispatchAgentNode({ node, context })
    await Promise.resolve()
    dispatcher.abandonAll('window closed')
    await expect(pending).resolves.toMatchObject({
      status: 'dispatch_failed',
      error: 'window closed'
    })
  })
})
