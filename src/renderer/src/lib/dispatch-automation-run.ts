import { useAppStore } from '@/store'
import type {
  Automation,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun
} from '../../../shared/automations-types'
import type { SystemRunWorkspaceProvenanceRequest } from '../../../shared/types'
import { runAutomationAgentSession } from '@/lib/automation-run-agent-session'
import { prepareAutomationRunWorkspace } from '@/lib/automation-run-workspace-preparation'

export type AutomationRunDispatchOptions = {
  automation: Automation
  run: AutomationRun
  markDispatchResult: (result: AutomationDispatchResult) => Promise<void>
  /** Omitted by callers with no precheck (flow nodes); skips the precheck gate. */
  runPrecheck?: () => Promise<AutomationPrecheckResult | null>
  /** Prior runs used to find a reusable agent session. */
  listRuns?: () => Promise<AutomationRun[]>
  /** Proves the workspace this run creates: automations prove against the stored
   *  Automation, flow nodes against their live flow run. */
  buildProvenanceRequest?: (
    createRequestId: string
  ) => SystemRunWorkspaceProvenanceRequest | undefined
}

/**
 * Launches one run in the renderer: resolves (or creates) its workspace, then
 * drives the agent session to completion, reporting every status transition
 * through `markDispatchResult`. Shared by automations and by flow
 * `agent-prompt` nodes, which synthesize an Automation for their config.
 */
export async function dispatchAutomationRun(options: AutomationRunDispatchOptions): Promise<void> {
  const state = useAppStore.getState()
  // Why: capture focus before any workspace/tab is created so a background
  // dispatch can restore whatever the user was looking at.
  const focusBeforeDispatch = {
    activeView: state.activeView,
    activeWorktreeId: state.activeWorktreeId,
    activeTabId: state.activeTabId,
    activeTabType: state.activeTabType
  }
  const prepared = await prepareAutomationRunWorkspace(options)
  if (prepared.status === 'stopped') {
    return
  }
  await runAutomationAgentSession({
    automation: options.automation,
    run: options.run,
    worktree: prepared.worktree,
    precheckResult: prepared.precheckResult,
    focusBeforeDispatch,
    markDispatchResult: options.markDispatchResult,
    listRuns: options.listRuns
  })
}
