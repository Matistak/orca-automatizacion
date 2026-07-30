import { parsePaneKey } from '../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot, TerminalPaneLayoutNode } from '../../../shared/types'

// Shared by automation runs and flow node runs — both persist the same pane identity.
export type RunPaneIdentity = {
  terminalPaneKey: string | null
  terminalPtyId: string | null
}

export type RunPaneTarget = {
  tabId: string
  paneKey: string
  leafId: string
  ptyId: string
}

export function getRunPaneOpenTabId(run: Pick<RunPaneIdentity, 'terminalPaneKey'>): string | null {
  return parsePaneKey(run.terminalPaneKey ?? '')?.tabId ?? null
}

export function runMatchesPaneKey(
  run: Pick<RunPaneIdentity, 'terminalPaneKey'>,
  paneKey: string
): boolean {
  return run.terminalPaneKey ? paneKey === run.terminalPaneKey : false
}

export function resolveRunPaneOpenTarget({
  run,
  terminalTabExists,
  currentLayout,
  livePtyIds
}: {
  run: RunPaneIdentity
  terminalTabExists: boolean
  currentLayout: TerminalLayoutSnapshot | null | undefined
  livePtyIds: readonly string[]
}): RunPaneTarget | null {
  const parsed = parsePaneKey(run.terminalPaneKey ?? '')
  if (!terminalTabExists || !parsed || !run.terminalPtyId || !currentLayout?.root) {
    return null
  }
  if (!terminalLayoutContainsLeaf(currentLayout.root, parsed.leafId)) {
    return null
  }
  if (!livePtyIds.includes(run.terminalPtyId)) {
    return null
  }
  const layoutPtyId = currentLayout.ptyIdsByLeafId?.[parsed.leafId]
  if (layoutPtyId !== undefined && layoutPtyId !== run.terminalPtyId) {
    return null
  }
  return {
    tabId: parsed.tabId,
    paneKey: run.terminalPaneKey!,
    leafId: parsed.leafId,
    ptyId: run.terminalPtyId
  }
}

export function canOpenRunPaneTarget(args: {
  run: RunPaneIdentity
  terminalTabExists: boolean
  currentLayout: TerminalLayoutSnapshot | null | undefined
  livePtyIds: readonly string[]
}): boolean {
  return resolveRunPaneOpenTarget(args) !== null
}

export function buildRunPaneOpenLayout({
  target,
  currentLayout
}: {
  target: RunPaneTarget
  currentLayout: TerminalLayoutSnapshot
}): TerminalLayoutSnapshot {
  return {
    ...currentLayout,
    activeLeafId: target.leafId,
    expandedLeafId: currentLayout.expandedLeafId === target.leafId ? target.leafId : null,
    ptyIdsByLeafId: {
      ...currentLayout.ptyIdsByLeafId,
      [target.leafId]: target.ptyId
    }
  }
}

function terminalLayoutContainsLeaf(node: TerminalPaneLayoutNode, leafId: string): boolean {
  if (node.type === 'leaf') {
    return node.leafId === leafId
  }
  return (
    terminalLayoutContainsLeaf(node.first, leafId) ||
    terminalLayoutContainsLeaf(node.second, leafId)
  )
}
