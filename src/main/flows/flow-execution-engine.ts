import { randomUUID } from 'node:crypto'
import type {
  Flow,
  FlowNode,
  FlowNodeRun,
  FlowRun,
  FlowRunStatus,
  FlowRunTrigger
} from '../../shared/flows-types'
import { isFinalAutomationRunStatus } from '../../shared/automations-types'
import type { FlowRepository } from './flow-repository'
import type {
  FlowExecutionContext,
  FlowNodeDispatcher,
  FlowNodeResult
} from './flow-node-dispatcher'
import {
  findTriggerNode,
  isTriggerKind,
  outgoingEdges,
  topologicalOrder,
  validateFlowGraph
} from './flow-graph'
import { evaluateCondition } from './flow-condition'
import { interpolateNodeConfig } from './flow-context-interpolation'

export type FlowExecutionResult = {
  run: FlowRun
  status: FlowRunStatus
}

/** A node the flow reached but did not activate, or one an upstream failure cut. */
const SKIPPED_STATUS = 'skipped_unavailable' as const

function completedResult(): FlowNodeResult {
  return {
    status: 'completed',
    output: null,
    usage: null,
    exitCode: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    error: null
  }
}

function nodeRunFrom(nodeId: string, result: FlowNodeResult, startedAt: number): FlowNodeRun {
  return {
    nodeId,
    status: result.status,
    output: result.output,
    usage: result.usage,
    terminalSessionId: result.terminalSessionId,
    terminalPaneKey: result.terminalPaneKey,
    terminalPtyId: result.terminalPtyId,
    error: result.error,
    startedAt,
    completedAt: Date.now()
  }
}

function skippedNodeRun(nodeId: string): FlowNodeRun {
  return {
    nodeId,
    status: SKIPPED_STATUS,
    output: null,
    usage: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    error: null,
    startedAt: null,
    completedAt: null
  }
}

/**
 * Executes a flow graph end to end: validates it as a DAG, walks it in
 * topological order following the branches a `condition` node selects, and
 * persists a FlowNodeRun per node as it goes. Side-effecting work is delegated
 * to a FlowNodeDispatcher so this stays testable without a renderer or shell.
 */
export class FlowExecutionEngine {
  constructor(
    private readonly repository: FlowRepository,
    private readonly dispatcher: FlowNodeDispatcher
  ) {}

  async run(flow: Flow, trigger: FlowRunTrigger): Promise<FlowExecutionResult> {
    const validation = validateFlowGraph(flow)
    if (!validation.ok) {
      throw new Error(
        `Cannot run invalid flow: ${validation.errors.map((issue) => issue.message).join(' ')}`
      )
    }

    // Freeze the graph so history stays interpretable after later edits.
    const snapshot: Flow = structuredClone(flow)
    const startedAt = Date.now()
    const run = this.repository.appendRun({
      id: randomUUID(),
      flowId: flow.id,
      flowSnapshot: snapshot,
      status: 'running',
      trigger,
      nodeRuns: [],
      startedAt,
      completedAt: null
    })

    const finalStatus = await this.walk(snapshot, run.id)
    const persisted = this.repository.updateRunStatus(run.id, finalStatus, Date.now())
    return { run: persisted, status: finalStatus }
  }

  private async walk(flow: Flow, runId: string): Promise<FlowRunStatus> {
    const order = topologicalOrder(flow)
    const trigger = findTriggerNode(flow)
    const results = new Map<string, FlowNodeResult>()
    // Edges whose branch execution actually took; gates downstream activation.
    const liveEdges = new Set<string>()
    let previousNodeId: string | null = null
    let anyFailed = false

    for (const node of order) {
      if (!this.isActivated(flow, node, trigger, liveEdges)) {
        this.repository.updateNodeRun(runId, skippedNodeRun(node.id))
        continue
      }

      const context: FlowExecutionContext = { flowRunId: runId, results, previousNodeId }
      const startedAt = Date.now()
      const result = await this.executeNode(flow, node, context, results)
      results.set(node.id, result)
      this.repository.updateNodeRun(runId, nodeRunFrom(node.id, result, startedAt))
      previousNodeId = node.id

      const failed = isFinalAutomationRunStatus(result.status) && result.status !== 'completed'
      if (failed) {
        anyFailed = true
        // Leave this node's outgoing edges dead so downstream nodes skip.
        continue
      }
      this.activateOutgoing(flow, node, results, liveEdges)
    }

    return anyFailed ? 'failed' : 'completed'
  }

  private isActivated(
    flow: Flow,
    node: FlowNode,
    trigger: FlowNode | undefined,
    liveEdges: Set<string>
  ): boolean {
    if (trigger && node.id === trigger.id) {
      return true
    }
    return flow.edges.some((edge) => edge.target === node.id && liveEdges.has(edge.id))
  }

  private activateOutgoing(
    flow: Flow,
    node: FlowNode,
    results: Map<string, FlowNodeResult>,
    liveEdges: Set<string>
  ): void {
    const edges = outgoingEdges(flow, node.id)
    if (node.config.kind === 'condition') {
      // A condition branches on its upstream node's result, not its own.
      const handle = evaluateCondition(
        node.config.expression,
        this.incomingResult(flow, node, results)
      )
      for (const edge of edges) {
        if ((edge.sourceHandle ?? 'true') === handle) {
          liveEdges.add(edge.id)
        }
      }
      return
    }
    for (const edge of edges) {
      liveEdges.add(edge.id)
    }
  }

  private async executeNode(
    flow: Flow,
    node: FlowNode,
    context: FlowExecutionContext,
    results: Map<string, FlowNodeResult>
  ): Promise<FlowNodeResult> {
    if (isTriggerKind(node.config.kind)) {
      return completedResult()
    }
    if (node.config.kind === 'condition') {
      // The condition always "completes"; the chosen branch is applied in
      // activateOutgoing from the same upstream result.
      const chosen = evaluateCondition(
        node.config.expression,
        this.incomingResult(flow, node, results)
      )
      return { ...completedResult(), output: outputText(`condition → ${chosen}`) }
    }
    const interpolated = interpolateNodeConfig(node, context)
    return await this.dispatcher.dispatchNode({ node: interpolated, context })
  }

  private incomingResult(
    flow: Flow,
    node: FlowNode,
    results: Map<string, FlowNodeResult>
  ): FlowNodeResult | undefined {
    for (const edge of flow.edges) {
      if (edge.target === node.id) {
        const upstream = results.get(edge.source)
        if (upstream) {
          return upstream
        }
      }
    }
    return undefined
  }
}

function outputText(content: string) {
  return { format: 'plain_text' as const, content, capturedAt: Date.now(), truncated: false }
}
