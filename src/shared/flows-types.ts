import type { SetupDecision, TuiAgent } from './types'
import type {
  AutomationRunOutputSnapshot,
  AutomationRunStatus,
  AutomationRunUsage,
  AutomationWorkspaceMode
} from './automations-types'

/**
 * Data model for node flows — a DAG of actions layered on Orca's automations.
 * This file is the entry point for the whole feature; the pieces that read it:
 *
 * - Storage: `main/flows/flow-repository.ts` is the only boundary anything talks
 *   to. `JsonFlowRepository` implements it over the JSON store;
 *   `SqliteFlowRepository` is a spike proving the swap is a wiring change.
 * - Validation: `shared/flow-graph.ts` (`validateFlowGraph`) — one definition of
 *   "runnable", shared by the editor banner, the engine and the scheduler.
 * - Execution: `main/flows/flow-execution-engine.ts` walks the graph and writes a
 *   FlowNodeRun per node; per-kind side effects live behind FlowNodeDispatcher
 *   (shell in main, agent via the renderer, or headless in serve mode).
 * - Scheduling: `main/flows/flow-scheduler-service.ts` derives due occurrences
 *   from the trigger node (`shared/flow-schedule.ts`) — nothing is persisted.
 * - Sharing: `shared/flow-portable-document.ts` is the portable export envelope.
 *
 * Two invariants hold the design together: `position` is editor-only (the backend
 * never reads coordinates), and every FlowRun carries a frozen `flowSnapshot` so
 * history stays interpretable after the flow is edited.
 */

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

export type FlowPromptMarkdownFile = {
  path: string
  name: string
}

/** Discriminated by kind; each variant mirrors an existing automation payload. */
export type FlowNodeConfig =
  | {
      kind: 'trigger-schedule'
      rrule: string
      dtstart: number
      timezone: string
      /** How late an occurrence may still fire; past it the run is skipped_missed. */
      missedRunGraceMinutes?: number
    }
  | { kind: 'trigger-manual' }
  | {
      kind: 'agent-prompt'
      agentId: TuiAgent
      prompt: string
      /** Markdown instruction files attached to the node; their contents are
       *  inlined into the dispatched prompt at run time. */
      markdownFiles?: FlowPromptMarkdownFile[]
      /** Standing rules prepended to the prompt. */
      rules?: string
      workspaceMode: AutomationWorkspaceMode
      /** Repo the run targets; required when workspaceMode is 'new_per_run'. */
      projectId?: string | null
      workspaceId?: string | null
      baseBranch?: string | null
      setupDecision?: SetupDecision
      reuseSession?: boolean
    }
  | {
      kind: 'shell-command'
      command: string
      timeoutSeconds: number
      /** Where to run; falls back to the workspace an upstream node produced. */
      workspaceId?: string | null
      /** When false the node completes on any exit code so a downstream
       *  condition can branch on it instead of the flow cutting short. */
      failOnNonZeroExit?: boolean
    }
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

export type FlowRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  /** Scheduled occurrence Orca was not running for, past its grace window. */
  | 'skipped_missed'

export type FlowRunTrigger = 'scheduled' | 'manual'

/** Per-node result within a run; reuses the automation run vocabulary. */
/** Lines/files the node left in its workspace, measured when it finished. */
export type FlowNodeDiffStat = {
  filesChanged: number
  insertions: number
  deletions: number
}

export type FlowNodeRun = {
  nodeId: string
  status: AutomationRunStatus
  output: AutomationRunOutputSnapshot | null
  usage: AutomationRunUsage | null
  workspaceId?: string | null
  /** Frozen so history stays readable after the workspace is deleted. */
  workspaceDisplayName?: string | null
  exitCode?: number | null
  diffStat?: FlowNodeDiffStat | null
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
  /** The schedule occurrence this run belongs to; the scheduler's dedupe key. */
  scheduledFor?: number
  nodeRuns: FlowNodeRun[]
  startedAt: number
  completedAt: number | null
  runNumber?: number
  /** Why a scheduled run never executed (missed window, unavailable target). */
  error?: string | null
}

// ─── Dispatch bridge (main ⇄ renderer) ──────────────────────────────

/**
 * Sent to the renderer for node kinds it must execute (agent-prompt), because
 * launching an agent needs the workspace/terminal machinery that only lives
 * there. Mirrors AutomationDispatchRequest.
 */
export type FlowNodeDispatchRequest = {
  flowId: string
  flowName: string
  flowRunId: string
  runNumber: number | null
  nodeId: string
  /** Config already interpolated with upstream node results. */
  node: FlowNode
  trigger: FlowRunTrigger
  dispatchToken: string
}

/** Renderer → main progress/result for one dispatched node. */
export type FlowNodeDispatchResult = {
  flowRunId: string
  nodeId: string
  status: AutomationRunStatus
  workspaceId?: string | null
  workspaceDisplayName?: string | null
  terminalSessionId?: string | null
  terminalPaneKey?: string | null
  terminalPtyId?: string | null
  outputSnapshot?: AutomationRunOutputSnapshot | null
  usage?: AutomationRunUsage | null
  error?: string | null
}

/** Broadcast whenever a run is created or any of its node runs changes. */
export type FlowRunUpdatedEvent = {
  run: FlowRun
}

/** Statuses a run can never leave; only these are safe to evict from history. */
export function isFinalFlowRunStatus(status: FlowRunStatus): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'skipped' ||
    status === 'skipped_missed'
  )
}
