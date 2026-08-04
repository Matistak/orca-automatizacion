import React from 'react'
import { PanelLeftClose, PanelLeftOpen, Workflow } from 'lucide-react'
import type { FlowSummary } from '../../../../shared/flows-types'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { formatFlowRunTime } from './flow-run-presentation'

type FlowListProps = {
  flows: FlowSummary[]
  selectedFlowId: string | null
  onSelect: (flowId: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}

export function FlowList({
  flows,
  selectedFlowId,
  onSelect,
  collapsed,
  onToggleCollapsed
}: FlowListProps): React.JSX.Element {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={translate('auto.components.flows.FlowList.18340661f6', 'Expand flow list')}
          aria-label={translate('auto.components.flows.FlowList.18340661f6', 'Expand flow list')}
          aria-expanded={false}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={`${flows.length} ${translate('auto.components.flows.FlowList.d679104f62', 'flows')}`}
          className="flex size-7 items-center justify-center rounded-md bg-muted text-[11px] font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {flows.length}
        </button>
      </div>
    )
  }
  return (
    <div className="scrollbar-sleek flex h-full flex-col overflow-y-auto p-2">
      <div className="flex items-center gap-1 px-1 pb-1">
        <span className="min-w-0 flex-1 truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {translate('auto.components.flows.FlowList.35c0b6c6d4', 'Flows')}
        </span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={translate('auto.components.flows.FlowList.1fbb4e6563', 'Collapse flow list')}
          aria-label={translate('auto.components.flows.FlowList.1fbb4e6563', 'Collapse flow list')}
          aria-expanded
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PanelLeftClose className="size-4" strokeWidth={1.75} />
        </button>
      </div>
      {flows.length === 0 ? (
        <div className="p-1 text-xs text-muted-foreground">
          {translate(
            'auto.components.flows.FlowList.6db4910b1b',
            'No flows yet. Create one to get started.'
          )}
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
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
              <Workflow
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {flow.name}
                  </span>
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
    </div>
  )
}
