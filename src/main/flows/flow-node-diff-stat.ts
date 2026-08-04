import type { FlowNodeDiffStat } from '../../shared/flows-types'
import type { Repo } from '../../shared/types'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'
import { collectUntrackedAdditions, parseNumstat } from '../../shared/git-uncommitted-line-stats'
import { gitExecFileAsync } from '../git/runner'
import { gitOptionsForWorktree } from '../git/git-runtime-options'

export type FlowNodeDiffStatCollector = (args: {
  workspaceId: string | null
  /** Node config base branch; without it only uncommitted work is measurable. */
  baseBranch?: string | null
}) => Promise<FlowNodeDiffStat | null>

/** Keeps a runaway workspace (generated assets, node_modules) from stalling a run. */
const MAX_UNTRACKED_FILES = 200
const GIT_TIMEOUT_MS = 10_000

export function createFlowNodeDiffStatCollector(
  getRepo: (repoId: string) => Repo | undefined
): FlowNodeDiffStatCollector {
  return async ({ workspaceId, baseBranch }) => {
    const parsed = workspaceId ? splitWorktreeIdForFilesystem(workspaceId) : null
    if (!parsed?.worktreePath) {
      return null
    }
    const repo = getRepo(parsed.repoId)
    // Why: a connection-backed repo's path lives on the remote host, so a local
    // git read would measure the wrong tree (or nothing at all).
    if (!repo || repo.connectionId) {
      return null
    }
    try {
      return await measureWorktreeDiff(parsed.worktreePath, baseBranch ?? null)
    } catch (error) {
      // A diff stat is decoration; never let it fail a node that succeeded.
      console.error('[flows] failed to collect node diff stat:', error)
      return null
    }
  }
}

async function measureWorktreeDiff(
  worktreePath: string,
  baseBranch: string | null
): Promise<FlowNodeDiffStat | null> {
  const gitOptions = { ...gitOptionsForWorktree(worktreePath), timeout: GIT_TIMEOUT_MS }
  const base = await resolveBaseRef(worktreePath, baseBranch)

  const tracked = await gitExecFileAsync(
    ['-c', 'core.quotePath=false', 'diff', '-z', '--numstat', '-M', '-C', base],
    gitOptions
  )
  let filesChanged = 0
  let insertions = 0
  let deletions = 0
  for (const stats of parseNumstat(tracked.stdout).values()) {
    filesChanged += 1
    insertions += stats.added ?? 0
    deletions += stats.removed ?? 0
  }

  // Agents mostly create files, which stay untracked until something commits
  // them — counting only tracked changes would report +0 on a real run.
  const untracked = await gitExecFileAsync(
    ['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'],
    gitOptions
  )
  const untrackedPaths = untracked.stdout.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED_FILES)
  for (const stats of (await collectUntrackedAdditions(worktreePath, untrackedPaths)).values()) {
    filesChanged += 1
    insertions += stats.added ?? 0
  }

  return filesChanged === 0 ? null : { filesChanged, insertions, deletions }
}

/**
 * Measures against the branch point when the node declares a base branch, so a
 * node that committed its work still reports it. Without one — or when the base
 * is not present locally — the worktree's own HEAD is the only honest floor,
 * which limits the count to uncommitted work.
 */
async function resolveBaseRef(worktreePath: string, baseBranch: string | null): Promise<string> {
  if (!baseBranch) {
    return 'HEAD'
  }
  try {
    const result = await gitExecFileAsync(['merge-base', 'HEAD', baseBranch], {
      ...gitOptionsForWorktree(worktreePath),
      timeout: GIT_TIMEOUT_MS
    })
    return result.stdout.trim() || 'HEAD'
  } catch {
    return 'HEAD'
  }
}
