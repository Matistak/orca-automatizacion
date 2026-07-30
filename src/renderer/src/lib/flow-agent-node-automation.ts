import type { Automation, AutomationRun } from '../../../shared/automations-types'
import type { FlowNode, FlowNodeDispatchRequest } from '../../../shared/flows-types'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree-id'

/**
 * An `agent-prompt` node needs exactly what an automation dispatch needs, so we
 * project it onto the Automation/AutomationRun shapes and reuse the renderer's
 * dispatch coordinator instead of duplicating workspace + terminal handling.
 * These objects are never persisted — they exist only for the dispatch call.
 */
export function toFlowNodeAutomation(request: FlowNodeDispatchRequest): {
  automation: Automation
  run: AutomationRun
} | null {
  const config = request.node.config
  if (config.kind !== 'agent-prompt') {
    return null
  }
  const projectId =
    config.projectId ?? (config.workspaceId ? getRepoIdFromWorktreeId(config.workspaceId) : null)
  if (!projectId) {
    return null
  }
  const now = Date.now()
  const automation: Automation = {
    id: `flow:${request.flowId}:${request.nodeId}`,
    name: flowNodeRunTitle(request),
    prompt: config.prompt,
    precheck: null,
    agentId: config.agentId,
    projectId,
    executionTargetType: 'local',
    executionTargetId: projectId,
    schedulerOwner: 'local_host_service',
    workspaceMode: config.workspaceMode,
    workspaceId: config.workspaceId ?? null,
    baseBranch: config.baseBranch ?? null,
    setupDecision: config.setupDecision,
    reuseSession: config.reuseSession ?? false,
    timezone: 'UTC',
    rrule: '',
    dtstart: now,
    enabled: true,
    nextRunAt: now,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 0,
    createdAt: now,
    updatedAt: now
  }
  const run: AutomationRun = {
    id: `${request.flowRunId}:${request.nodeId}`,
    automationId: automation.id,
    title: automation.name,
    scheduledFor: now,
    status: 'dispatching',
    // Why: only scheduled automation runs gate on a precheck, and flow nodes
    // have none — keeping every node run 'manual' skips that branch entirely.
    trigger: 'manual',
    workspaceId: config.workspaceId ?? null,
    sessionKind: 'terminal',
    chatSessionId: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    outputSnapshot: null,
    precheckResult: null,
    usage: null,
    error: null,
    startedAt: now,
    dispatchedAt: null,
    createdAt: now
  }
  return { automation, run }
}

export function flowNodeRunTitle(request: FlowNodeDispatchRequest): string {
  const nodeLabel = request.node.label?.trim() || defaultNodeLabel(request.node)
  const runLabel = request.runNumber !== null ? ` #${request.runNumber}` : ''
  return `${request.flowName}${runLabel} · ${nodeLabel}`
}

function defaultNodeLabel(node: FlowNode): string {
  return node.config.kind === 'agent-prompt' ? node.config.agentId : node.config.kind
}
