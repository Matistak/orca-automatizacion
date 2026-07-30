import type { SetupDecision, TuiAgent } from './types'
import type {
  AutomationRunOutputSnapshot,
  AutomationRunStatus,
  AutomationRunUsage,
  AutomationWorkspaceMode
} from './automations-types'

/** Bump when the on-disk shape of a Flow/FlowRun changes; drives migrateFlow. */
export const FLOW_SCHEMA_VERSION = 1

// ─── Nodes ──────────────────────────────────────────────────────────

export type FlowNodeKind =
  | 'trigger-schedule'
  | 'trigger-manual'
  | 'agent-prompt'
  | 'shell-command'
  | 'condition'

export type FlowConditionSource = 'exit-code' | 'output-contains'

/** How a condition node branches on the previous node's result. */
export type FlowConditionExpression =
  | { source: 'exit-code'; equals: number }
  | { source: 'output-contains'; substring: string; caseSensitive?: boolean }

/** Discriminated by kind; each variant mirrors an existing automation payload. */
export type FlowNodeConfig =
  | { kind: 'trigger-schedule'; rrule: string; dtstart: number; timezone: string }
  | { kind: 'trigger-manual' }
  | {
      kind: 'agent-prompt'
      agentId: TuiAgent
      prompt: string
      workspaceMode: AutomationWorkspaceMode
      workspaceId?: string | null
      baseBranch?: string | null
      setupDecision?: SetupDecision
      reuseSession?: boolean
    }
  | { kind: 'shell-command'; command: string; timeoutSeconds: number }
  | { kind: 'condition'; expression: FlowConditionExpression }

export type FlowNode = {
  id: string
  config: FlowNodeConfig
  /** Editor-only canvas coordinates; the execution engine never reads these. */
  position: { x: number; y: number }
  label?: string
}

export type FlowEdge = {
  id: string
  source: string
  /** Named output on a branching node, e.g. 'true' | 'false' on a condition. */
  sourceHandle?: string
  target: string
}

// ─── Flow ───────────────────────────────────────────────────────────

export type Flow = {
  id: string
  name: string
  description?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  /** Gates whether trigger-schedule nodes are eligible to fire. */
  enabled: boolean
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

export type FlowSummary = {
  id: string
  name: string
  description?: string
  enabled: boolean
  nodeCount: number
  updatedAt: number
  lastRunAt?: number
  nextRunAt?: number
}

export type FlowCreateInput = {
  name: string
  description?: string
  nodes?: FlowNode[]
  edges?: FlowEdge[]
  enabled?: boolean
}

export type FlowUpdateInput = Partial<
  Pick<Flow, 'name' | 'description' | 'nodes' | 'edges' | 'enabled'>
>

// ─── Runs ───────────────────────────────────────────────────────────

export type FlowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type FlowRunTrigger = 'scheduled' | 'manual'

/** Per-node result within a run; reuses the automation run vocabulary. */
export type FlowNodeRun = {
  nodeId: string
  status: AutomationRunStatus
  output: AutomationRunOutputSnapshot | null
  usage: AutomationRunUsage | null
  terminalSessionId: string | null
  terminalPaneKey: string | null
  terminalPtyId: string | null
  error: string | null
  startedAt: number | null
  completedAt: number | null
}

export type FlowRun = {
  id: string
  flowId: string
  /** Why: the graph is frozen at dispatch time so run history stays interpretable
   *  after the flow is later edited. Mirrors how automation runs freeze
   *  workspaceDisplayName. */
  flowSnapshot: Flow
  status: FlowRunStatus
  trigger: FlowRunTrigger
  nodeRuns: FlowNodeRun[]
  startedAt: number
  completedAt: number | null
  runNumber?: number
}

/** Statuses a run can never leave; only these are safe to evict from history. */
export function isFinalFlowRunStatus(status: FlowRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'skipped'
}
