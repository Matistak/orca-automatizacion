import { useEffect } from 'react'
import type { FlowNodeDispatchRequest } from '../../../shared/flows-types'
import { dispatchAutomationRun } from '@/lib/dispatch-automation-run'
import { toFlowNodeAutomation } from '@/lib/flow-agent-node-automation'
import { translate } from '@/i18n/i18n'

/**
 * Executes the flow node kinds that only the renderer can run (agent-prompt),
 * reporting every status transition back to the main-process engine, which is
 * blocked on the node until a final status arrives.
 */
export function useFlowDispatchEvents(): void {
  useEffect(
    () =>
      window.api.flows.onNodeDispatchRequested(async (request: FlowNodeDispatchRequest) => {
        const report = (
          result: Parameters<typeof window.api.flows.markNodeDispatchResult>[0]
        ): Promise<void> => window.api.flows.markNodeDispatchResult(result)

        const synthesized = toFlowNodeAutomation(request)
        if (!synthesized) {
          await report({
            flowRunId: request.flowRunId,
            nodeId: request.nodeId,
            status: 'skipped_unavailable',
            error: translate(
              'auto.hooks.useFlowDispatchEvents.6f2a1d0c11',
              'This agent node has no project selected.'
            )
          })
          return
        }
        try {
          await dispatchAutomationRun({
            ...synthesized,
            // Why: flow nodes are not stored automations, so they cannot prove
            // workspace provenance; the workspace is created untagged.
            markDispatchResult: async (result) => {
              await report({
                flowRunId: request.flowRunId,
                nodeId: request.nodeId,
                status: result.status,
                workspaceId: result.workspaceId,
                workspaceDisplayName: result.workspaceDisplayName,
                terminalSessionId: result.terminalSessionId,
                terminalPaneKey: result.terminalPaneKey,
                terminalPtyId: result.terminalPtyId,
                outputSnapshot: result.outputSnapshot,
                usage: result.usage,
                error: result.error
              })
            }
          })
        } catch (error) {
          await report({
            flowRunId: request.flowRunId,
            nodeId: request.nodeId,
            status: 'dispatch_failed',
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }),
    []
  )
}
