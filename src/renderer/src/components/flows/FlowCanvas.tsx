import React, { useCallback, useMemo } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
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

  const rfNodes = useMemo<RFNode<FlowNodeCardData>[]>(
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
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          onNodePositionChange(change.id, change.position)
        } else if (change.type === 'remove') {
          onDeleteNode(change.id)
        }
      }
    },
    [onDeleteNode, onNodePositionChange]
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
