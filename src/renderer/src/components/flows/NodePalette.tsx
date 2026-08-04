import React, { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { FlowNodeKind } from '../../../../shared/flows-types'
import { cn } from '@/lib/utils'
import { listFlowNodeKindMeta } from './flow-node-presentation'
import { translate } from '@/i18n/i18n'

export const FLOW_NODE_DRAG_MIME = 'application/orca-flow-node-kind'

type NodePaletteProps = {
  onAddNode: (kind: FlowNodeKind) => void
}

/** Floating canvas overlay: toggle open to drag a row onto the canvas or click to append. */
export function NodePalette({ onAddNode }: NodePaletteProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const label = translate('auto.components.flows.NodePalette.5204a981d9', 'Nodes')

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'pointer-events-auto flex size-8 items-center justify-center rounded-md border border-border',
          'bg-popover text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground'
        )}
      >
        {open ? (
          <Minus className="size-4" strokeWidth={1.75} />
        ) : (
          <Plus className="size-4" strokeWidth={1.75} />
        )}
      </button>

      {open ? (
        <div
          className={cn(
            'pointer-events-auto flex max-h-[60vh] w-52 flex-col gap-1 rounded-md',
            'scrollbar-sleek overflow-y-auto border border-border bg-popover p-2 shadow-md'
          )}
        >
          <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">{label}</div>
          {listFlowNodeKindMeta().map((meta) => {
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
      ) : null}
    </div>
  )
}
