import { launchWorktreeBackgroundTerminals } from '@/lib/launch-worktree-background-terminals'
import { useAppStore } from '@/store'
import type {
  Automation,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRun
} from '../../../shared/automations-types'
import { getAutomationRunRepoId } from '../../../shared/automation-run-identity'
import {
  didAutomationPrecheckPass,
  formatAutomationPrecheckFailure
} from '../../../shared/automation-precheck'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  toSshExecutionHostId
} from '../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { getFolderWorkspaceConnectionId } from '@/lib/folder-workspace-connection'
import type { AutomationWorkspaceProvenanceRequest, Worktree } from '../../../shared/types'

export type AutomationRunWorkspacePreparation =
  /** A terminal outcome was already reported; the caller must stop. */
  | { status: 'stopped' }
  | { status: 'ready'; worktree: Worktree; precheckResult: AutomationPrecheckResult | null }

export type AutomationRunWorkspaceArgs = {
  automation: Automation
  run: AutomationRun
  markDispatchResult: (result: AutomationDispatchResult) => Promise<void>
  runPrecheck?: () => Promise<AutomationPrecheckResult | null>
  buildProvenanceRequest?: (
    createRequestId: string
  ) => AutomationWorkspaceProvenanceRequest | undefined
}

function buildAutomationWorkspaceName(runTitle: string, scheduledFor: number): string {
  const slug = runTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const stamp = new Date(scheduledFor).toISOString().replace(/[-:]/g, '').slice(0, 13)
  return `auto-${slug || 'run'}-${stamp}`
}

/**
 * Resolves where a run will execute: validates that the project/workspace still
 * exists on the expected host, brings SSH up, applies the precheck gate, and
 * creates a fresh workspace when the run asks for one. Failures are reported
 * through markDispatchResult and surface here as `stopped`.
 */
export async function prepareAutomationRunWorkspace(
  options: AutomationRunWorkspaceArgs
): Promise<AutomationRunWorkspacePreparation> {
  const { automation, run, markDispatchResult } = options
  const state = useAppStore.getState()
  const runRepoId = getAutomationRunRepoId(automation)
  const repo = state.repos.find((entry) => entry.id === runRepoId)
  const automationWorkspaceScope = parseWorkspaceKey(automation.workspaceId ?? '')
  const automationWorktree = automation.workspaceId
    ? automationWorkspaceScope?.type === 'folder'
      ? state.getKnownWorktreeById(automation.workspaceId)
      : state.allWorktrees().find((entry) => entry.id === automation.workspaceId)
    : null
  const dispatchWorkspaceId = automation.workspaceId
  const dispatchWorkspaceDisplayName =
    automationWorktree?.displayName ?? run.workspaceDisplayName ?? null
  let precheckResult: AutomationPrecheckResult | null = null

  if (!repo) {
    await markDispatchResult({
      runId: run.id,
      status: 'skipped_unavailable',
      workspaceId: run.workspaceId,
      workspaceDisplayName: run.workspaceDisplayName ?? null,
      error: translate(
        'auto.hooks.useAutomationDispatchEvents.386db94f3e',
        'The target project is no longer available.'
      )
    })
    return { status: 'stopped' }
  }

  const folderWorkspaceConnectionId =
    automationWorkspaceScope?.type === 'folder'
      ? getFolderWorkspaceConnectionId(state, automationWorkspaceScope.folderWorkspaceId)
      : null
  const folderWorkspaceHostId =
    automationWorkspaceScope?.type === 'folder' && automationWorktree
      ? folderWorkspaceConnectionId === undefined
        ? null
        : folderWorkspaceConnectionId
          ? toSshExecutionHostId(folderWorkspaceConnectionId)
          : getResolvedExecutionHostIdForWorktree(state, automationWorktree.id)
      : null
  const runHostId =
    parseExecutionHostId(automation.runContext?.hostId)?.id ?? getRepoExecutionHostId(repo)
  const workspaceMatchesRunTarget =
    automationWorkspaceScope?.type === 'folder'
      ? folderWorkspaceHostId !== null && folderWorkspaceHostId === runHostId
      : !automation.runContext?.repoId ||
        automationWorktree?.repoId === automation.runContext.repoId
  if (automation.workspaceMode === 'existing' && automationWorktree && !workspaceMatchesRunTarget) {
    await markDispatchResult({
      runId: run.id,
      status: 'skipped_unavailable',
      workspaceId: automation.workspaceId,
      workspaceDisplayName: dispatchWorkspaceDisplayName,
      error: translate(
        'auto.hooks.useAutomationDispatchEvents.3ad7d77f57',
        'The target workspace is on a different host than this automation run target.'
      )
    })
    return { status: 'stopped' }
  }
  const sshTargetId =
    automationWorkspaceScope?.type === 'folder'
      ? (folderWorkspaceConnectionId ?? null)
      : (repo.connectionId ?? null)
  if (sshTargetId) {
    const needsPrompt = await window.api.ssh.needsPassphrasePrompt({
      targetId: sshTargetId
    })
    if (needsPrompt) {
      await markDispatchResult({
        runId: run.id,
        status: 'skipped_needs_interactive_auth',
        workspaceId: dispatchWorkspaceId,
        workspaceDisplayName: dispatchWorkspaceDisplayName,
        error: translate(
          'auto.hooks.useAutomationDispatchEvents.16a21d6413',
          'SSH reconnect requires interactive credentials.'
        )
      })
      return { status: 'stopped' }
    }
    const sshState = await window.api.ssh.getState({ targetId: sshTargetId })
    if (sshState?.status !== 'connected') {
      try {
        const connected = await window.api.ssh.connect({ targetId: sshTargetId })
        if (connected?.status !== 'connected') {
          throw new Error('SSH target is unavailable.')
        }
      } catch (error) {
        await markDispatchResult({
          runId: run.id,
          status: 'skipped_unavailable',
          workspaceId: dispatchWorkspaceId,
          workspaceDisplayName: dispatchWorkspaceDisplayName,
          error: error instanceof Error ? error.message : String(error)
        })
        return { status: 'stopped' }
      }
    }
  }

  if (automation.workspaceMode === 'existing' && !automationWorktree) {
    await markDispatchResult({
      runId: run.id,
      status: 'skipped_unavailable',
      workspaceId: automation.workspaceId,
      workspaceDisplayName: dispatchWorkspaceDisplayName,
      error: translate(
        'auto.hooks.useAutomationDispatchEvents.59718b120b',
        'The target workspace is no longer available.'
      )
    })
    return { status: 'stopped' }
  }

  if (run.trigger === 'scheduled' && automation.precheck) {
    precheckResult = (await options.runPrecheck?.()) ?? null
    if (precheckResult && !didAutomationPrecheckPass(precheckResult)) {
      await markDispatchResult({
        runId: run.id,
        status: 'skipped_precheck',
        workspaceId: dispatchWorkspaceId,
        workspaceDisplayName: dispatchWorkspaceDisplayName,
        precheckResult,
        error: formatAutomationPrecheckFailure(precheckResult)
      })
      return { status: 'stopped' }
    }
  }

  const automationWorkspaceCreateRequestId = createBrowserUuid()
  const createResult =
    automation.workspaceMode === 'new_per_run'
      ? await useAppStore
          .getState()
          .createWorktree(
            runRepoId,
            buildAutomationWorkspaceName(run.title, run.scheduledFor),
            automation.baseBranch ?? undefined,
            automation.setupDecision ?? 'skip',
            undefined,
            'unknown',
            run.title,
            undefined,
            undefined,
            undefined,
            automation.agentId,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            {
              automationProvenanceRequest: options.buildProvenanceRequest?.(
                automationWorkspaceCreateRequestId
              )
            }
          )
      : null
  const worktree = createResult
    ? createResult.worktree
    : automation.workspaceId
      ? automationWorktree
      : null

  if (!worktree) {
    await markDispatchResult({
      runId: run.id,
      status: 'skipped_unavailable',
      workspaceId: automation.workspaceId,
      workspaceDisplayName: dispatchWorkspaceDisplayName,
      error: translate(
        'auto.hooks.useAutomationDispatchEvents.59718b120b',
        'The target workspace is no longer available.'
      )
    })
    return { status: 'stopped' }
  }
  if (createResult?.setup || createResult?.defaultTabs) {
    void launchWorktreeBackgroundTerminals({
      worktreeId: worktree.id,
      setup: createResult.setup,
      defaultTabs: createResult.defaultTabs
    }).catch((error) => {
      // Why: setup/defaultTabs match normal worktree creation: they are
      // best-effort terminal work and must not block the automation agent.
      console.warn('[automations] Failed to launch workspace setup/default tabs:', error)
    })
  }
  return { status: 'ready', worktree, precheckResult }
}
