import type { FlowNodeRun } from '../../../../shared/flows-types'
import type { TerminalLayoutSnapshot } from '../../../../shared/types'
import {
  buildRunPaneOpenLayout,
  getRunPaneOpenTabId,
  resolveRunPaneOpenTarget
} from '../../lib/run-pane-open-target'

export type FlowNodeRunOpenOutcome =
  // Focused the exact pane the node ran in.
  | { kind: 'pane'; tabId: string }
  // Workspace opened, but the run's terminal is gone — caller should say so.
  | { kind: 'workspace-without-pane' }
  | { kind: 'unavailable' }

export type FlowNodeRunOpenStore = {
  getTab: (tabId: string) => unknown
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot | null | undefined>
  ptyIdsByTabId: Record<string, string[]>
  setTabLayout: (tabId: string, layout: TerminalLayoutSnapshot | null) => void
  setActiveTab: (tabId: string) => void
  setActiveTabType: (type: 'terminal') => void
}

export function openFlowNodeRun({
  nodeRun,
  store,
  activateWorktree
}: {
  nodeRun: Pick<FlowNodeRun, 'workspaceId' | 'terminalPaneKey' | 'terminalPtyId'>
  store: FlowNodeRunOpenStore
  activateWorktree: (worktreeId: string) => boolean
}): FlowNodeRunOpenOutcome {
  const workspaceId = nodeRun.workspaceId
  if (!workspaceId) {
    return { kind: 'unavailable' }
  }

  const paneRun = {
    terminalPaneKey: nodeRun.terminalPaneKey ?? null,
    terminalPtyId: nodeRun.terminalPtyId ?? null
  }
  const tabId = getRunPaneOpenTabId(paneRun)
  const currentLayout = tabId ? store.terminalLayoutsByTabId[tabId] : null
  const target = resolveRunPaneOpenTarget({
    run: paneRun,
    terminalTabExists: tabId ? Boolean(store.getTab(tabId)) : false,
    currentLayout,
    livePtyIds: tabId ? (store.ptyIdsByTabId[tabId] ?? []) : []
  })

  if (target && currentLayout) {
    store.setTabLayout(target.tabId, buildRunPaneOpenLayout({ target, currentLayout }))
    if (activateWorktree(workspaceId)) {
      store.setActiveTab(target.tabId)
      store.setActiveTabType('terminal')
      return { kind: 'pane', tabId: target.tabId }
    }
    return { kind: 'unavailable' }
  }

  if (!activateWorktree(workspaceId)) {
    return { kind: 'unavailable' }
  }
  return { kind: 'workspace-without-pane' }
}
