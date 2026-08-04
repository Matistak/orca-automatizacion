import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  FLOW_SCHEMA_VERSION,
  type Flow,
  type FlowCreateInput,
  type FlowEdge,
  type FlowNode,
  type FlowNodeRun,
  type FlowRun,
  type FlowRunStatus,
  type FlowRunTrigger,
  type FlowSummary,
  type FlowUpdateInput
} from '../../shared/flows-types'
import { MAX_FLOW_RUNS_PER_FLOW } from '../../shared/flow-run-retention'
import { isFlowScheduleEligible, nextFlowOccurrenceAfter } from '../../shared/flow-schedule'
import type { FlowRepository } from './flow-repository'

/**
 * SQLite-backed FlowRepository — a **spike**, not wired into the app. It exists
 * to prove the FlowRepository boundary is really storage-agnostic: it runs the
 * same contract suite as JsonFlowRepository (flow-repository-contract.test.ts).
 * Adopting it later is a wiring change in flow-services.ts, nothing more.
 *
 * Why `node:sqlite` and not better-sqlite3: the built-in module ships with Node,
 * so the spike adds no native dependency and cannot break the Linux glibc floor
 * (docs/reference/linux-glibc-compatibility.md). Only adopt a real driver once
 * there is evidence the JSON store does not perform.
 *
 * Shape notes for a future migration:
 * - One row per flow, one row per run; nodes/edges/nodeRuns/flowSnapshot stay
 *   JSON columns. They are always read and written whole, so splitting them into
 *   tables would buy nothing and cost joins.
 * - Every query below is the SELECT/INSERT the interface method promised — no
 *   "load everything and filter in memory" except listFlowSummaries, which needs
 *   the full graph to derive nextRunAt from the trigger node.
 */
export class SqliteFlowRepository implements FlowRepository {
  private readonly db: DatabaseSync

  /** Defaults to an in-memory database, which is what the contract suite uses. */
  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS flows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        nodes TEXT NOT NULL,
        edges TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS flow_runs (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        flow_snapshot TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger_kind TEXT NOT NULL,
        scheduled_for INTEGER,
        node_runs TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        run_number INTEGER,
        error TEXT,
        is_final INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS flow_runs_by_flow ON flow_runs (flow_id, started_at DESC);
    `)
  }

  close(): void {
    this.db.close()
  }

  // ─── Flows ────────────────────────────────────────────────────────

  listFlowSummaries(): FlowSummary[] {
    const now = Date.now()
    return this.db
      .prepare(
        `SELECT f.*, (SELECT MAX(started_at) FROM flow_runs r WHERE r.flow_id = f.id) AS last_run_at
         FROM flows f ORDER BY f.name`
      )
      .all()
      .map((row) => {
        const flow = rowToFlow(row)
        const lastRunAt = row.last_run_at
        return {
          id: flow.id,
          name: flow.name,
          description: flow.description,
          enabled: flow.enabled,
          nodeCount: flow.nodes.length,
          updatedAt: flow.updatedAt,
          lastRunAt: typeof lastRunAt === 'number' ? lastRunAt : undefined,
          nextRunAt: isFlowScheduleEligible(flow)
            ? (nextFlowOccurrenceAfter(flow, now) ?? undefined)
            : undefined
        }
      })
  }

  getFlow(id: string): Flow | undefined {
    const row = this.db.prepare('SELECT * FROM flows WHERE id = ?').get(id)
    return row ? rowToFlow(row) : undefined
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
    this.db
      .prepare(
        `INSERT INTO flows (id, name, description, nodes, edges, enabled, schema_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        flow.id,
        flow.name,
        flow.description ?? null,
        JSON.stringify(flow.nodes),
        JSON.stringify(flow.edges),
        flow.enabled ? 1 : 0,
        flow.schemaVersion,
        flow.createdAt,
        flow.updatedAt
      )
    return flow
  }

  updateFlow(id: string, patch: FlowUpdateInput): Flow {
    const current = this.getFlow(id)
    if (!current) {
      throw new Error('Flow not found.')
    }
    const updated: Flow = {
      ...current,
      ...patch,
      name: patch.name !== undefined ? patch.name.trim() || 'Untitled flow' : current.name,
      updatedAt: Date.now()
    }
    this.db
      .prepare(
        `UPDATE flows SET name = ?, description = ?, nodes = ?, edges = ?, enabled = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        updated.name,
        updated.description ?? null,
        JSON.stringify(updated.nodes),
        JSON.stringify(updated.edges),
        updated.enabled ? 1 : 0,
        updated.updatedAt,
        id
      )
    return updated
  }

  deleteFlow(id: string): void {
    // Cascade by hand: the runs table intentionally has no FK so history can
    // outlive a flow row during a migration.
    this.db.prepare('DELETE FROM flow_runs WHERE flow_id = ?').run(id)
    this.db.prepare('DELETE FROM flows WHERE id = ?').run(id)
  }

  // ─── Runs ─────────────────────────────────────────────────────────

  appendRun(run: FlowRun): FlowRun {
    const runNumber = run.runNumber ?? this.nextRunNumber(run.flowId)
    const stamped: FlowRun = { ...run, runNumber }
    this.db
      .prepare(
        `INSERT INTO flow_runs (id, flow_id, flow_snapshot, status, trigger_kind, scheduled_for,
           node_runs, started_at, completed_at, run_number, error, is_final)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        stamped.id,
        stamped.flowId,
        JSON.stringify(stamped.flowSnapshot),
        stamped.status,
        stamped.trigger,
        stamped.scheduledFor ?? null,
        JSON.stringify(stamped.nodeRuns),
        stamped.startedAt,
        stamped.completedAt,
        runNumber,
        stamped.error ?? null,
        isFinalStatus(stamped.status)
      )
    this.pruneRuns(stamped.flowId, MAX_FLOW_RUNS_PER_FLOW)
    return stamped
  }

  updateNodeRun(runId: string, nodeRun: FlowNodeRun): FlowRun {
    const current = this.requireRun(runId)
    const nodeRuns = current.nodeRuns.some((entry) => entry.nodeId === nodeRun.nodeId)
      ? current.nodeRuns.map((entry) => (entry.nodeId === nodeRun.nodeId ? nodeRun : entry))
      : [...current.nodeRuns, nodeRun]
    this.db
      .prepare('UPDATE flow_runs SET node_runs = ? WHERE id = ?')
      .run(JSON.stringify(nodeRuns), runId)
    return { ...current, nodeRuns }
  }

  updateRunStatus(runId: string, status: FlowRunStatus, completedAt: number | null): FlowRun {
    const current = this.requireRun(runId)
    this.db
      .prepare('UPDATE flow_runs SET status = ?, completed_at = ?, is_final = ? WHERE id = ?')
      .run(status, completedAt, isFinalStatus(status), runId)
    return { ...current, status, completedAt }
  }

  listRunsByFlow(flowId: string, limit?: number): FlowRun[] {
    const rows =
      limit === undefined
        ? this.db
            .prepare('SELECT * FROM flow_runs WHERE flow_id = ? ORDER BY started_at DESC')
            .all(flowId)
        : this.db
            .prepare('SELECT * FROM flow_runs WHERE flow_id = ? ORDER BY started_at DESC LIMIT ?')
            .all(flowId, limit)
    return rows.map(rowToRun)
  }

  getRun(runId: string): FlowRun | undefined {
    const row = this.db.prepare('SELECT * FROM flow_runs WHERE id = ?').get(runId)
    return row ? rowToRun(row) : undefined
  }

  findLatestScheduledRun(flowId: string): FlowRun | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM flow_runs WHERE flow_id = ? AND trigger_kind = 'scheduled'
         ORDER BY COALESCE(scheduled_for, started_at) DESC LIMIT 1`
      )
      .get(flowId)
    return row ? rowToRun(row) : undefined
  }

  pruneRuns(flowId: string, keep: number = MAX_FLOW_RUNS_PER_FLOW): void {
    // Only final runs are evictable — updateNodeRun on a live run must not hit a
    // missing row. `is_final` is denormalized so this stays one DELETE.
    this.db
      .prepare(
        `DELETE FROM flow_runs WHERE flow_id = ? AND is_final = 1 AND id NOT IN (
           SELECT id FROM flow_runs WHERE flow_id = ? AND is_final = 1
           ORDER BY started_at DESC LIMIT ?
         )`
      )
      .run(flowId, flowId, Math.max(0, keep))
  }

  /** Mirrors nextFlowRunNumber without materializing the rows. */
  private nextRunNumber(flowId: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS total, MAX(run_number) AS highest FROM flow_runs WHERE flow_id = ?'
      )
      .get(flowId)
    return Math.max((row?.total as number) ?? 0, (row?.highest as number | null) ?? 0) + 1
  }

  private requireRun(runId: string): FlowRun {
    const run = this.getRun(runId)
    if (!run) {
      throw new Error('Flow run not found.')
    }
    return run
  }
}

type SqlRow = Record<string, unknown>

function isFinalStatus(status: FlowRunStatus): number {
  return status === 'completed' || status === 'failed' || status.startsWith('skipped') ? 1 : 0
}

function rowToFlow(row: SqlRow): Flow {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? undefined,
    nodes: JSON.parse(row.nodes as string) as FlowNode[],
    edges: JSON.parse(row.edges as string) as FlowEdge[],
    enabled: row.enabled === 1,
    schemaVersion: row.schema_version as number,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number
  }
}

function rowToRun(row: SqlRow): FlowRun {
  const scheduledFor = row.scheduled_for as number | null
  const error = row.error as string | null
  return {
    id: row.id as string,
    flowId: row.flow_id as string,
    flowSnapshot: JSON.parse(row.flow_snapshot as string) as Flow,
    status: row.status as FlowRunStatus,
    trigger: row.trigger_kind as FlowRunTrigger,
    ...(scheduledFor === null ? {} : { scheduledFor }),
    nodeRuns: JSON.parse(row.node_runs as string) as FlowNodeRun[],
    startedAt: row.started_at as number,
    completedAt: row.completed_at as number | null,
    runNumber: (row.run_number as number | null) ?? undefined,
    ...(error === null ? {} : { error })
  }
}
