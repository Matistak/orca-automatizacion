import { isFinalAutomationRunStatus } from '../../shared/automations-types'
import { buildFlowWorkspaceProvenance } from '../../shared/flow-workspace-provenance'
import type { FlowRun } from '../../shared/flows-types'
import type {
  FlowWorkspaceProvenance,
  FlowWorkspaceProvenanceRequest,
  Repo
} from '../../shared/types'
import { getRepoIdFromWorktreeId } from '../../shared/worktree-id'
import { beginAutomationDispatchTokenUse } from '../automations/dispatch-tokens'
import { invalidAutomationProvenanceRequest } from '../automations/workspace-provenance'

export type FlowWorkspaceProvenanceAuthority = {
  getFlowRun: (runId: string) => FlowRun | undefined
}

function repoSelectorMatches(selector: string, repoId: string): boolean {
  return selector === repoId || selector === `id:${repoId}`
}

/**
 * Flow-side twin of resolveAutomationWorkspaceProvenance. A flow node is not a
 * persisted Automation, so the live FlowRun is the authority: the run must be
 * in flight, the frozen snapshot must still contain a new-per-run agent node
 * with that id, and that node must not have finished yet.
 */
export function resolveFlowWorkspaceProvenance(args: {
  authority: FlowWorkspaceProvenanceAuthority
  repoSelector: string
  repo: Repo
  request: FlowWorkspaceProvenanceRequest
}): FlowWorkspaceProvenance {
  const { authority, repoSelector, repo, request } = args
  const run = authority.getFlowRun(request.flowRunId)
  if (!run || run.flowId !== request.flowId || run.status !== 'running') {
    invalidAutomationProvenanceRequest()
  }

  const node = run.flowSnapshot.nodes.find((entry) => entry.id === request.nodeId)
  if (!node || node.config.kind !== 'agent-prompt' || node.config.workspaceMode !== 'new_per_run') {
    invalidAutomationProvenanceRequest()
  }

  // Why: a node that already reached a terminal status must never mint another
  // workspace — that is the leak a replayed request would cause.
  const nodeRun = run.nodeRuns.find((entry) => entry.nodeId === request.nodeId)
  if (nodeRun && isFinalAutomationRunStatus(nodeRun.status)) {
    invalidAutomationProvenanceRequest()
  }

  const projectId =
    node.config.projectId ??
    (node.config.workspaceId ? getRepoIdFromWorktreeId(node.config.workspaceId) : null)
  if (!projectId || !repoSelectorMatches(repoSelector, projectId)) {
    invalidAutomationProvenanceRequest()
  }

  if (
    !beginAutomationDispatchTokenUse({
      automationId: request.flowId,
      runId: request.flowRunId,
      token: request.dispatchToken,
      reservationId: request.createRequestId
    })
  ) {
    invalidAutomationProvenanceRequest()
  }

  return buildFlowWorkspaceProvenance({ run, node, projectId, repo })
}
