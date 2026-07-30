import type { Flow, FlowNode, FlowNodeKind } from '../../shared/flows-types'

export type FlowGraphIssue = { code: string; message: string; nodeId?: string }

export type FlowGraphValidation = {
  ok: boolean
  errors: FlowGraphIssue[]
  warnings: FlowGraphIssue[]
}

const TRIGGER_KINDS: readonly FlowNodeKind[] = ['trigger-schedule', 'trigger-manual']

export function isTriggerKind(kind: FlowNodeKind): boolean {
  return TRIGGER_KINDS.includes(kind)
}

/** The single trigger node of a validated flow, or undefined if none/ambiguous. */
export function findTriggerNode(flow: Flow): FlowNode | undefined {
  const triggers = flow.nodes.filter((node) => isTriggerKind(node.config.kind))
  return triggers.length === 1 ? triggers[0] : undefined
}

/** Outgoing edges of a node, in stable declaration order. */
export function outgoingEdges(flow: Flow, nodeId: string) {
  return flow.edges.filter((edge) => edge.source === nodeId)
}

function detectCycle(flow: Flow): string[] | null {
  const adjacency = new Map<string, string[]>()
  for (const edge of flow.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target])
  }
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (nodeId: string): string[] | null => {
    if (state.get(nodeId) === 'done') {
      return null
    }
    if (state.get(nodeId) === 'visiting') {
      // Reconstruct the cycle from where nodeId first appears on the stack.
      const start = stack.indexOf(nodeId)
      return stack.slice(start).concat(nodeId)
    }
    state.set(nodeId, 'visiting')
    stack.push(nodeId)
    for (const next of adjacency.get(nodeId) ?? []) {
      const cycle = visit(next)
      if (cycle) {
        return cycle
      }
    }
    stack.pop()
    state.set(nodeId, 'done')
    return null
  }

  for (const node of flow.nodes) {
    const cycle = visit(node.id)
    if (cycle) {
      return cycle
    }
  }
  return null
}

/**
 * Validate a flow graph before execution. A flow is a DAG with exactly one
 * trigger; cycles, missing/extra triggers, and dangling edges are hard errors.
 * Unreachable nodes are warnings — they simply never run.
 */
export function validateFlowGraph(flow: Flow): FlowGraphValidation {
  const errors: FlowGraphIssue[] = []
  const warnings: FlowGraphIssue[] = []
  const nodeIds = new Set(flow.nodes.map((node) => node.id))

  const triggers = flow.nodes.filter((node) => isTriggerKind(node.config.kind))
  if (triggers.length === 0) {
    errors.push({ code: 'no_trigger', message: 'Flow has no trigger node.' })
  } else if (triggers.length > 1) {
    errors.push({ code: 'multiple_triggers', message: 'Flow has more than one trigger node.' })
  }

  for (const edge of flow.edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push({ code: 'dangling_edge', message: `Edge ${edge.id} has an unknown source.` })
    }
    if (!nodeIds.has(edge.target)) {
      errors.push({ code: 'dangling_edge', message: `Edge ${edge.id} has an unknown target.` })
    }
  }

  for (const node of flow.nodes) {
    if (node.config.kind === 'condition') {
      const handles = new Set(
        outgoingEdges(flow, node.id).map((edge) => edge.sourceHandle ?? 'true')
      )
      if (!handles.has('true') || !handles.has('false')) {
        warnings.push({
          code: 'condition_missing_branch',
          message: 'Condition node is missing a true/false branch.',
          nodeId: node.id
        })
      }
    }
  }

  const cycle = detectCycle(flow)
  if (cycle) {
    errors.push({ code: 'cycle', message: `Flow contains a cycle: ${cycle.join(' → ')}.` })
  }

  if (errors.length === 0) {
    const reachable = reachableFromTrigger(flow)
    for (const node of flow.nodes) {
      if (!reachable.has(node.id) && !isTriggerKind(node.config.kind)) {
        warnings.push({
          code: 'unreachable',
          message: 'Node is not reachable from the trigger.',
          nodeId: node.id
        })
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** Set of node ids reachable from the (single) trigger, ignoring branch choices. */
export function reachableFromTrigger(flow: Flow): Set<string> {
  const trigger = findTriggerNode(flow)
  const reachable = new Set<string>()
  if (!trigger) {
    return reachable
  }
  const queue = [trigger.id]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (reachable.has(nodeId)) {
      continue
    }
    reachable.add(nodeId)
    for (const edge of outgoingEdges(flow, nodeId)) {
      queue.push(edge.target)
    }
  }
  return reachable
}

/**
 * Kahn topological order over the whole graph. Assumes a validated DAG; throws
 * if a cycle slipped through (defensive — validateFlowGraph should catch it).
 */
export function topologicalOrder(flow: Flow): FlowNode[] {
  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const node of flow.nodes) {
    indegree.set(node.id, 0)
  }
  for (const edge of flow.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target])
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }

  const byId = new Map(flow.nodes.map((node) => [node.id, node]))
  const ready = flow.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((n) => n.id)
  const ordered: FlowNode[] = []
  while (ready.length > 0) {
    const nodeId = ready.shift()!
    const node = byId.get(nodeId)
    if (node) {
      ordered.push(node)
    }
    for (const next of adjacency.get(nodeId) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) {
        ready.push(next)
      }
    }
  }
  if (ordered.length !== flow.nodes.length) {
    throw new Error('Cannot compute topological order: flow contains a cycle.')
  }
  return ordered
}
