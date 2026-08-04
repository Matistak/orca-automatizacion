import { useEffect } from 'react'
import type { FlowNodeDispatchRequest } from '../../../shared/flows-types'
import { dispatchAutomationRun } from '@/lib/dispatch-automation-run'
import { toFlowNodeAutomation } from '@/lib/flow-agent-node-automation'
import { resolveAgentNodePrompt } from '@/lib/flow-agent-prompt-resolution'
import { translate } from '@/i18n/i18n'

/**
 * Executes the flow node kinds that only the renderer can run (agent-prompt),
 * reporting every status transition back to the main-process engine, which is
 * blocked on the node until a final status arrives.
 */
export function useFlowDispatchEvents(): void {
  useEffect(() => {
    // Why: the scheduler holds back agent nodes until a window can answer.
    void window.api.flows.rendererReady()
  }, [])

  useEffect(
    () =>
      window.api.flows.onNodeDispatchRequested(async (request: FlowNodeDispatchRequest) => {
        const report = (
          result: Parameters<typeof window.api.flows.markNodeDispatchResult>[0]
        ): Promise<void> => window.api.flows.markNodeDispatchResult(result)

        let resolvedPrompt: string | undefined
        if (request.node.config.kind === 'agent-prompt') {
          try {
            resolvedPrompt = await resolveAgentNodePrompt(request.node.config)
          } catch (error) {
            await report({
              flowRunId: request.flowRunId,
              nodeId: request.nodeId,
              status: 'dispatch_failed',
              error: error instanceof Error ? error.message : String(error)
            })
            return
          }
        }

        const synthesized = toFlowNodeAutomation(request, resolvedPrompt)
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
            // Proves the created workspace against the live flow run, so it gets
            // the same origin badge and sidebar filtering as automation runs.
            buildProvenanceRequest: (createRequestId) => ({
              kind: 'flow',
              flowId: request.flowId,
              flowRunId: request.flowRunId,
              nodeId: request.nodeId,
              dispatchToken: request.dispatchToken,
              createRequestId
            }),
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
