import { isFinalFlowRunStatus, type FlowRun } from './flows-types'

export const MAX_FLOW_RUNS_PER_FLOW = 100

// Why: the whole state blob is re-serialized on every save, so unbounded flow
// runs would make each flush() permanently slower. Mirrors pruneAutomationRuns.
export function pruneFlowRuns(
  runs: readonly FlowRun[],
  maxPerFlow: number = MAX_FLOW_RUNS_PER_FLOW
): FlowRun[] {
  const kept = new Set<string>()
  // Why: a running flow's completion can land later, and updateNodeRun throws if
  // its row is gone — only final runs are evictable.
  const finalRuns = runs.filter((run) => isFinalFlowRunStatus(run.status))
  for (const flowRuns of Map.groupBy(finalRuns, (run) => run.flowId).values()) {
    flowRuns.sort((a, b) => b.startedAt - a.startedAt)
    // Why: clamp — a negative `slice` end drops from the tail instead of keeping nothing.
    for (const run of flowRuns.slice(0, Math.max(0, maxPerFlow))) {
      kept.add(run.id)
    }
  }

  // Survivors keep their original append order — callers index by position.
  return runs.filter((run) => kept.has(run.id) || !isFinalFlowRunStatus(run.status))
}

/** Next run number for one flow, given only the runs still retained. */
export function nextFlowRunNumber(runsForFlow: readonly FlowRun[]): number {
  // Why: seed with the count so runs that predate `runNumber` still advance.
  return runsForFlow.reduce((n, run) => Math.max(n, run.runNumber ?? 0), runsForFlow.length) + 1
}
