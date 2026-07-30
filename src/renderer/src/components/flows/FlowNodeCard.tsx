import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { FlowNode } from '../../../../shared/flows-types'
import { cn } from '@/lib/utils'
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
}

const HANDLE_CLASS = '!size-2.5 !border !border-border !bg-card'

function FlowNodeCardComponent({
  data,
  selected
}: NodeProps & { data: FlowNodeCardData }): React.JSX.Element {
  const { node, invalid } = data
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
        invalid && !selected && 'border-destructive/70'
      )}
    >
      {!meta.isTrigger ? (
        <Handle type="target" position={Position.Left} className={HANDLE_CLASS} />
      ) : null}

      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{title}</span>
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
