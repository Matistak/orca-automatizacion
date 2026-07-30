import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { Flow, FlowNodeRun, FlowRun } from '../../../../shared/flows-types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getFlowNodeTitle } from './flow-node-presentation'
import {
  formatFlowRunDuration,
  formatFlowRunTime,
  getFlowNodeStatusLabel,
  getFlowNodeTone,
  getFlowRunStatusLabel
} from './flow-run-presentation'
import { translate } from '@/i18n/i18n'

type FlowRunHistoryProps = {
  runs: FlowRun[]
  selectedRunId: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  onSelectRun: (runId: string | null) => void
  onOpenNodeWorkspace: (nodeRun: FlowNodeRun) => void
}

export function FlowRunHistory({
  runs,
  selectedRunId,
  collapsed,
  onToggleCollapsed,
  onSelectRun,
  onOpenNodeWorkspace
}: FlowRunHistoryProps): React.JSX.Element {
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null

  return (
    <div className="flex max-h-64 shrink-0 flex-col border-t border-border">
      <button
        type="button"
        onClick={onToggleCollapsed}
        className="flex items-center gap-2 px-4 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
      >
        {collapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        <span className="font-medium">
          {translate('auto.components.flows.FlowRunHistory.5c3b0a91f7', 'Run history')}
        </span>
        <span>
          {runs.length}{' '}
          {runs.length === 1
            ? translate('auto.components.flows.FlowRunHistory.a1d2e3f405', 'run')
            : translate('auto.components.flows.FlowRunHistory.b6c7d8e9f0', 'runs')}
        </span>
      </button>
      {collapsed ? null : (
        <div className="flex min-h-0 flex-1">
          <div className="scrollbar-sleek w-56 shrink-0 overflow-y-auto border-r border-border p-1.5">
            {runs.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">
                {translate('auto.components.flows.FlowRunHistory.0f1e2d3c4b', 'No runs yet.')}
              </p>
            ) : (
              runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => onSelectRun(run.id)}
                  className={cn(
                    'flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                    run.id === selectedRun?.id && 'bg-accent'
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[12px] font-medium">
                    {run.runNumber ? `#${run.runNumber}` : formatFlowRunTime(run.startedAt)}
                    <span
                      className={cn(
                        'text-[11px] font-normal',
                        run.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                      )}
                    >
                      {getFlowRunStatusLabel(run.status)}
                    </span>
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatFlowRunTime(run.startedAt)} · {formatFlowRunDuration(run)}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto p-2">
            {selectedRun ? (
              <RunNodeList run={selectedRun} onOpenNodeWorkspace={onOpenNodeWorkspace} />
            ) : (
              <p className="p-2 text-xs text-muted-foreground">
                {translate(
                  'auto.components.flows.FlowRunHistory.7a8b9c0d1e',
                  'Select a run to see what each node did.'
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RunNodeList({
  run,
  onOpenNodeWorkspace
}: {
  run: FlowRun
  onOpenNodeWorkspace: (nodeRun: FlowNodeRun) => void
}): React.JSX.Element {
  const snapshot: Flow = run.flowSnapshot
  return (
    <ul className="space-y-1.5">
      {run.nodeRuns.map((nodeRun) => {
        const node = snapshot.nodes.find((entry) => entry.id === nodeRun.nodeId)
        const tone = getFlowNodeTone(nodeRun.status)
        return (
          <li
            key={nodeRun.nodeId}
            className={cn(
              'rounded-md border border-border/60 px-2.5 py-2',
              tone === 'skipped' && 'opacity-60'
            )}
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
                {node ? getFlowNodeTitle(node.config, node.label) : nodeRun.nodeId}
              </span>
              <span
                className={cn(
                  'text-[11px]',
                  tone === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                )}
              >
                {getFlowNodeStatusLabel(nodeRun.status)}
                {nodeRun.exitCode !== null && nodeRun.exitCode !== undefined
                  ? ` · ${translate('auto.components.flows.FlowRunHistory.5e6f7a8b90', 'exit')} ${nodeRun.exitCode}`
                  : ''}
              </span>
              {nodeRun.workspaceId ? (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => onOpenNodeWorkspace(nodeRun)}
                  className="text-muted-foreground"
                >
                  {translate('auto.components.flows.FlowRunHistory.2c3d4e5f60', 'Open')}
                </Button>
              ) : null}
            </div>
            {nodeRun.error ? (
              <p className="mt-1 text-[11px] text-destructive">{nodeRun.error}</p>
            ) : null}
            {nodeRun.output?.content ? (
              <pre className="scrollbar-sleek mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-snug text-muted-foreground">
                {nodeRun.output.content}
              </pre>
            ) : null}
            {nodeRun.usage?.status === 'known' ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {(nodeRun.usage.inputTokens ?? 0) + (nodeRun.usage.outputTokens ?? 0)}{' '}
                {translate('auto.components.flows.FlowRunHistory.3d4e5f6071', 'tokens')}
                {nodeRun.usage.estimatedCostUsd !== null
                  ? ` · $${nodeRun.usage.estimatedCostUsd.toFixed(3)}`
                  : ''}
              </p>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
