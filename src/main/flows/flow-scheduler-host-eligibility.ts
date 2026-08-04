import { getRepoExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import type { Flow, FlowNode } from '../../shared/flows-types'
import type { Repo } from '../../shared/types'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'

export type FlowSchedulingEligibility = { ok: true } | { ok: false; error: string }

/** Repos a node names up front; nodes that inherit their target resolve at run time. */
function declaredRepoId(node: FlowNode): string | null {
  const config = node.config
  if (config.kind === 'agent-prompt') {
    if (config.workspaceMode === 'new_per_run') {
      return config.projectId ?? null
    }
    return config.workspaceId
      ? (splitWorktreeIdForFilesystem(config.workspaceId)?.repoId ?? null)
      : null
  }
  if (config.kind === 'shell-command' && config.workspaceId) {
    return splitWorktreeIdForFilesystem(config.workspaceId)?.repoId ?? null
  }
  return null
}

/**
 * Whether this Orca process may fire a scheduled flow. Mirrors the automation
 * rule in run-target-resolution.ts: only a server process owns schedules whose
 * work lands on a remote runtime host, so desktop clients that mirror the same
 * state do not double-execute them.
 */
export function resolveFlowSchedulingEligibility(
  flow: Flow,
  options: {
    getRepo: (repoId: string) => Repo | undefined
    allowRemoteHostScheduling?: boolean
  }
): FlowSchedulingEligibility {
  for (const node of flow.nodes) {
    const repoId = declaredRepoId(node)
    if (!repoId) {
      continue
    }
    const repo = options.getRepo(repoId)
    if (!repo) {
      return { ok: false, error: 'A project this flow targets is no longer available.' }
    }
    if (
      parseExecutionHostId(getRepoExecutionHostId(repo))?.kind === 'runtime' &&
      !options.allowRemoteHostScheduling
    ) {
      return {
        ok: false,
        error:
          'Remote-server flow scheduling is not available from this Orca client yet. Run this flow on the remote server instead.'
      }
    }
  }
  return { ok: true }
}
