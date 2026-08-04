import {
  FLOW_SCHEMA_VERSION,
  type Flow,
  type FlowCreateInput,
  type FlowEdge,
  type FlowNode,
  type FlowNodeKind
} from './flows-types'

/**
 * Portable JSON envelope for sharing a single flow between machines (and for
 * debugging: a flow file is diffable, a store blob is not).
 *
 * What travels: the graph and its labels. What does not: the flow id, run
 * history and timestamps — those are per-install. Importing always creates a new
 * flow, so an import can never overwrite an existing one.
 *
 * Machine-local references inside a node config (projectId / workspaceId) are
 * kept verbatim: dropping them would silently break same-machine round-trips.
 * On a machine where they don't resolve, validateFlowGraph already reports the
 * dangling reference in the editor banner.
 */

export const FLOW_DOCUMENT_KIND = 'orca.flow'

export type FlowPortableDocument = {
  kind: typeof FLOW_DOCUMENT_KIND
  /** The flow schema the graph was written against; drives migration on import. */
  schemaVersion: number
  exportedAt: number
  flow: {
    name: string
    description?: string
    nodes: FlowNode[]
    edges: FlowEdge[]
  }
}

/** Result of the export/import file flow; crosses the IPC boundary as-is. */
export type FlowExportOutcome =
  | { status: 'saved'; filePath: string }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

export type FlowImportOutcome =
  | { status: 'imported'; flow: Flow }
  | { status: 'canceled' }
  | { status: 'error'; message: string }

export type FlowDocumentParseResult =
  | { ok: true; input: FlowCreateInput }
  | { ok: false; error: string }

const NODE_KINDS: readonly FlowNodeKind[] = [
  'trigger-schedule',
  'trigger-manual',
  'agent-prompt',
  'shell-command',
  'condition'
]

export function buildFlowPortableDocument(flow: Flow, exportedAt: number): FlowPortableDocument {
  return {
    kind: FLOW_DOCUMENT_KIND,
    schemaVersion: flow.schemaVersion || FLOW_SCHEMA_VERSION,
    exportedAt,
    flow: {
      name: flow.name,
      ...(flow.description === undefined ? {} : { description: flow.description }),
      nodes: flow.nodes,
      edges: flow.edges
    }
  }
}

export function serializeFlowPortableDocument(flow: Flow, exportedAt: number): string {
  return `${JSON.stringify(buildFlowPortableDocument(flow, exportedAt), null, 2)}\n`
}

/** Suggested file name; kept filesystem-safe across all three platforms. */
export function flowDocumentFileName(flowName: string): string {
  const slug = flowName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'flow'}.orca-flow.json`
}

/**
 * Validates an untrusted document and returns the input for createFlow. Rejects
 * rather than repairs: a half-understood graph would run the wrong thing.
 */
export function parseFlowPortableDocument(text: string): FlowDocumentParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' }
  }
  if (!isRecord(raw) || raw.kind !== FLOW_DOCUMENT_KIND) {
    return { ok: false, error: 'The file is not an Orca flow export.' }
  }
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > FLOW_SCHEMA_VERSION) {
    return { ok: false, error: 'The flow was exported by a newer version of Orca.' }
  }
  const flow = raw.flow
  if (!isRecord(flow) || typeof flow.name !== 'string' || !flow.name.trim()) {
    return { ok: false, error: 'The flow is missing a name.' }
  }

  const nodes: FlowNode[] = []
  const nodeIds = new Set<string>()
  for (const candidate of toArray(flow.nodes)) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      !candidate.id ||
      !isRecord(candidate.config) ||
      !NODE_KINDS.includes(candidate.config.kind as FlowNodeKind)
    ) {
      return { ok: false, error: 'The flow contains an unreadable node.' }
    }
    if (nodeIds.has(candidate.id)) {
      return { ok: false, error: 'The flow contains duplicate node ids.' }
    }
    nodeIds.add(candidate.id)
    nodes.push({
      id: candidate.id,
      config: candidate.config as FlowNode['config'],
      position: readPosition(candidate.position),
      ...(typeof candidate.label === 'string' ? { label: candidate.label } : {})
    })
  }

  const edges: FlowEdge[] = []
  for (const candidate of toArray(flow.edges)) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.source !== 'string' ||
      typeof candidate.target !== 'string'
    ) {
      return { ok: false, error: 'The flow contains an unreadable connection.' }
    }
    if (!nodeIds.has(candidate.source) || !nodeIds.has(candidate.target)) {
      return { ok: false, error: 'The flow has a connection pointing at a missing node.' }
    }
    edges.push({
      id: candidate.id,
      source: candidate.source,
      target: candidate.target,
      ...(typeof candidate.sourceHandle === 'string'
        ? { sourceHandle: candidate.sourceHandle }
        : {})
    })
  }

  return {
    ok: true,
    input: {
      name: flow.name.trim(),
      ...(typeof flow.description === 'string' ? { description: flow.description } : {}),
      nodes,
      edges,
      // Why: an imported scheduled flow must not start firing before the user has
      // reviewed its workspace/project references on this machine.
      enabled: false
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readPosition(value: unknown): { x: number; y: number } {
  // Canvas coordinates are cosmetic — a missing one lands the node at the origin
  // instead of failing the import.
  if (isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number') {
    return { x: value.x, y: value.y }
  }
  return { x: 0, y: 0 }
}
