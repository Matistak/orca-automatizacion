import { describe, expect, it, vi } from 'vitest'
import type { TerminalLayoutSnapshot } from '../../../../shared/types'
import { openFlowNodeRun, type FlowNodeRunOpenStore } from './open-flow-node-run'

const leafId = '11111111-1111-4111-8111-111111111111'
const tabId = 'tab-1'
const paneKey = `${tabId}:${leafId}`
const ptyId = 'pty-1'

const layout: TerminalLayoutSnapshot = {
  root: { type: 'leaf', leafId },
  activeLeafId: leafId,
  expandedLeafId: null,
  ptyIdsByLeafId: { [leafId]: ptyId }
}

function makeStore(overrides?: Partial<FlowNodeRunOpenStore>): FlowNodeRunOpenStore {
  return {
    getTab: () => ({ id: tabId }),
    terminalLayoutsByTabId: { [tabId]: layout },
    ptyIdsByTabId: { [tabId]: [ptyId] },
    setTabLayout: vi.fn(),
    setActiveTab: vi.fn(),
    setActiveTabType: vi.fn(),
    ...overrides
  }
}

const liveNodeRun = {
  workspaceId: 'ws-1',
  terminalPaneKey: paneKey,
  terminalPtyId: ptyId
}

describe('openFlowNodeRun', () => {
  it('focuses the exact pane the node ran in', () => {
    const store = makeStore()
    const outcome = openFlowNodeRun({
      nodeRun: liveNodeRun,
      store,
      activateWorktree: () => true
    })

    expect(outcome).toEqual({ kind: 'pane', tabId })
    expect(store.setTabLayout).toHaveBeenCalledWith(
      tabId,
      expect.objectContaining({ activeLeafId: leafId })
    )
    expect(store.setActiveTab).toHaveBeenCalledWith(tabId)
    expect(store.setActiveTabType).toHaveBeenCalledWith('terminal')
  })

  it('falls back to the workspace when the pty is gone', () => {
    const store = makeStore({ ptyIdsByTabId: { [tabId]: [] } })
    const outcome = openFlowNodeRun({
      nodeRun: liveNodeRun,
      store,
      activateWorktree: () => true
    })

    expect(outcome).toEqual({ kind: 'workspace-without-pane' })
    expect(store.setTabLayout).not.toHaveBeenCalled()
  })

  it('falls back to the workspace when the terminal tab is gone', () => {
    const outcome = openFlowNodeRun({
      nodeRun: liveNodeRun,
      store: makeStore({ getTab: () => null }),
      activateWorktree: () => true
    })

    expect(outcome).toEqual({ kind: 'workspace-without-pane' })
  })

  it('falls back to the workspace when the node never recorded a pane', () => {
    const outcome = openFlowNodeRun({
      nodeRun: { workspaceId: 'ws-1', terminalPaneKey: null, terminalPtyId: null },
      store: makeStore(),
      activateWorktree: () => true
    })

    expect(outcome).toEqual({ kind: 'workspace-without-pane' })
  })

  it('reports unavailable without a workspace', () => {
    const activateWorktree = vi.fn(() => true)
    const outcome = openFlowNodeRun({
      nodeRun: { workspaceId: null, terminalPaneKey: paneKey, terminalPtyId: ptyId },
      store: makeStore(),
      activateWorktree
    })

    expect(outcome).toEqual({ kind: 'unavailable' })
    expect(activateWorktree).not.toHaveBeenCalled()
  })

  it('reports unavailable when the workspace cannot be activated', () => {
    const outcome = openFlowNodeRun({
      nodeRun: liveNodeRun,
      store: makeStore(),
      activateWorktree: () => false
    })

    expect(outcome).toEqual({ kind: 'unavailable' })
  })
})
