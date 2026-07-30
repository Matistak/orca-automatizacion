import React from 'react'
import type { FlowNodeKind } from '../../../../shared/flows-types'
import { cn } from '@/lib/utils'
import { FLOW_NODE_KIND_META } from './flow-node-presentation'
import { translate } from '@/i18n/i18n'

export const FLOW_NODE_DRAG_MIME = 'application/orca-flow-node-kind'

type NodePaletteProps = {
  onAddNode: (kind: FlowNodeKind) => void
}

/** Left rail: drag a row onto the canvas, or click to append a node. */
export function NodePalette({ onAddNode }: NodePaletteProps): React.JSX.Element {
  return (
    <div className="scrollbar-sleek flex h-full flex-col gap-1 overflow-y-auto p-2">
      <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">
        {translate('auto.components.flows.NodePalette.5204a981d9', 'Nodes')}
      </div>
      {FLOW_NODE_KIND_META.map((meta) => {
        const Icon = meta.icon
        return (
          <button
            key={meta.kind}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(FLOW_NODE_DRAG_MIME, meta.kind)
              event.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => onAddNode(meta.kind)}
            className={cn(
              'flex w-full items-start gap-2 rounded-md border border-transparent px-2 py-2 text-left',
              'cursor-grab transition-colors hover:bg-accent active:cursor-grabbing'
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{meta.title}</span>
              <span className="block text-[11px] leading-snug text-muted-foreground">
                {meta.description}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
