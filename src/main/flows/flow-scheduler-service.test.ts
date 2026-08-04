import { describe, expect, it, vi } from 'vitest'
import { FLOW_SCHEMA_VERSION, type Flow, type FlowRun } from '../../shared/flows-types'
import type { Repo } from '../../shared/types'
import { nextFlowOccurrenceAfter } from '../../shared/flow-schedule'
import { FlowSchedulerService } from './flow-scheduler-service'
import type { FlowRunService } from './flow-run-service'
import { JsonFlowRepository } from './json-flow-repository'
import type { FlowStoreBackend } from './flow-store-backend'

class FakeBackend implements FlowStoreBackend {
  flows: Flow[] = []
  flowRuns: FlowRun[] = []
  readFlows(): Flow[] {
    return this.flows
  }
  writeFlows(flows: Flow[]): void {
    this.flows = flows
  }
  readFlowRuns(): FlowRun[] {
    return this.flowRuns
  }
  writeFlowRuns(runs: FlowRun[]): void {
    this.flowRuns = runs
  }
}

const HOUR_MS = 60 * 60 * 1000

/** Daily at 09:00 UTC, with a workspace-less agent node so nothing is dispatched. */
function makeScheduledFlow(overrides: Partial<Flow> = {}): Flow {
  const dtstart = Date.UTC(2026, 0, 1, 9, 0, 0)
  return {
    id: 'flow-1',
    name: 'Nightly audit',
    nodes: [
      {
        id: 'trigger',
        config: { kind: 'trigger-schedule', rrule: '0 9 * * *', dtstart, timezone: 'UTC' },
        position: { x: 0, y: 0 }
      },
      {
        id: 'shell',
        config: {
          kind: 'shell-command',
          command: 'echo hi',
          timeoutSeconds: 30,
          workspaceId: 'repo-1::/tmp/ws'
        },
        position: { x: 200, y: 0 }
      }
    ],
    edges: [{ id: 'e1', source: 'trigger', target: 'shell' }],
    enabled: true,
    schemaVersion: FLOW_SCHEMA_VERSION,
    createdAt: dtstart,
    updatedAt: dtstart,
    ...overrides
  }
}

type RunServiceStub = {
  service: FlowRunService
  runScheduled: ReturnType<typeof vi.fn>
  recordUnexecutedRun: ReturnType<typeof vi.fn>
  running: Set<string>
}

function makeRunService(repository: JsonFlowRepository, backend: FakeBackend): RunServiceStub {
  const running = new Set<string>()
  const runScheduled = vi.fn(async (flowId: string, scheduledFor: number) => {
    const run = repository.appendRun({
      id: `run-${backend.flowRuns.length + 1}`,
      flowId,
      flowSnapshot: repository.getFlow(flowId)!,
      status: 'completed',
      trigger: 'scheduled',
      scheduledFor,
      nodeRuns: [],
      startedAt: scheduledFor,
      completedAt: scheduledFor
    })
    return run
  })
  const recordUnexecutedRun = vi.fn(
    (args: { flow: Flow; scheduledFor: number; status: FlowRun['status']; error: string }) =>
      repository.appendRun({
        id: `run-${backend.flowRuns.length + 1}`,
        flowId: args.flow.id,
        flowSnapshot: args.flow,
        status: args.status,
        trigger: 'scheduled',
        scheduledFor: args.scheduledFor,
        nodeRuns: [],
        startedAt: args.scheduledFor,
        completedAt: args.scheduledFor,
        error: args.error
      })
  )
  const service = {
    runRepository: repository,
    isRunning: (flowId: string) => running.has(flowId),
    runScheduled,
    recordUnexecutedRun
  } as unknown as FlowRunService
  return { service, runScheduled, recordUnexecutedRun, running }
}

function localRepo(): Repo {
  return { id: 'repo-1', name: 'demo', path: '/tmp/demo' } as unknown as Repo
}

/** Cron is evaluated in the host's local time, so derive the slot, don't hardcode it. */
function firstOccurrenceOf(flow: Flow): number {
  // A manual-only flow has none; fall back to its creation time as the clock.
  return nextFlowOccurrenceAfter(flow, flow.createdAt) ?? flow.createdAt
}

function setup(flow: Flow = makeScheduledFlow()) {
  const backend = new FakeBackend()
  backend.flows = [flow]
  const repository = new JsonFlowRepository(backend)
  const stub = makeRunService(repository, backend)
  const scheduler = new FlowSchedulerService(stub.service, {
    getRepo: () => localRepo()
  })
  return { backend, repository, scheduler, occurrence: firstOccurrenceOf(flow), ...stub }
}

describe('FlowSchedulerService', () => {
  it('runs a flow whose occurrence has come due', async () => {
    const { scheduler, runScheduled, occurrence } = setup()
    await scheduler.evaluateDueFlows(occurrence + 60_000)
    expect(runScheduled).toHaveBeenCalledWith('flow-1', occurrence)
  })

  it('does not run the same occurrence twice', async () => {
    const { scheduler, runScheduled, occurrence } = setup()
    await scheduler.evaluateDueFlows(occurrence + 60_000)
    await scheduler.evaluateDueFlows(occurrence + 120_000)
    expect(runScheduled).toHaveBeenCalledTimes(1)
  })

  it('fires the next occurrence after one already ran', async () => {
    const { scheduler, runScheduled, occurrence } = setup()
    await scheduler.evaluateDueFlows(occurrence + 60_000)
    await scheduler.evaluateDueFlows(occurrence + 24 * HOUR_MS + 60_000)
    expect(runScheduled).toHaveBeenCalledTimes(2)
    expect(runScheduled.mock.calls[1]?.[1]).toBe(occurrence + 24 * HOUR_MS)
  })

  it('skips an occurrence older than the grace window', async () => {
    const { scheduler, runScheduled, recordUnexecutedRun, occurrence } = setup()
    // Default grace is 12h; evaluate 13h late but before the next occurrence.
    await scheduler.evaluateDueFlows(occurrence + 13 * HOUR_MS)
    expect(runScheduled).not.toHaveBeenCalled()
    expect(recordUnexecutedRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped_missed', scheduledFor: occurrence })
    )
  })

  it('honours a per-flow grace window', async () => {
    const flow = makeScheduledFlow()
    flow.nodes[0]!.config = {
      kind: 'trigger-schedule',
      rrule: '0 9 * * *',
      dtstart: flow.createdAt,
      timezone: 'UTC',
      missedRunGraceMinutes: 30
    }
    const { scheduler, runScheduled, recordUnexecutedRun, occurrence } = setup(flow)
    await scheduler.evaluateDueFlows(occurrence + 45 * 60 * 1000)
    expect(runScheduled).not.toHaveBeenCalled()
    expect(recordUnexecutedRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped_missed' })
    )
  })

  it('leaves a disabled flow alone', async () => {
    const { scheduler, runScheduled, recordUnexecutedRun, occurrence } = setup(
      makeScheduledFlow({ enabled: false })
    )
    await scheduler.evaluateDueFlows(occurrence + 60_000)
    expect(runScheduled).not.toHaveBeenCalled()
    expect(recordUnexecutedRun).not.toHaveBeenCalled()
  })

  it('leaves a manual-only flow alone', async () => {
    const flow = makeScheduledFlow()
    const occurrence = firstOccurrenceOf(flow)
    flow.nodes[0]!.config = { kind: 'trigger-manual' }
    const { scheduler, runScheduled } = setup(flow)

    await scheduler.evaluateDueFlows(occurrence + 60_000)
    expect(runScheduled).not.toHaveBeenCalled()
  })

  it('leaves an invalid graph alone instead of failing a run every tick', async () => {
    const flow = makeScheduledFlow()
    // Empty command → validateFlowGraph reports a config error.
    flow.nodes[1]!.config = { kind: 'shell-command', command: '   ', timeoutSeconds: 30 }
    const { scheduler, runScheduled, recordUnexecutedRun, occurrence } = setup(flow)
    await scheduler.evaluateDueFlows(occurrence + 60_000)
    expect(runScheduled).not.toHaveBeenCalled()
    expect(recordUnexecutedRun).not.toHaveBeenCalled()
  })

  it('does not start a flow that is already running', async () => {
    const { scheduler, runScheduled, running, occurrence } = setup()
    running.add('flow-1')
    await scheduler.evaluateDueFlows(occurrence + 60_000)
    expect(runScheduled).not.toHaveBeenCalled()
  })

  it('never overlaps two ticks', async () => {
    const { scheduler, runScheduled, occurrence } = setup()
    let release: () => void = () => {}
    runScheduled.mockImplementation(
      (async () =>
        await new Promise<void>((resolve) => {
          release = resolve
        })) as never
    )
    const first = scheduler.evaluateDueFlows(occurrence + 60_000)
    await scheduler.evaluateDueFlows(occurrence + 61_000)
    expect(runScheduled).toHaveBeenCalledTimes(1)
    release()
    await first
  })

  it('skips a flow whose work lands on a remote runtime host', async () => {
    const backend = new FakeBackend()
    const flow = makeScheduledFlow()
    flow.nodes[1]!.config = {
      kind: 'shell-command',
      command: 'echo hi',
      timeoutSeconds: 30,
      workspaceId: 'repo-remote::/srv/ws'
    }
    backend.flows = [flow]
    const occurrence = firstOccurrenceOf(flow)
    const repository = new JsonFlowRepository(backend)
    const stub = makeRunService(repository, backend)
    const scheduler = new FlowSchedulerService(stub.service, {
      getRepo: () =>
        ({
          id: 'repo-remote',
          name: 'remote',
          path: '/srv/ws',
          executionHostId: 'runtime:env-1'
        }) as unknown as Repo
    })
    await scheduler.evaluateDueFlows(occurrence + 60_000)
    expect(stub.runScheduled).not.toHaveBeenCalled()
    expect(stub.recordUnexecutedRun).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped' })
    )
  })
})
