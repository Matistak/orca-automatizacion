import React from 'react'
import { Workflow } from 'lucide-react'
import type { FlowSummary } from '../../../../shared/flows-types'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatFlowRunTime } from './flow-run-presentation'

type FlowListProps = {
  flows: FlowSummary[]
  selectedFlowId: string | null
  onSelect: (flowId: string) => void
}

export function FlowList({ flows, selectedFlowId, onSelect }: FlowListProps): React.JSX.Element {
  if (flows.length === 0) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        {translate(
          'auto.components.flows.FlowList.6db4910b1b',
          'No flows yet. Create one to get started.'
        )}
      </div>
    )
  }
  return (
    <div className="scrollbar-sleek flex flex-col gap-1 overflow-y-auto p-2">
      {flows.map((flow) => {
        const active = flow.id === selectedFlowId
        return (
          <button
            key={flow.id}
            type="button"
            onClick={() => onSelect(flow.id)}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-2 text-left transition-colors',
              active ? 'bg-accent' : 'hover:bg-accent'
            )}
          >
            <Workflow className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{flow.name}</span>
                {!flow.enabled ? (
                  <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                    {translate('auto.components.flows.FlowList.9df10f2520', 'Off')}
                  </span>
                ) : null}
              </span>
              <span className="block text-[11px] text-muted-foreground">
                {flow.nodeCount}{' '}
                {flow.nodeCount === 1
                  ? translate('auto.components.flows.FlowList.9927e9a59e', 'node')
                  : translate('auto.components.flows.FlowList.89c8ee72ae', 'nodes')}
              </span>
              {flow.nextRunAt !== undefined ? (
                <span className="block text-[11px] text-muted-foreground">
                  {translate('auto.components.flows.FlowList.3ea7d5c920', 'Next')}{' '}
                  {formatFlowRunTime(flow.nextRunAt)}
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
