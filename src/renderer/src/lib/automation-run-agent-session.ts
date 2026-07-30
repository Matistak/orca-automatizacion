import { launchAgentBackgroundSession } from '@/lib/launch-agent-background-session'
import { submitPromptToAgentPty } from '@/lib/agent-paste-draft'
import { findReusableAutomationSession } from '@/lib/automation-session-reuse'
import { observeExistingAutomationSession } from '@/lib/automation-session-observer'
import { useAppStore } from '@/store'
import type {
  Automation,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun
} from '../../../shared/automations-types'
import {
  createAutomationRunCompletionTracker,
  type AutomationRunCompletionTracker
} from '@/lib/automation-run-completion-tracker'
import type { AutomationTerminalOwnership } from '@/lib/automation-terminal-ownership'
import type { Worktree } from '../../../shared/types'

const activeReuseDispatchTabIds = new Set<string>()

function acquireReuseDispatchTab(tabId: string): (() => void) | null {
  if (activeReuseDispatchTabIds.has(tabId)) {
    return null
  }
  activeReuseDispatchTabIds.add(tabId)
  return () => activeReuseDispatchTabIds.delete(tabId)
}

export type AutomationRunFocusSnapshot = {
  activeView: ReturnType<typeof useAppStore.getState>['activeView']
  activeWorktreeId: string | null
  activeTabId: string | null
  activeTabType: ReturnType<typeof useAppStore.getState>['activeTabType']
}

export type AutomationRunAgentSessionArgs = {
  automation: Automation
  run: AutomationRun
  worktree: Worktree
  precheckResult: AutomationPrecheckResult | null
  focusBeforeDispatch: AutomationRunFocusSnapshot
  markDispatchResult: (result: AutomationDispatchResult) => Promise<void>
  listRuns?: () => Promise<AutomationRun[]>
}

/**
 * Starts (or reuses) the agent session for a run in its prepared workspace and
 * follows it to completion, restoring the user's focus afterwards so a
 * background dispatch never steals the view.
 */
export async function runAutomationAgentSession(
  options: AutomationRunAgentSessionArgs
): Promise<void> {
  const { automation, run, worktree, precheckResult, markDispatchResult } = options
  let terminalOwnership: AutomationTerminalOwnership | null = null
  const releaseTerminalOwnership = (): void => {
    const ownership = terminalOwnership
    terminalOwnership = null
    ownership?.release()
  }
  const tracker = createAutomationRunCompletionTracker({
    run,
    worktree,
    precheckResult,
    markDispatchResult,
    releaseTerminalOwnership,
    finalizeTerminalOwnership: () => {
      const ownership = terminalOwnership
      terminalOwnership = null
      return ownership?.finalize() ?? false
    }
  })

  try {
    if (automation.reuseSession && (await dispatchToReusedSession(options, tracker))) {
      return
    }
    const dispatchStartedAt = Date.now()
    const result = await launchAgentBackgroundSession({
      agent: automation.agentId,
      worktreeId: worktree.id,
      prompt: automation.prompt,
      launchSource: 'unknown',
      title: run.title,
      onData: (chunk) => tracker.appendOutput(chunk),
      onAgentStatus: (payload) => {
        tracker.noteAssistantMessage(payload.lastAssistantMessage)
        if (payload.state === 'done') {
          tracker.handleAgentDone()
        }
      },
      onExit: (_ptyId, code) => tracker.handleExit(code)
    })
    if (!result) {
      throw new Error('Unable to build an agent launch plan.')
    }
    terminalOwnership = result.terminalOwnership
    if (automation.reuseSession) {
      // Why: the first fresh launch is the seed for later reuse and must
      // survive completion under the same policy as an already-reused tab.
      releaseTerminalOwnership()
    }
    tracker.observeAgentStatus(result.paneKey, dispatchStartedAt)
    try {
      await markDispatchResult({
        runId: run.id,
        status: 'dispatched',
        workspaceId: worktree.id,
        workspaceDisplayName: worktree.displayName,
        terminalSessionId: result.tabId,
        terminalPaneKey: result.paneKey,
        terminalPtyId: result.ptyId,
        precheckResult,
        error: null
      })
      await tracker.flushPendingCompletion()
    } catch (error) {
      tracker.cleanupObservers()
      throw error
    }
    restoreFocus(options.focusBeforeDispatch, worktree.id)
  } catch (error) {
    releaseTerminalOwnership()
    await markDispatchResult({
      runId: run.id,
      status: 'dispatch_failed',
      workspaceId: worktree.id,
      workspaceDisplayName: worktree.displayName,
      precheckResult,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Sends the prompt into an agent tab a previous run of the same automation left
 * open. Returns false when no session is reusable, so the caller falls back to a
 * fresh launch.
 */
async function dispatchToReusedSession(
  options: AutomationRunAgentSessionArgs,
  tracker: AutomationRunCompletionTracker
): Promise<boolean> {
  const { automation, run, worktree, precheckResult, markDispatchResult } = options
  const reusableSession = findReusableAutomationSession({
    automationId: automation.id,
    agentId: automation.agentId,
    worktreeId: worktree.id,
    currentRunId: run.id,
    runs: (await options.listRuns?.()) ?? [],
    state: useAppStore.getState()
  })
  if (!reusableSession) {
    return false
  }
  const releaseTab = acquireReuseDispatchTab(reusableSession.tabId)
  if (!releaseTab) {
    return false
  }
  tracker.setReuseRelease(releaseTab)
  try {
    const submitted = await submitPromptToAgentPty({
      tabId: reusableSession.tabId,
      ptyId: reusableSession.ptyId,
      content: automation.prompt
    })
    if (!submitted) {
      tracker.cleanupObservers()
      return false
    }
    let reuseSawWorking = false
    const reuseCompletionStartedAt = Date.now()
    tracker.setSessionObserver(
      await observeExistingAutomationSession({
        ptyId: reusableSession.ptyId,
        paneKey: reusableSession.paneKey,
        runId: run.id,
        onData: (chunk) => tracker.appendOutput(chunk),
        onAgentStatus: (payload) => {
          tracker.noteAssistantMessage(payload.lastAssistantMessage)
          if (payload.state === 'working') {
            reuseSawWorking = true
            return
          }
          if (payload.state === 'done' && reuseSawWorking) {
            tracker.handleAgentDone()
          }
        },
        onExit: (code) => tracker.handleExit(code)
      })
    )
    tracker.observeAgentStatus(reusableSession.paneKey, reuseCompletionStartedAt, {
      requireWorkingAfterStart: true
    })
    await markDispatchResult({
      runId: run.id,
      status: 'dispatched',
      workspaceId: worktree.id,
      workspaceDisplayName: worktree.displayName,
      terminalSessionId: reusableSession.tabId,
      terminalPaneKey: reusableSession.paneKey,
      terminalPtyId: reusableSession.ptyId,
      precheckResult,
      error: null
    })
    await tracker.flushPendingCompletion()
    return true
  } catch (error) {
    tracker.cleanupObservers()
    throw error
  }
}

// Why: Run Now and scheduled dispatches create workspaces/tabs in the
// background; only an explicit row click should navigate there.
function restoreFocus(focus: AutomationRunFocusSnapshot, worktreeId: string): void {
  const currentState = useAppStore.getState()
  if (focus.activeWorktreeId === worktreeId || currentState.activeWorktreeId !== worktreeId) {
    return
  }
  currentState.setActiveView(focus.activeView)
  currentState.setActiveWorktree(focus.activeWorktreeId)
  if (focus.activeTabId) {
    currentState.setActiveTab(focus.activeTabId)
  }
  currentState.setActiveTabType(focus.activeTabType)
}
