import type { Repo } from '../../shared/types'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import type { FlowExecutionContext } from './flow-node-dispatcher'

export type FlowShellTarget =
  | { ok: true; workspaceId: string; cwd: string; connectionId: string | null }
  | { ok: false; error: string }

/**
 * A shell node runs where its config says, or — when left blank — in the
 * workspace an upstream node produced, so `agent → shell` chains work without
 * repeating the workspace on every step.
 */
export function inheritedWorkspaceId(context: FlowExecutionContext): string | null {
  let inherited: string | null = null
  for (const result of context.results.values()) {
    if (result.workspaceId) {
      inherited = result.workspaceId
    }
  }
  return inherited
}

export function resolveFlowShellTarget(args: {
  workspaceId: string | null
  getRepo: (repoId: string) => Repo | undefined
}): FlowShellTarget {
  if (!args.workspaceId) {
    return {
      ok: false,
      error:
        'This command has no workspace. Pick one in the node inspector, or place the node after an agent node that creates one.'
    }
  }
  const parsed = splitWorktreeIdForFilesystem(args.workspaceId)
  if (!parsed?.worktreePath) {
    return { ok: false, error: 'The workspace for this command is no longer available.' }
  }
  const repo = args.getRepo(parsed.repoId)
  if (!repo) {
    return { ok: false, error: 'The project for this command is no longer available.' }
  }
  return {
    ok: true,
    workspaceId: args.workspaceId,
    cwd: parsed.worktreePath,
    connectionId: repo.connectionId ?? null
  }
}
