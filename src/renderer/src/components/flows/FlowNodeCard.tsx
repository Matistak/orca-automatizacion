import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertCircle, Check, Loader2, MinusCircle } from 'lucide-react'
import type { FlowNode, FlowNodeRun } from '../../../../shared/flows-types'
import { cn } from '@/lib/utils'
import { getFlowNodeStatusLabel, getFlowNodeTone, type FlowNodeTone } from './flow-run-presentation'
import {
  getFlowNodeConfigSummary,
  getFlowNodeKindMeta,
  getFlowNodeTitle
} from './flow-node-presentation'
import { translate } from '@/i18n/i18n'

/** Data carried on each React Flow node; `node` is the domain model. */
export type FlowNodeCardData = {
  node: FlowNode
  invalid?: boolean
  /** Present while a run is selected; drives the live status decoration. */
  nodeRun?: FlowNodeRun
}

const HANDLE_CLASS = '!size-2.5 !border !border-border !bg-card'

function FlowNodeCardComponent({
  data,
  selected
}: NodeProps & { data: FlowNodeCardData }): React.JSX.Element {
  const { node, invalid, nodeRun } = data
  const tone = getFlowNodeTone(nodeRun?.status)
  const meta = getFlowNodeKindMeta(node.config.kind)
  const Icon = meta.icon
  const title = getFlowNodeTitle(node.config, node.label)
  const summary = getFlowNodeConfigSummary(node.config)
  const isCondition = node.config.kind === 'condition'

  return (
    <div
      className={cn(
        'w-56 rounded-lg border bg-card text-card-foreground shadow-xs transition-colors',
        selected ? 'border-ring ring-[3px] ring-ring/40' : 'border-border',
        invalid && !selected && 'border-destructive/70',
        tone === 'running' && !selected && 'border-ring ring-2 ring-ring/30',
        tone === 'failed' && !selected && 'border-destructive',
        tone === 'skipped' && 'opacity-50'
      )}
    >
      {!meta.isTrigger ? (
        <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
      ) : null}

      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
        {nodeRun ? <NodeRunStatusIcon tone={tone} status={nodeRun.status} /> : null}
      </div>
      <div className="border-t border-border/60 px-3 py-2">
        <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{summary}</p>
      </div>

      {isCondition ? (
        <>
          <FlowBranchHandle
            id="true"
            label={translate('auto.components.flows.FlowNodeCard.848be47462', 'true')}
            top="38%"
          />
          <FlowBranchHandle
            id="false"
            label={translate('auto.components.flows.FlowNodeCard.1bd5a7678e', 'false')}
            top="70%"
          />
        </>
      ) : (
        <Handle type="source" position={Position.Right} className={HANDLE_CLASS} />
      )}
    </div>
  )
}

function NodeRunStatusIcon({
  tone,
  status
}: {
  tone: FlowNodeTone
  status: FlowNodeRun['status']
}): React.JSX.Element | null {
  const label = getFlowNodeStatusLabel(status)
  const className = 'size-3.5 shrink-0'
  switch (tone) {
    case 'running':
      return (
        <Loader2
          className={cn(className, 'animate-spin text-muted-foreground')}
          aria-label={label}
        />
      )
    case 'completed':
      return <Check className={cn(className, 'text-muted-foreground')} aria-label={label} />
    case 'failed':
      return <AlertCircle className={cn(className, 'text-destructive')} aria-label={label} />
    case 'skipped':
      return <MinusCircle className={cn(className, 'text-muted-foreground')} aria-label={label} />
    case 'idle':
      return null
  }
}

function FlowBranchHandle({
  id,
  label,
  top
}: {
  id: string
  label: string
  top: string
}): React.JSX.Element {
  return (
    <>
      <span
        className="pointer-events-none absolute right-3 -translate-y-1/2 text-[9px] uppercase tracking-wide text-muted-foreground"
        style={{ top }}
      >
        {label}
      </span>
      <Handle
        type="source"
        id={id}
        position={Position.Right}
        className={HANDLE_CLASS}
        style={{ top }}
      />
    </>
  )
}

export const FlowNodeCard = React.memo(FlowNodeCardComponent)
