import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import { JsonFlowRepository } from '../flows/json-flow-repository'
import type {
  Flow,
  FlowCreateInput,
  FlowRun,
  FlowSummary,
  FlowUpdateInput
} from '../../shared/flows-types'

/**
 * Local-renderer CRUD bridge for node flows. Remote/headless hosts go through
 * the RPC methods in runtime/rpc/methods/flows.ts instead; both talk to the
 * same JsonFlowRepository so behaviour stays identical across transports.
 */
export function registerFlowHandlers(store: Store): void {
  const repository = new JsonFlowRepository(store)

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
}
