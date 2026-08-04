import { useEffect, useState } from 'react'
import type { FlowNodeRun } from '../../../../shared/flows-types'

/** Ticks while a node is in flight so its elapsed time counts up on the card. */
export function useElapsedNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [active])
  return now
}

export function formatFlowNodeElapsed(nodeRun: FlowNodeRun, now: number): string | null {
  if (!nodeRun.startedAt) {
    return null
  }
  const ms = Math.max(0, (nodeRun.completedAt ?? now) - nodeRun.startedAt)
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function formatFlowNodeTokens(nodeRun: FlowNodeRun): string | null {
  if (nodeRun.usage?.status !== 'known') {
    return null
  }
  const total = (nodeRun.usage.inputTokens ?? 0) + (nodeRun.usage.outputTokens ?? 0)
  if (total <= 0) {
    return null
  }
  return total < 1000 ? `${total} tok` : `${(total / 1000).toFixed(1)}k tok`
}
