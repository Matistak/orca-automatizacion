import type {
  Flow,
  FlowCreateInput,
  FlowNodeRun,
  FlowRun,
  FlowRunStatus,
  FlowSummary,
  FlowUpdateInput
} from '../../shared/flows-types'

/**
 * Storage boundary for node flows. Every consumer talks to this interface, never
 * to the underlying store — so swapping JsonFlowRepository for a future
 * SqliteFlowRepository is a one-line wiring change. Keep queries narrow and
 * explicit: each method must map cleanly to a single SELECT/INSERT.
 */
export type FlowRepository = {
  /** Lightweight list for the flows index — omits heavy node/edge payloads. */
  listFlowSummaries(): FlowSummary[]
  getFlow(id: string): Flow | undefined
  createFlow(input: FlowCreateInput): Flow
  updateFlow(id: string, patch: FlowUpdateInput): Flow
  deleteFlow(id: string): void

  /** Append a new run (with its frozen flowSnapshot) to history. */
  appendRun(run: FlowRun): FlowRun
  /** Patch a single node's result inside an existing run. */
  updateNodeRun(runId: string, nodeRun: FlowNodeRun): FlowRun
  /** Roll up a run's overall status once execution finishes. */
  updateRunStatus(runId: string, status: FlowRunStatus, completedAt: number | null): FlowRun
  listRunsByFlow(flowId: string, limit?: number): FlowRun[]
  getRun(runId: string): FlowRun | undefined
  /** Retention: keep the most recent `keep` runs for a flow, evict the rest. */
  pruneRuns(flowId: string, keep: number): void
}
