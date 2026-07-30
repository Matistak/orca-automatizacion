import type {
  AutomationRunOutputSnapshot,
  AutomationRunStatus,
  AutomationRunUsage
} from '../../shared/automations-types'
import type { FlowNode } from '../../shared/flows-types'

/**
 * Outcome of executing a single node. Mirrors the automation run vocabulary so a
 * FlowNodeRun can be built from it directly. `exitCode` is what a `condition`
 * node branches on; agent nodes leave it null.
 */
export type FlowNodeResult = {
  status: AutomationRunStatus
  output: AutomationRunOutputSnapshot | null
  usage: AutomationRunUsage | null
  exitCode: number | null
  terminalSessionId: string | null
  terminalPaneKey: string | null
  terminalPtyId: string | null
  error: string | null
}

/** Accumulated results of already-executed nodes, keyed by node id. */
export type FlowExecutionContext = {
  flowRunId: string
  results: ReadonlyMap<string, FlowNodeResult>
  /** The most recently executed node, for `{{previous.*}}` interpolation. */
  previousNodeId: string | null
}

/**
 * The engine delegates the actual side-effecting work (launching an agent,
 * running a shell command) to a dispatcher. Keeping this behind an interface is
 * what makes FlowExecutionEngine testable without a renderer or a real shell —
 * `condition` and `trigger-*` nodes never reach here (the engine resolves them).
 */
export type FlowNodeDispatcher = {
  dispatchNode(args: {
    node: FlowNode
    /** Node config with any `{{...}}` tokens already interpolated. */
    context: FlowExecutionContext
  }): Promise<FlowNodeResult>
}
