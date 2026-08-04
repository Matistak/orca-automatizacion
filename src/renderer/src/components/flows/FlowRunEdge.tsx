import React from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import type { FlowEdgeTone } from './flow-edge-run-tone'

export type FlowRunEdgeData = {
  tone: FlowEdgeTone
  /** Condition branch label ("true" / "false"), when the source has handles. */
  branchLabel?: string
}

const TONE_STROKE: Record<FlowEdgeTone, string> = {
  idle: 'var(--border)',
  active: 'var(--status-success)',
  completed: 'color-mix(in srgb, var(--status-success) 55%, transparent)',
  failed: 'var(--destructive)',
  skipped: 'color-mix(in srgb, var(--border) 50%, transparent)'
}

function FlowRunEdgeComponent(props: EdgeProps): React.JSX.Element {
  const data = (props.data ?? {}) as FlowRunEdgeData
  const tone = data.tone ?? 'idle'
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition
  })

  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: TONE_STROKE[tone],
          strokeWidth: tone === 'idle' || tone === 'skipped' ? 1.5 : 2,
          transition: 'stroke 220ms ease'
        }}
      />
      {tone === 'active' ? (
        // A packet travelling toward the node that is currently working.
        <circle r="3.5" fill="var(--status-success)">
          <animateMotion dur="1.4s" repeatCount="indefinite" path={edgePath} />
        </circle>
      ) : null}
      {data.branchLabel ? (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded bg-background/80 px-1 text-[9px] uppercase tracking-wide text-muted-foreground"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.branchLabel}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  )
}

export const FlowRunEdge = React.memo(FlowRunEdgeComponent)
