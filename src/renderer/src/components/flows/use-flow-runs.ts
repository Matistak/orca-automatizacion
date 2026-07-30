import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { FlowRun } from '../../../../shared/flows-types'
import { useAppStore } from '@/store'
import { getFlowNodeRunsByNodeId } from './flow-run-presentation'
import { translate } from '@/i18n/i18n'

const RUN_HISTORY_LIMIT = 25

export type FlowRunsState = {
  runs: FlowRun[]
  selectedRun: FlowRun | null
  selectedRunId: string | null
  nodeRunsByNodeId: ReadonlyMap<string, FlowRun['nodeRuns'][number]>
  isRunning: boolean
  selectRun: (runId: string | null) => void
  runNow: () => Promise<void>
}

/**
 * Owns run history for the open flow: seeds it from storage, follows live
 * `flows:runUpdated` pushes, and keeps the newest run selected while it executes
 * so the canvas overlay tracks the run in progress.
 */
export function useFlowRuns(flowId: string | null): FlowRunsState {
  const listFlowRuns = useAppStore((s) => s.listFlowRuns)
  const runFlowNow = useAppStore((s) => s.runFlowNow)
  const [runs, setRuns] = useState<FlowRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  useEffect(() => {
    setRuns([])
    setSelectedRunId(null)
    if (!flowId) {
      return
    }
    let cancelled = false
    void listFlowRuns(flowId, RUN_HISTORY_LIMIT).then((loaded) => {
      if (!cancelled) {
        setRuns(loaded)
        setSelectedRunId(loaded[0]?.id ?? null)
      }
    })
    return () => {
      cancelled = true
    }
  }, [flowId, listFlowRuns])

  useEffect(() => {
    if (!flowId) {
      return
    }
    return window.api.flows.onRunUpdated(({ run }) => {
      if (run.flowId !== flowId) {
        return
      }
      setRuns((current) => {
        const index = current.findIndex((entry) => entry.id === run.id)
        if (index === -1) {
          // Why: a brand-new run is what the user just triggered — follow it.
          setSelectedRunId(run.id)
          return [run, ...current].slice(0, RUN_HISTORY_LIMIT)
        }
        const next = [...current]
        next[index] = run
        return next
      })
    })
  }, [flowId])

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId]
  )
  const nodeRunsByNodeId = useMemo(() => getFlowNodeRunsByNodeId(selectedRun), [selectedRun])
  const isRunning = runs.some((run) => run.status === 'running')

  const runNow = useCallback(async () => {
    if (!flowId) {
      return
    }
    try {
      await runFlowNow(flowId)
    } catch (error) {
      console.error('[flows] failed to run flow:', error)
      toast.error(
        error instanceof Error
          ? error.message
          : translate('auto.components.flows.use.flow.runs.4b8e1c0a72', 'Failed to run flow')
      )
    }
  }, [flowId, runFlowNow])

  return {
    runs,
    selectedRun,
    selectedRunId: selectedRun?.id ?? null,
    nodeRunsByNodeId,
    isRunning,
    selectRun: setSelectedRunId,
    runNow
  }
}
