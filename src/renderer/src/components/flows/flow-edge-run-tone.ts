import type { FlowEdge, FlowNodeRun } from '../../../../shared/flows-types'
import { getFlowNodeTone } from './flow-run-presentation'

/** How an edge reads during a run: the branch it fed is live, took, failed, or never ran. */
export type FlowEdgeTone = 'idle' | 'active' | 'completed' | 'failed' | 'skipped'

/**
 * An edge is decorated by what happened at its *target*: the target starting is
 * proof the branch took. The source's own state only matters to tell "not yet
 * reached" (idle) apart from "reached but cut" (skipped).
 */
export function getFlowEdgeTone(
  edge: FlowEdge,
  nodeRunsByNodeId: ReadonlyMap<string, FlowNodeRun>
): FlowEdgeTone {
  const target = getFlowNodeTone(nodeRunsByNodeId.get(edge.target)?.status)
  switch (target) {
    case 'running':
      return 'active'
    case 'completed':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'skipped'
    case 'idle':
      return 'idle'
  }
}
