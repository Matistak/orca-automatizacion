import { ipcMain, type WebContents } from 'electron'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import type { Store } from '../persistence'
import { getFlowServices, initFlowServices } from '../flows/flow-services'
import type {
  Flow,
  FlowCreateInput,
  FlowNodeDispatchResult,
  FlowRun,
  FlowSummary,
  FlowUpdateInput
} from '../../shared/flows-types'

/**
 * Local-renderer CRUD bridge for node flows. Remote/headless hosts go through
 * the RPC methods in runtime/rpc/methods/flows.ts instead; both talk to the
 * same JsonFlowRepository so behaviour stays identical across transports.
 */

/**
 * The window that executes agent nodes changes over the app lifecycle (close /
 * reopen on macOS), so index.ts re-points the service instead of rebuilding it.
 */
export function setFlowRunWebContents(webContents: WebContents | null): void {
  const services = getFlowServices()
  services?.runService.setWebContents(webContents)
  if (!webContents) {
    services?.scheduler.clearRendererReady()
  }
}

/** Arms scheduled flows; safe to call more than once. */
export function startFlowScheduler(): void {
  getFlowServices()?.scheduler.start()
}

export function stopFlowScheduler(): void {
  getFlowServices()?.scheduler.stop()
}

export function registerFlowHandlers(
  store: Store,
  usage: { claudeUsage?: ClaudeUsageStore; codexUsage?: CodexUsageStore } = {}
): void {
  // Serve mode already initialized these; a desktop launch initializes here.
  const { repository, runService, scheduler } = initFlowServices(store, usage)

  ipcMain.handle('flows:list', (): FlowSummary[] => repository.listFlowSummaries())
  ipcMain.handle('flows:get', (_event, args: { id: string }): Flow | undefined =>
    repository.getFlow(args.id)
  )
  ipcMain.handle(
    'flows:create',
    (_event, input: FlowCreateInput): Flow => repository.createFlow(input)
  )
  ipcMain.handle(
    'flows:update',
    (_event, args: { id: string; updates: FlowUpdateInput }): Flow =>
      repository.updateFlow(args.id, args.updates)
  )
  ipcMain.handle('flows:delete', (_event, args: { id: string }): void => {
    repository.deleteFlow(args.id)
  })
  ipcMain.handle('flows:listRuns', (_event, args: { flowId: string; limit?: number }): FlowRun[] =>
    repository.listRunsByFlow(args.flowId, args.limit)
  )
  ipcMain.handle('flows:getRun', (_event, args: { runId: string }): FlowRun | undefined =>
    repository.getRun(args.runId)
  )
  ipcMain.handle(
    'flows:runNow',
    async (_event, args: { flowId: string }): Promise<FlowRun> =>
      await runService.runNow(args.flowId)
  )
  ipcMain.handle('flows:markNodeDispatchResult', (_event, result: FlowNodeDispatchResult): void => {
    runService.reportNodeResult(result)
  })
  // Why: the scheduler must not dispatch an agent node into a window that has
  // not mounted its listener yet; this also drives the startup catch-up pass.
  ipcMain.handle('flows:rendererReady', (): void => {
    runService.setRendererReady()
    scheduler.setRendererReady()
  })
}
