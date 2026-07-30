import type { AutomationRunUsage } from '../../shared/automations-types'
import type { FlowNode } from '../../shared/flows-types'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import { collectAutomationRunUsage } from '../automations/run-usage-collection'
import type { FlowNodeResult } from './flow-node-dispatcher'

export type FlowNodeUsageCollector = (args: {
  node: FlowNode
  result: FlowNodeResult
  startedAt: number
}) => Promise<AutomationRunUsage | null>

/**
 * Attributes tokens/cost to an agent node by reusing the automation collector,
 * which needs only the provider (agentId) and the run's session time window.
 * Returns null when there is nothing to attribute, so the caller keeps whatever
 * usage the dispatch already reported.
 */
export function createFlowNodeUsageCollector({
  claudeUsage,
  codexUsage
}: {
  claudeUsage: ClaudeUsageStore | null
  codexUsage: CodexUsageStore | null
}): FlowNodeUsageCollector {
  return async ({ node, result, startedAt }) => {
    if (node.config.kind !== 'agent-prompt' || result.usage) {
      return null
    }
    if (result.status !== 'completed' || !result.workspaceId) {
      return null
    }
    return await collectAutomationRunUsage({
      // Flow agent nodes always dispatch through the local renderer; a remote
      // workspace simply yields no local usage rows rather than a wrong number.
      automation: { agentId: node.config.agentId, executionTargetType: 'local' },
      run: {
        status: result.status,
        workspaceId: result.workspaceId,
        terminalSessionId: result.terminalSessionId,
        startedAt
      },
      claudeUsage,
      codexUsage
    })
  }
}
