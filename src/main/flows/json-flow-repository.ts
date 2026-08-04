import { randomUUID } from 'node:crypto'
import {
  FLOW_SCHEMA_VERSION,
  type Flow,
  type FlowCreateInput,
  type FlowNodeRun,
  type FlowRun,
  type FlowRunStatus,
  type FlowSummary,
  type FlowUpdateInput
} from '../../shared/flows-types'
import {
  MAX_FLOW_RUNS_PER_FLOW,
  nextFlowRunNumber,
  pruneFlowRuns
} from '../../shared/flow-run-retention'
import { isFlowScheduleEligible, nextFlowOccurrenceAfter } from '../../shared/flow-schedule'
import type { FlowRepository } from './flow-repository'
import type { FlowStoreBackend } from './flow-store-backend'

/**
 * FlowRepository backed by the JSON persistence store. Owns the whole-array
 * read/mutate/write logic; the backend only exposes the raw slots.
 */
export class JsonFlowRepository implements FlowRepository {
  constructor(private readonly backend: FlowStoreBackend) {}

  listFlowSummaries(): FlowSummary[] {
    const runs = this.backend.readFlowRuns()
    const now = Date.now()
    return this.backend
      .readFlows()
      .map((flow) => {
        const flowRuns = runs.filter((run) => run.flowId === flow.id)
        const lastRunAt = flowRuns.reduce<number | undefined>(
          (latest, run) => (latest === undefined ? run.startedAt : Math.max(latest, run.startedAt)),
          undefined
        )
        return {
          id: flow.id,
          name: flow.name,
          description: flow.description,
          enabled: flow.enabled,
          nodeCount: flow.nodes.length,
          updatedAt: flow.updatedAt,
          lastRunAt,
          nextRunAt: isFlowScheduleEligible(flow)
            ? (nextFlowOccurrenceAfter(flow, now) ?? undefined)
            : undefined
        }
      })
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  getFlow(id: string): Flow | undefined {
    return this.backend.readFlows().find((flow) => flow.id === id)
  }

  createFlow(input: FlowCreateInput): Flow {
    const now = Date.now()
    const flow: Flow = {
      id: randomUUID(),
      name: input.name.trim() || 'Untitled flow',
      description: input.description,
      nodes: input.nodes ?? [],
      edges: input.edges ?? [],
      enabled: input.enabled ?? false,
      schemaVersion: FLOW_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now
    }
    this.backend.writeFlows([...this.backend.readFlows(), flow])
    return flow
  }

  updateFlow(id: string, patch: FlowUpdateInput): Flow {
    const flows = this.backend.readFlows()
    const index = flows.findIndex((flow) => flow.id === id)
    if (index === -1) {
      throw new Error('Flow not found.')
    }
    const current = flows[index]!
    const updated: Flow = {
      ...current,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() || 'Untitled flow' : current.name,
      updatedAt: Date.now()
    }
    const next = [...flows]
    next[index] = updated
    this.backend.writeFlows(next)
    return updated
  }

  deleteFlow(id: string): void {
    this.backend.writeFlows(this.backend.readFlows().filter((flow) => flow.id !== id))
    this.backend.writeFlowRuns(this.backend.readFlowRuns().filter((run) => run.flowId !== id))
  }

  appendRun(run: FlowRun): FlowRun {
    const runs = this.backend.readFlowRuns()
    const runNumber =
      run.runNumber ?? nextFlowRunNumber(runs.filter((entry) => entry.flowId === run.flowId))
    const stamped: FlowRun = { ...run, runNumber }
    this.backend.writeFlowRuns(pruneFlowRuns([...runs, stamped]))
    return stamped
  }

  updateNodeRun(runId: string, nodeRun: FlowNodeRun): FlowRun {
    const runs = this.backend.readFlowRuns()
    const index = runs.findIndex((run) => run.id === runId)
    if (index === -1) {
      throw new Error('Flow run not found.')
    }
    const current = runs[index]!
    const nodeRuns = current.nodeRuns.some((entry) => entry.nodeId === nodeRun.nodeId)
      ? current.nodeRuns.map((entry) => (entry.nodeId === nodeRun.nodeId ? nodeRun : entry))
      : [...current.nodeRuns, nodeRun]
    const updated: FlowRun = { ...current, nodeRuns }
    const next = [...runs]
    next[index] = updated
    this.backend.writeFlowRuns(next)
    return updated
  }

  updateRunStatus(runId: string, status: FlowRunStatus, completedAt: number | null): FlowRun {
    const runs = this.backend.readFlowRuns()
    const index = runs.findIndex((run) => run.id === runId)
    if (index === -1) {
      throw new Error('Flow run not found.')
    }
    const updated: FlowRun = { ...runs[index]!, status, completedAt }
    const next = [...runs]
    next[index] = updated
    this.backend.writeFlowRuns(next)
    return updated
  }

  listRunsByFlow(flowId: string, limit?: number): FlowRun[] {
    const sorted = this.backend
      .readFlowRuns()
      .filter((run) => run.flowId === flowId)
      .sort((left, right) => right.startedAt - left.startedAt)
    return limit === undefined ? sorted : sorted.slice(0, limit)
  }

  getRun(runId: string): FlowRun | undefined {
    return this.backend.readFlowRuns().find((run) => run.id === runId)
  }

  findLatestScheduledRun(flowId: string): FlowRun | undefined {
    return this.backend
      .readFlowRuns()
      .filter((run) => run.flowId === flowId && run.trigger === 'scheduled')
      .reduce<FlowRun | undefined>(
        (latest, run) =>
          latest === undefined ||
          (run.scheduledFor ?? run.startedAt) > (latest.scheduledFor ?? latest.startedAt)
            ? run
            : latest,
        undefined
      )
  }

  pruneRuns(flowId: string, keep: number = MAX_FLOW_RUNS_PER_FLOW): void {
    const runs = this.backend.readFlowRuns()
    const pruned = pruneFlowRuns(
      runs.filter((run) => run.flowId === flowId),
      keep
    )
    const keptIds = new Set(pruned.map((run) => run.id))
    this.backend.writeFlowRuns(runs.filter((run) => run.flowId !== flowId || keptIds.has(run.id)))
  }
}
