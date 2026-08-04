import type { Flow } from '../../shared/flows-types'
import {
  flowMissedRunGraceMs,
  isFlowScheduleEligible,
  latestFlowOccurrenceAtOrBefore
} from '../../shared/flow-schedule'
import type { Repo } from '../../shared/types'
import type { FlowRepository } from './flow-repository'
import type { FlowRunService } from './flow-run-service'
import { resolveFlowSchedulingEligibility } from './flow-scheduler-host-eligibility'

const DEFAULT_TICK_MS = 60 * 1000

/**
 * Fires flows whose `trigger-schedule` occurrence has come due. Unlike
 * AutomationService there is no persisted `nextRunAt` to advance: the newest
 * scheduled FlowRun's `scheduledFor` is the marker, so an occurrence runs at
 * most once and editing the schedule takes effect immediately.
 */
export class FlowSchedulerService {
  private readonly repository: FlowRepository
  private readonly tickMs: number
  private readonly allowRemoteHostScheduling: boolean
  private readonly getRepo: (repoId: string) => Repo | undefined
  private readonly hasHeadlessDispatch: boolean
  private timer: ReturnType<typeof setInterval> | null = null
  private rendererReady = false
  private evaluating = false

  constructor(
    private readonly runService: FlowRunService,
    opts: {
      getRepo: (repoId: string) => Repo | undefined
      tickMs?: number
      allowRemoteHostScheduling?: boolean
      hasHeadlessDispatch?: boolean
    }
  ) {
    this.repository = runService.runRepository
    this.getRepo = opts.getRepo
    this.tickMs = opts.tickMs ?? DEFAULT_TICK_MS
    this.allowRemoteHostScheduling = opts.allowRemoteHostScheduling ?? false
    this.hasHeadlessDispatch = opts.hasHeadlessDispatch ?? false
  }

  setRendererReady(): void {
    this.rendererReady = true
    void this.evaluateDueFlows()
  }

  /** A closed window must not leave the scheduler thinking it can dispatch. */
  clearRendererReady(): void {
    this.rendererReady = false
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => {
      void this.evaluateDueFlows()
    }, this.tickMs)
    // Why: headless serve never reports renderer-ready, but still needs the
    // startup catch-up pass desktop gets when the window attaches.
    if (this.rendererReady || this.hasHeadlessDispatch) {
      void this.evaluateDueFlows()
    }
  }

  stop(): void {
    if (!this.timer) {
      return
    }
    clearInterval(this.timer)
    this.timer = null
  }

  /** Exposed for tests and the startup catch-up pass. */
  async evaluateDueFlows(now = Date.now()): Promise<void> {
    // Why: a tick must never overlap itself — a slow agent node would otherwise
    // let the next tick see the same occurrence as still unfired.
    if (this.evaluating) {
      return
    }
    this.evaluating = true
    try {
      for (const summary of this.repository.listFlowSummaries()) {
        const flow = this.repository.getFlow(summary.id)
        if (!flow || !isFlowScheduleEligible(flow)) {
          continue
        }
        await this.evaluateFlow(flow, now)
      }
    } finally {
      this.evaluating = false
    }
  }

  private async evaluateFlow(flow: Flow, now: number): Promise<void> {
    const scheduledFor = latestFlowOccurrenceAtOrBefore(flow, now)
    if (scheduledFor === null) {
      return
    }
    const latest = this.repository.findLatestScheduledRun(flow.id)
    if (latest && (latest.scheduledFor ?? latest.startedAt) >= scheduledFor) {
      return
    }
    if (this.runService.isRunning(flow.id)) {
      return
    }

    const eligibility = resolveFlowSchedulingEligibility(flow, {
      getRepo: this.getRepo,
      allowRemoteHostScheduling: this.allowRemoteHostScheduling
    })
    if (!eligibility.ok) {
      this.runService.recordUnexecutedRun({
        flow,
        scheduledFor,
        status: 'skipped',
        error: eligibility.error
      })
      return
    }
    if (now - scheduledFor > flowMissedRunGraceMs(flow)) {
      this.runService.recordUnexecutedRun({
        flow,
        scheduledFor,
        status: 'skipped_missed',
        error: 'Orca was unavailable during the missed-run grace window.'
      })
      return
    }

    try {
      await this.runService.runScheduled(flow.id, scheduledFor)
    } catch (error) {
      // The run either never started or already recorded its own failure; a
      // throw here must not stop the remaining flows in this tick.
      console.error('[flows] scheduled run failed:', error)
    }
  }
}
