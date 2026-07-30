import type { Automation, AutomationRun, AutomationRunUsage } from '../../shared/automations-types'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'

function createUnavailableAutomationUsage(
  collectedAt: number,
  provider: AutomationRunUsage['provider'],
  unavailableReason: AutomationRunUsage['unavailableReason'],
  unavailableMessage: string
): AutomationRunUsage {
  return {
    status: 'unavailable',
    provider,
    model: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningOutputTokens: null,
    totalTokens: null,
    estimatedCostUsd: null,
    estimatedCostSource: null,
    providerSessionId: null,
    attribution: null,
    collectedAt,
    unavailableReason,
    unavailableMessage
  }
}

/** Only the fields the collector reads — lets flow nodes reuse it without a fake Automation. */
export type UsageCollectionAutomation = Pick<Automation, 'agentId' | 'executionTargetType'>
export type UsageCollectionRun = Pick<
  AutomationRun,
  'status' | 'workspaceId' | 'terminalSessionId' | 'startedAt'
>

function getAutomationUsageProvider(
  automation: UsageCollectionAutomation | undefined
): AutomationRunUsage['provider'] {
  if (automation?.agentId === 'codex') {
    return 'codex'
  }
  if (automation?.agentId === 'claude') {
    return 'claude'
  }
  return null
}

export async function collectAutomationRunUsage({
  automation,
  run,
  claudeUsage,
  codexUsage
}: {
  automation: UsageCollectionAutomation | undefined
  run: UsageCollectionRun
  claudeUsage: ClaudeUsageStore | null
  codexUsage: CodexUsageStore | null
}): Promise<AutomationRunUsage> {
  const collectedAt = Date.now()
  const unavailable = (
    provider: AutomationRunUsage['provider'],
    unavailableReason: AutomationRunUsage['unavailableReason'],
    unavailableMessage: string
  ): AutomationRunUsage =>
    createUnavailableAutomationUsage(collectedAt, provider, unavailableReason, unavailableMessage)

  if (!automation || run.status !== 'completed') {
    return unavailable(
      getAutomationUsageProvider(automation),
      'run_not_finished',
      'Usage is only collected for completed automation runs.'
    )
  }
  if (automation.executionTargetType === 'ssh') {
    return unavailable(
      getAutomationUsageProvider(automation),
      'remote_usage_unavailable',
      'Remote automation usage is not available from local usage logs.'
    )
  }
  if (automation.agentId === 'claude') {
    if (!claudeUsage) {
      return unavailable('claude', 'scan_failed', 'Claude usage store is unavailable.')
    }
    return claudeUsage.getAutomationRunUsage({
      worktreeId: run.workspaceId,
      terminalSessionId: run.terminalSessionId,
      startedAt: run.startedAt,
      completedAt: collectedAt
    })
  }
  if (automation.agentId === 'codex') {
    if (!codexUsage) {
      return unavailable('codex', 'scan_failed', 'Codex usage store is unavailable.')
    }
    return codexUsage.getAutomationRunUsage({
      worktreeId: run.workspaceId,
      terminalSessionId: run.terminalSessionId,
      startedAt: run.startedAt,
      completedAt: collectedAt
    })
  }
  return unavailable(null, 'provider_unsupported', 'This agent does not report usage to Orca yet.')
}
