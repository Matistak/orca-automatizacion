import { z } from 'zod'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { defineMethod, type RpcMethod } from '../core'
import { OptionalPositiveInt, OptionalString, requiredNumber, requiredString } from '../schemas'

const TuiAgent = requiredString('Missing provider').refine(isTuiAgent, {
  message: 'Unknown provider'
})

const WorkspaceMode = z.enum(['existing', 'new_per_run'])
const SetupDecision = z.enum(['inherit', 'run', 'skip']).optional()
const NullableString = z.union([z.string(), z.null()]).optional()

const ConditionExpression = z.discriminatedUnion('source', [
  z.object({ source: z.literal('exit-code'), equals: requiredNumber('Missing exit code') }),
  z.object({
    source: z.literal('output-contains'),
    substring: requiredString('Missing substring'),
    caseSensitive: z.boolean().optional()
  })
])

// Why: mirrors the FlowNodeConfig discriminated union in shared/flows-types.ts.
const NodeConfig = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('trigger-schedule'),
    rrule: requiredString('Missing trigger'),
    dtstart: requiredNumber('Missing trigger start time'),
    timezone: requiredString('Missing timezone')
  }),
  z.object({ kind: z.literal('trigger-manual') }),
  z.object({
    kind: z.literal('agent-prompt'),
    agentId: TuiAgent,
    prompt: requiredString('Missing prompt'),
    workspaceMode: WorkspaceMode,
    workspaceId: NullableString,
    baseBranch: NullableString,
    setupDecision: SetupDecision,
    reuseSession: z.boolean().optional()
  }),
  z.object({
    kind: z.literal('shell-command'),
    command: requiredString('Missing command'),
    timeoutSeconds: requiredNumber('Missing timeout')
  }),
  z.object({ kind: z.literal('condition'), expression: ConditionExpression })
])

const FlowNode = z.object({
  id: requiredString('Missing node id'),
  config: NodeConfig,
  position: z.object({ x: z.number(), y: z.number() }),
  label: OptionalString
})

const FlowEdge = z.object({
  id: requiredString('Missing edge id'),
  source: requiredString('Missing edge source'),
  sourceHandle: OptionalString,
  target: requiredString('Missing edge target')
})

const FlowId = z.object({ id: requiredString('Missing flow id') })

const FlowRuns = z.object({
  flowId: requiredString('Missing flow id'),
  limit: OptionalPositiveInt
})

const FlowCreate = z.object({
  name: requiredString('Missing flow name'),
  description: OptionalString,
  nodes: z.array(FlowNode).optional(),
  edges: z.array(FlowEdge).optional(),
  enabled: z.boolean().optional()
})

const FlowUpdate = z.object({
  id: requiredString('Missing flow id'),
  updates: z.object({
    name: OptionalString,
    description: OptionalString,
    nodes: z.array(FlowNode).optional(),
    edges: z.array(FlowEdge).optional(),
    enabled: z.boolean().optional()
  })
})

export const FLOW_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'flow.list',
    params: null,
    handler: (_params, { runtime }) => ({ flows: runtime.listFlows() })
  }),
  defineMethod({
    name: 'flow.show',
    params: FlowId,
    handler: (params, { runtime }) => ({ flow: runtime.getFlow(params.id) })
  }),
  defineMethod({
    name: 'flow.create',
    params: FlowCreate,
    handler: (params, { runtime }) => ({ flow: runtime.createFlow(params) })
  }),
  defineMethod({
    name: 'flow.update',
    params: FlowUpdate,
    handler: (params, { runtime }) => ({ flow: runtime.updateFlow(params.id, params.updates) })
  }),
  defineMethod({
    name: 'flow.delete',
    params: FlowId,
    handler: (params, { runtime }) => runtime.deleteFlow(params.id)
  }),
  defineMethod({
    name: 'flow.runs',
    params: FlowRuns,
    handler: (params, { runtime }) => ({
      runs: runtime.listFlowRuns(params.flowId, params.limit)
    })
  })
]
