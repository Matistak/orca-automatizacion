import type { WebContents } from 'electron'
import { isFinalAutomationRunStatus } from '../../shared/automations-types'
import type {
  FlowNode,
  FlowNodeDispatchRequest,
  FlowNodeDispatchResult
} from '../../shared/flows-types'
import { createAutomationDispatchToken } from '../automations/dispatch-tokens'
import type { FlowExecutionContext, FlowNodeResult } from './flow-node-dispatcher'
import type { FlowRepository } from './flow-repository'

type PendingNode = {
  resolve: (result: FlowNodeResult) => void
}

function pendingKey(flowRunId: string, nodeId: string): string {
  return `${flowRunId}:${nodeId}`
}

function toNodeResult(result: FlowNodeDispatchResult): FlowNodeResult {
  return {
    status: result.status,
    output: result.outputSnapshot ?? null,
    usage: result.usage ?? null,
    exitCode: null,
    workspaceId: result.workspaceId ?? null,
    workspaceDisplayName: result.workspaceDisplayName ?? null,
    terminalSessionId: result.terminalSessionId ?? null,
    terminalPaneKey: result.terminalPaneKey ?? null,
    terminalPtyId: result.terminalPtyId ?? null,
    error: result.error ?? null
  }
}

/**
 * Agent nodes can only run where the workspace/terminal machinery lives, so the
 * engine hands them to the renderer and awaits a reported result. Non-final
 * reports (e.g. `dispatched`) are persisted as live progress but keep the node
 * pending — the engine advances only on a final status.
 */
export class RendererFlowNodeDispatcher {
  private readonly pending = new Map<string, PendingNode>()

  constructor(
    private readonly repository: FlowRepository,
    private readonly getWebContents: () => WebContents | null
  ) {}

  async dispatchAgentNode(args: {
    node: FlowNode
    context: FlowExecutionContext
  }): Promise<FlowNodeResult> {
    const webContents = this.getWebContents()
    if (!webContents || webContents.isDestroyed()) {
      return {
        ...toNodeResult({
          flowRunId: args.context.flowRunId,
          nodeId: args.node.id,
          status: 'skipped_unavailable'
        }),
        error: 'No Orca window was available to launch this agent node.'
      }
    }
    const key = pendingKey(args.context.flowRunId, args.node.id)
    const request: FlowNodeDispatchRequest = {
      flowId: args.context.flowId,
      flowName: args.context.flowName,
      flowRunId: args.context.flowRunId,
      runNumber: args.context.runNumber,
      nodeId: args.node.id,
      node: args.node,
      trigger: args.context.trigger,
      dispatchToken: createAutomationDispatchToken(args.context.flowId, args.context.flowRunId)
    }
    const settled = new Promise<FlowNodeResult>((resolve) => {
      this.pending.set(key, { resolve })
    })
    webContents.send('flows:nodeDispatchRequested', request)
    return await settled
  }

  /** Called from the IPC handler when the renderer reports node progress. */
  reportNodeResult(result: FlowNodeDispatchResult): void {
    const key = pendingKey(result.flowRunId, result.nodeId)
    const pending = this.pending.get(key)
    const nodeResult = toNodeResult(result)
    if (!isFinalAutomationRunStatus(result.status)) {
      // Live progress: persist so the canvas can show the node running, but the
      // engine keeps waiting for the terminal status.
      this.repository.updateNodeRun(result.flowRunId, {
        nodeId: result.nodeId,
        status: nodeResult.status,
        output: nodeResult.output,
        usage: nodeResult.usage,
        workspaceId: nodeResult.workspaceId,
        workspaceDisplayName: nodeResult.workspaceDisplayName,
        exitCode: null,
        terminalSessionId: nodeResult.terminalSessionId,
        terminalPaneKey: nodeResult.terminalPaneKey,
        terminalPtyId: nodeResult.terminalPtyId,
        error: nodeResult.error,
        startedAt: Date.now(),
        completedAt: null
      })
      return
    }
    if (!pending) {
      return
    }
    this.pending.delete(key)
    pending.resolve(nodeResult)
  }

  /** Fail every node still awaiting the renderer (window closed, app quitting). */
  abandonAll(error: string): void {
    for (const [key, pending] of this.pending) {
      this.pending.delete(key)
      pending.resolve({
        status: 'dispatch_failed',
        output: null,
        usage: null,
        exitCode: null,
        workspaceId: null,
        workspaceDisplayName: null,
        terminalSessionId: null,
        terminalPaneKey: null,
        terminalPtyId: null,
        error
      })
    }
  }
}
