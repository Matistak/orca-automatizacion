import { useAppStore } from '@/store'
import type {
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun
} from '../../../shared/automations-types'
import {
  createAutomationRunOutputSnapshotBuffer,
  selectAutomationRunOutputSnapshot
} from '@/components/automations/automation-run-output-snapshot'
import type { Worktree } from '../../../shared/types'

export type AutomationRunCompletionTracker = {
  appendOutput: (chunk: string) => void
  noteAssistantMessage: (message: string | null | undefined) => void
  /** Agent reported `done`; completes the run once the dispatch is recorded. */
  handleAgentDone: () => void
  /** PTY exited; a non-zero code fails the run. */
  handleExit: (code: number) => void
  /** Watch a pane's agent status for completion after `startedAfter`. */
  observeAgentStatus: (
    paneKey: string,
    startedAfter: number,
    options?: { requireWorkingAfterStart?: boolean }
  ) => void
  setSessionObserver: (unsubscribe: () => void) => void
  setReuseRelease: (release: () => void) => void
  cleanupObservers: () => void
  /** Called after the 'dispatched' result lands; flushes anything that finished first. */
  flushPendingCompletion: () => Promise<void>
}

/**
 * Tracks one agent session to its terminal result. Completion can arrive before
 * the `dispatched` result is persisted (fast agents, instant exits), so early
 * signals are held and flushed by `flushPendingCompletion` rather than lost.
 */
export function createAutomationRunCompletionTracker(args: {
  run: AutomationRun
  worktree: Worktree
  precheckResult: AutomationPrecheckResult | null
  markDispatchResult: (result: AutomationDispatchResult) => Promise<void>
  releaseTerminalOwnership: () => void
  finalizeTerminalOwnership: () => boolean
}): AutomationRunCompletionTracker {
  const { run, worktree, precheckResult, markDispatchResult } = args
  const outputSnapshotBuffer = createAutomationRunOutputSnapshotBuffer()
  let latestAssistantMessage: string | null = null
  const getOutputSnapshot = () =>
    selectAutomationRunOutputSnapshot(latestAssistantMessage, outputSnapshotBuffer.snapshot())
  let dispatchMarked = false
  let pendingExitCode: number | null = null
  let pendingDone = false
  let completionMarked = false
  let unsubscribeAgentStatus = (): void => {}
  let unsubscribeSessionObserver = (): void => {}
  let releaseReuseDispatchTab = (): void => {}

  const cleanupObservers = (): void => {
    unsubscribeAgentStatus()
    unsubscribeSessionObserver()
    releaseReuseDispatchTab()
    unsubscribeAgentStatus = (): void => {}
    unsubscribeSessionObserver = (): void => {}
    releaseReuseDispatchTab = (): void => {}
  }

  const clearRetiredRunTerminalIdentity = async (): Promise<void> => {
    // Why: the owned terminal was just retired, so the run's pane/pty pointers
    // now reference a closed tab. Drop them (best-effort) so "View run" resolves
    // to the workspace/snapshot instead of dead-ending on an unavailable terminal.
    try {
      await markDispatchResult({
        runId: run.id,
        status: 'completed',
        terminalSessionId: null,
        terminalPaneKey: null,
        terminalPtyId: null
      })
    } catch (error) {
      console.error('[automations] Failed to clear retired terminal identity:', error)
    }
  }

  const markFinalResult = async (code: number | null): Promise<void> => {
    if (completionMarked) {
      return
    }
    completionMarked = true
    cleanupObservers()
    const failed = code !== null && code !== 0
    try {
      await markDispatchResult({
        runId: run.id,
        status: failed ? 'dispatch_failed' : 'completed',
        workspaceId: worktree.id,
        workspaceDisplayName: worktree.displayName,
        outputSnapshot: getOutputSnapshot(),
        precheckResult,
        error: failed ? `Automation process exited with code ${code}.` : null
      })
    } catch (error) {
      args.releaseTerminalOwnership()
      throw error
    }
    if (failed) {
      args.releaseTerminalOwnership()
      return
    }
    if (args.finalizeTerminalOwnership()) {
      await clearRetiredRunTerminalIdentity()
    }
  }

  const settleLateResult = (result: Promise<void>): void => {
    // Why: status/exit callbacks have no awaitable caller; the result path
    // already releases ownership before propagating persistence errors.
    void result.catch((error) => {
      console.error('[automations] Failed to persist late automation result:', error)
    })
  }

  const handleAgentDone = (): void => {
    if (completionMarked) {
      return
    }
    if (!dispatchMarked) {
      pendingDone = true
      return
    }
    settleLateResult(markFinalResult(null))
  }

  const handleExit = (code: number): void => {
    if (completionMarked) {
      return
    }
    if (!dispatchMarked) {
      pendingExitCode = code
      return
    }
    settleLateResult(markFinalResult(code))
  }

  const observeAgentStatus = (
    targetPaneKey: string,
    startedAfter: number,
    options?: { requireWorkingAfterStart?: boolean }
  ): void => {
    let sawWorkingAfterStart = false
    const checkCurrentStatus = (): void => {
      const { agentStatusByPaneKey } = useAppStore.getState()
      for (const [paneKey, entry] of Object.entries(agentStatusByPaneKey)) {
        if (paneKey !== targetPaneKey || entry.updatedAt < startedAfter) {
          continue
        }
        if (entry.state === 'working') {
          sawWorkingAfterStart = true
        }
        if (
          entry.state === 'done' &&
          (!options?.requireWorkingAfterStart || sawWorkingAfterStart)
        ) {
          latestAssistantMessage = entry.lastAssistantMessage?.trim() || latestAssistantMessage
          handleAgentDone()
          return
        }
      }
    }
    // Why: Codex/Claude completion normally arrives through the global hook IPC
    // listener, not the hidden PTY OSC fallback.
    unsubscribeAgentStatus = useAppStore.subscribe(checkCurrentStatus)
    checkCurrentStatus()
  }

  return {
    appendOutput: (chunk) => outputSnapshotBuffer.append(chunk),
    noteAssistantMessage: (message) => {
      latestAssistantMessage = message?.trim() || latestAssistantMessage
    },
    handleAgentDone,
    handleExit,
    observeAgentStatus,
    setSessionObserver: (unsubscribe) => {
      unsubscribeSessionObserver = unsubscribe
    },
    setReuseRelease: (release) => {
      releaseReuseDispatchTab = release
    },
    cleanupObservers,
    flushPendingCompletion: async () => {
      dispatchMarked = true
      if (pendingDone) {
        await markFinalResult(null)
      } else if (pendingExitCode !== null) {
        await markFinalResult(pendingExitCode)
      }
    }
  }
}
