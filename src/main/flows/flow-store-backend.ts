import type { Flow, FlowRun } from '../../shared/flows-types'

/**
 * Narrow slot accessor that JsonFlowRepository needs from the JSON store. The
 * `Store` class implements this; keeping it minimal means the whole-array
 * read/mutate/write pattern lives in the repository, not the store. A future
 * SqliteFlowRepository does not use this at all.
 */
export type FlowStoreBackend = {
  readFlows(): Flow[]
  writeFlows(flows: Flow[]): void
  readFlowRuns(): FlowRun[]
  writeFlowRuns(runs: FlowRun[]): void
}
