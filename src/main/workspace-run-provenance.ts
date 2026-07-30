import type {
  Repo,
  SystemRunWorkspaceProvenance,
  SystemRunWorkspaceProvenanceRequest
} from '../shared/types'
import type { AutomationWorkspaceProvenanceAuthority } from './automations/workspace-provenance'
import { resolveAutomationWorkspaceProvenance } from './automations/workspace-provenance'
import type { FlowWorkspaceProvenanceAuthority } from './flows/flow-workspace-provenance'
import { resolveFlowWorkspaceProvenance } from './flows/flow-workspace-provenance'

export type SystemRunProvenanceAuthority = AutomationWorkspaceProvenanceAuthority &
  FlowWorkspaceProvenanceAuthority

/**
 * Single entry point for the worktree-create handlers: routes a provenance
 * request to the authority that can prove it (a persisted Automation, or a live
 * flow run). Both mint into `Worktree.automationProvenance`.
 */
export function resolveSystemRunWorkspaceProvenance(args: {
  authority: SystemRunProvenanceAuthority
  repoSelector: string
  repo: Repo
  request: SystemRunWorkspaceProvenanceRequest | undefined
}): SystemRunWorkspaceProvenance | undefined {
  const { request } = args
  if (!request) {
    return undefined
  }
  if (request.kind === 'flow') {
    return resolveFlowWorkspaceProvenance({ ...args, request })
  }
  return resolveAutomationWorkspaceProvenance({ ...args, request })
}
