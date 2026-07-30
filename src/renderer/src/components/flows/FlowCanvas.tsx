import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Node as RFNode,
  type Edge as RFEdge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './flow-canvas-theme.css'
import type { Flow, FlowEdge, FlowNodeKind } from '../../../../shared/flows-types'
import { FlowNodeCard, type FlowNodeCardData } from './FlowNodeCard'
import { FLOW_NODE_DRAG_MIME } from './NodePalette'

const nodeTypes = { flowNode: FlowNodeCard }
const DELETE_KEYS = ['Delete', 'Backspace']

export type FlowCanvasProps = {
  flow: Flow
  selectedNodeId: string | null
  invalidNodeIds: ReadonlySet<string>
  onSelectNode: (nodeId: string | null) => void
  onNodePositionChange: (nodeId: string, position: { x: number; y: number }) => void
  onDeleteNode: (nodeId: string) => void
  onConnect: (edge: FlowEdge) => void
  onDeleteEdge: (edgeId: string) => void
  onAddNodeAtPosition: (kind: FlowNodeKind, position: { x: number; y: number }) => void
}

export function FlowCanvas(props: FlowCanvasProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function FlowCanvasInner({
  flow,
  selectedNodeId,
  invalidNodeIds,
  onSelectNode,
  onNodePositionChange,
  onDeleteNode,
  onConnect,
  onDeleteEdge,
  onAddNodeAtPosition
}: FlowCanvasProps): React.JSX.Element {
  const { screenToFlowPosition } = useReactFlow()

  // Desired node list derived from the flow (source of truth for structure/data).
  const desiredNodes = useMemo<RFNode<FlowNodeCardData>[]>(
    () =>
      flow.nodes.map((node) => ({
        id: node.id,
        type: 'flowNode',
        position: node.position,
        selected: node.id === selectedNodeId,
        data: { node, invalid: invalidNodeIds.has(node.id) }
      })),
    [flow.nodes, invalidNodeIds, selectedNodeId]
  )

  // React Flow owns node state so drags stay smooth; positions persist on drag stop.
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RFNode<FlowNodeCardData>>(desiredNodes)
  // Ids currently being dragged — their live position must survive external re-syncs.
  const draggingRef = useRef<Set<string>>(new Set())

  // Reconcile external changes while keeping React Flow's internal fields (measured
  // dimensions, etc.) and never snapping an in-flight drag back to a stale position.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((node) => [node.id, node]))
      return desiredNodes.map((node) => {
        const existing = prevById.get(node.id)
        if (!existing) {
          return node
        }
        return {
          ...existing,
          position: draggingRef.current.has(node.id) ? existing.position : node.position,
          selected: node.selected,
          data: node.data
        }
      })
    })
  }, [desiredNodes, setRfNodes])

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      flow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        // Why: labels on a condition's two outputs orient the user without a legend.
        label: edge.sourceHandle
      })),
    [flow.edges]
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange<RFNode<FlowNodeCardData>>[]) => {
      // Apply drag/selection changes to the canvas immediately for smooth movement.
      onNodesChange(changes)
      for (const change of changes) {
        if (change.type === 'position' && change.dragging) {
          draggingRef.current.add(change.id)
        } else if (change.type === 'remove') {
          onDeleteNode(change.id)
        }
      }
    },
    [onDeleteNode, onNodesChange]
  )

  const handleNodeDragStop = useCallback(
    (_: unknown, node: RFNode) => {
      draggingRef.current.delete(node.id)
      onNodePositionChange(node.id, node.position)
    },
    [onNodePositionChange]
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          onDeleteEdge(change.id)
        }
      }
    },
    [onDeleteEdge]
  )

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return
      }
      onConnect({
        id: `edge-${connection.source}-${connection.target}-${connection.sourceHandle ?? 'out'}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined
      })
    },
    [onConnect]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const kind = event.dataTransfer.getData(FLOW_NODE_DRAG_MIME) as FlowNodeKind
      if (!kind) {
        return
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      onAddNodeAtPosition(kind, position)
    },
    [onAddNodeAtPosition, screenToFlowPosition]
  )

  return (
    <div className="orca-flow-canvas h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onNodeDragStop={handleNodeDragStop}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={handleDrop}
        deleteKeyCode={DELETE_KEYS}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor="var(--muted)" maskColor="transparent" />
      </ReactFlow>
    </div>
  )
}
