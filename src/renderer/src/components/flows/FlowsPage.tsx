import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Flow, FlowEdge, FlowNode, FlowNodeKind } from '../../../../shared/flows-types'
import { validateFlowGraph } from '../../../../shared/flow-graph'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { FlowList } from './FlowList'
import { FlowCanvas } from './FlowCanvas'
import { NodePalette } from './NodePalette'
import { NodeInspector } from './NodeInspector'
import { createDefaultNodeConfig } from './flow-node-presentation'
import { FlowsEmptyState, FlowsHeader, ValidationBanner, type SaveState } from './flows-page-parts'
import { translate } from '@/i18n/i18n'

const AUTOSAVE_DELAY_MS = 700

export default function FlowsPage(): React.JSX.Element {
  const flowSummaries = useAppStore((s) => s.flowSummaries)
  const fetchFlows = useAppStore((s) => s.fetchFlows)
  const getFlow = useAppStore((s) => s.getFlow)
  const createFlow = useAppStore((s) => s.createFlow)
  const updateFlow = useAppStore((s) => s.updateFlow)
  const deleteFlow = useAppStore((s) => s.deleteFlow)
  const closeFlowsPage = useAppStore((s) => s.closeFlowsPage)

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  const [editingFlow, setEditingFlow] = useState<Flow | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')

  const editingFlowRef = useRef<Flow | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  editingFlowRef.current = editingFlow

  useEffect(() => {
    void fetchFlows()
  }, [fetchFlows])

  // Select the first flow once summaries arrive and nothing is selected.
  useEffect(() => {
    if (!selectedFlowId && flowSummaries.length > 0) {
      setSelectedFlowId(flowSummaries[0].id)
    }
  }, [flowSummaries, selectedFlowId])

  // Load the full flow whenever the selection changes.
  useEffect(() => {
    if (!selectedFlowId) {
      setEditingFlow(null)
      return
    }
    let cancelled = false
    void getFlow(selectedFlowId).then((flow) => {
      if (!cancelled) {
        setEditingFlow(flow ?? null)
        setSelectedNodeId(null)
        setSaveState('saved')
      }
    })
    return () => {
      cancelled = true
    }
  }, [getFlow, selectedFlowId])

  const persist = useCallback(async () => {
    const flow = editingFlowRef.current
    if (!flow) {
      return
    }
    setSaveState('saving')
    try {
      await updateFlow(flow.id, {
        name: flow.name,
        description: flow.description,
        nodes: flow.nodes,
        edges: flow.edges,
        enabled: flow.enabled
      })
      // Only settle to "saved" if nothing changed again while saving.
      setSaveState((current) => (current === 'saving' ? 'saved' : current))
    } catch (error) {
      console.error('[flows] failed to save flow:', error)
      toast.error(translate('auto.components.flows.FlowsPage.3e20835f66', 'Failed to save flow'))
      setSaveState('dirty')
    }
  }, [updateFlow])

  const scheduleSave = useCallback(() => {
    setSaveState('dirty')
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persist()
    }, AUTOSAVE_DELAY_MS)
  }, [persist])

  // Flush a pending save when leaving the page.
  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        void persist()
      }
    },
    [persist]
  )

  const mutateFlow = useCallback(
    (updater: (flow: Flow) => Flow) => {
      setEditingFlow((current) => {
        if (!current) {
          return current
        }
        const next = updater(current)
        editingFlowRef.current = next
        return next
      })
      scheduleSave()
    },
    [scheduleSave]
  )

  const handleAddNode = useCallback(
    (kind: FlowNodeKind, position: { x: number; y: number }) => {
      const node: FlowNode = {
        id: createBrowserUuid(),
        config: createDefaultNodeConfig(kind),
        position
      }
      mutateFlow((flow) => ({ ...flow, nodes: [...flow.nodes, node] }))
      setSelectedNodeId(node.id)
    },
    [mutateFlow]
  )

  const handleAppendNode = useCallback(
    (kind: FlowNodeKind) => {
      // Click-to-add drops the node at a cascading offset so they don't stack.
      const count = editingFlowRef.current?.nodes.length ?? 0
      handleAddNode(kind, { x: 80 + (count % 5) * 40, y: 80 + count * 30 })
    },
    [handleAddNode]
  )

  const handleNodePositionChange = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      mutateFlow((flow) => ({
        ...flow,
        nodes: flow.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node))
      }))
    },
    [mutateFlow]
  )

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      mutateFlow((flow) => ({
        ...flow,
        nodes: flow.nodes.filter((node) => node.id !== nodeId),
        edges: flow.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
      }))
      setSelectedNodeId((current) => (current === nodeId ? null : current))
    },
    [mutateFlow]
  )

  const handleConnect = useCallback(
    (edge: FlowEdge) => {
      mutateFlow((flow) => {
        // Dedupe identical connections; one edge per source+handle+target.
        const exists = flow.edges.some(
          (existing) =>
            existing.source === edge.source &&
            existing.target === edge.target &&
            (existing.sourceHandle ?? null) === (edge.sourceHandle ?? null)
        )
        return exists ? flow : { ...flow, edges: [...flow.edges, edge] }
      })
    },
    [mutateFlow]
  )

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      mutateFlow((flow) => ({ ...flow, edges: flow.edges.filter((edge) => edge.id !== edgeId) }))
    },
    [mutateFlow]
  )

  const handleConfigChange = useCallback(
    (nodeId: string, config: FlowNode['config']) => {
      mutateFlow((flow) => ({
        ...flow,
        nodes: flow.nodes.map((node) => (node.id === nodeId ? { ...node, config } : node))
      }))
    },
    [mutateFlow]
  )

  const handleLabelChange = useCallback(
    (nodeId: string, label: string) => {
      mutateFlow((flow) => ({
        ...flow,
        nodes: flow.nodes.map((node) =>
          node.id === nodeId ? { ...node, label: label || undefined } : node
        )
      }))
    },
    [mutateFlow]
  )

  const handleCreateFlow = useCallback(async () => {
    try {
      const flow = await createFlow({
        name: 'New flow',
        nodes: [
          {
            id: createBrowserUuid(),
            config: createDefaultNodeConfig('trigger-manual'),
            position: { x: 80, y: 120 }
          }
        ]
      })
      setSelectedFlowId(flow.id)
    } catch (error) {
      console.error('[flows] failed to create flow:', error)
      toast.error(translate('auto.components.flows.FlowsPage.7838f45ff5', 'Failed to create flow'))
    }
  }, [createFlow])

  const handleDeleteFlow = useCallback(async () => {
    if (!editingFlow) {
      return
    }
    const nextSelection = flowSummaries.find((summary) => summary.id !== editingFlow.id)
    try {
      await deleteFlow(editingFlow.id)
      setSelectedFlowId(nextSelection?.id ?? null)
    } catch (error) {
      console.error('[flows] failed to delete flow:', error)
      toast.error(translate('auto.components.flows.FlowsPage.e2215cec19', 'Failed to delete flow'))
    }
  }, [deleteFlow, editingFlow, flowSummaries])

  const validation = useMemo(
    () => (editingFlow ? validateFlowGraph(editingFlow) : null),
    [editingFlow]
  )
  const invalidNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const issue of validation?.errors ?? []) {
      if (issue.nodeId) {
        ids.add(issue.nodeId)
      }
    }
    for (const issue of validation?.warnings ?? []) {
      if (issue.nodeId) {
        ids.add(issue.nodeId)
      }
    }
    return ids
  }, [validation])

  const selectedNode = editingFlow?.nodes.find((node) => node.id === selectedNodeId) ?? null

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <FlowsHeader
        flow={editingFlow}
        saveState={saveState}
        onRename={(name) => mutateFlow((flow) => ({ ...flow, name }))}
        onToggleEnabled={(enabled) => mutateFlow((flow) => ({ ...flow, enabled }))}
        onCreate={handleCreateFlow}
        onDelete={handleDeleteFlow}
        onClose={closeFlowsPage}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 border-r border-border">
          <FlowList
            flows={flowSummaries}
            selectedFlowId={selectedFlowId}
            onSelect={setSelectedFlowId}
          />
        </aside>

        {editingFlow ? (
          <div className="flex min-w-0 flex-1 flex-col">
            {validation && validation.errors.length > 0 ? (
              <ValidationBanner messages={validation.errors.map((issue) => issue.message)} />
            ) : null}
            <div className="flex min-h-0 flex-1">
              <aside className="w-52 shrink-0 border-r border-border">
                <NodePalette onAddNode={handleAppendNode} />
              </aside>
              <div className="min-w-0 flex-1">
                <FlowCanvas
                  flow={editingFlow}
                  selectedNodeId={selectedNodeId}
                  invalidNodeIds={invalidNodeIds}
                  onSelectNode={setSelectedNodeId}
                  onNodePositionChange={handleNodePositionChange}
                  onDeleteNode={handleDeleteNode}
                  onConnect={handleConnect}
                  onDeleteEdge={handleDeleteEdge}
                  onAddNodeAtPosition={handleAddNode}
                />
              </div>
              <aside className="w-72 shrink-0 border-l border-border">
                {selectedNode ? (
                  <NodeInspector
                    key={selectedNode.id}
                    node={selectedNode}
                    onConfigChange={(config) => handleConfigChange(selectedNode.id, config)}
                    onLabelChange={(label) => handleLabelChange(selectedNode.id, label)}
                    onDelete={() => handleDeleteNode(selectedNode.id)}
                  />
                ) : (
                  <div className="p-3 text-xs text-muted-foreground">
                    {translate(
                      'auto.components.flows.FlowsPage.59f683f974',
                      'Select a node to edit it, or drag one from the palette.'
                    )}
                  </div>
                )}
              </aside>
            </div>
          </div>
        ) : (
          <FlowsEmptyState onCreate={handleCreateFlow} hasFlows={flowSummaries.length > 0} />
        )}
      </div>
    </div>
  )
}
