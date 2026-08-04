import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import type { Store } from '../persistence'
import type { FlowNodeDispatcher } from './flow-node-dispatcher'
import type { FlowRepository } from './flow-repository'
import { FlowRunService } from './flow-run-service'
import { FlowSchedulerService } from './flow-scheduler-service'
import { JsonFlowRepository } from './json-flow-repository'

export type FlowServices = {
  repository: FlowRepository
  runService: FlowRunService
  scheduler: FlowSchedulerService
}

/**
 * Process-wide owner of the flow runtime. Lives here rather than in
 * `ipc/flows.ts` because serve mode arms the scheduler without ever registering
 * renderer IPC handlers — both entry points need the same instances.
 */
let services: FlowServices | null = null

export function initFlowServices(
  store: Store,
  opts: {
    claudeUsage?: ClaudeUsageStore | null
    codexUsage?: CodexUsageStore | null
    headlessDispatcher?: FlowNodeDispatcher | null
    allowRemoteHostScheduling?: boolean
  } = {}
): FlowServices {
  if (services) {
    return services
  }
  const repository = new JsonFlowRepository(store)
  const runService = new FlowRunService(store, repository, opts)
  const scheduler = new FlowSchedulerService(runService, {
    getRepo: (repoId) => store.getRepo(repoId),
    allowRemoteHostScheduling: opts.allowRemoteHostScheduling,
    hasHeadlessDispatch: Boolean(opts.headlessDispatcher)
  })
  services = { repository, runService, scheduler }
  return services
}

export function getFlowServices(): FlowServices | null {
  return services
}

/** Tests only: drop the singletons so each case starts from a clean process. */
export function resetFlowServices(): void {
  services?.scheduler.stop()
  services = null
}
