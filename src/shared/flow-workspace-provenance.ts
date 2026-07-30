import { getRepoExecutionHostId } from './execution-host'
import type { FlowNode, FlowRun } from './flows-types'
import type { FlowWorkspaceProvenance, Repo } from './types'

export function flowNodeProvenanceLabel(node: FlowNode): string {
  if (node.label?.trim()) {
    return node.label.trim()
  }
  return node.config.kind === 'agent-prompt' ? node.config.agentId : node.config.kind
}

export function buildFlowWorkspaceProvenance(args: {
  run: Pick<FlowRun, 'id' | 'flowId' | 'flowSnapshot' | 'runNumber'>
  node: FlowNode
  projectId: string
  repo: Repo
  createdAt?: number
}): FlowWorkspaceProvenance {
  const { run, node, projectId, repo } = args
  return {
    kind: 'created-by-flow',
    flowId: run.flowId,
    flowNameSnapshot: run.flowSnapshot.name,
    flowRunId: run.id,
    flowRunNumber: run.runNumber ?? null,
    nodeId: node.id,
    nodeLabelSnapshot: flowNodeProvenanceLabel(node),
    createdAt: args.createdAt ?? Date.now(),
    projectId,
    repoId: projectId,
    hostId: getRepoExecutionHostId(repo)
  }
}
