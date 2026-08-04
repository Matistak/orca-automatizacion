import type { AutomationRunOutputSnapshot } from '../../shared/automations-types'
import type { FlowNode, FlowRun } from '../../shared/flows-types'
import {
  buildFlowWorkspaceProvenance,
  flowNodeProvenanceLabel
} from '../../shared/flow-workspace-provenance'
import type { Repo } from '../../shared/types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { createHeadlessAutomationOutputSnapshotBuffer } from '../automations/headless-dispatch'
import type {
  FlowExecutionContext,
  FlowNodeDispatcher,
  FlowNodeResult
} from './flow-node-dispatcher'
import type { FlowRepository } from './flow-repository'

const TERMINAL_SNAPSHOT_LIMIT = 2_000

/**
 * The slice of the runtime service a headless agent node needs. Derived from the
 * real service so signature drift is a type error, not a runtime surprise.
 */
export type HeadlessFlowRuntime = Pick<
  OrcaRuntimeService,
  | 'createManagedWorktree'
  | 'launchAgentTerminal'
  | 'showManagedWorktree'
  | 'waitForTerminal'
  | 'readTerminal'
>

type CreateManagedWorktreeArgs = Parameters<HeadlessFlowRuntime['createManagedWorktree']>[0]

/** Deterministic, short workspace name carrying the run that created it. */
export function buildHeadlessFlowWorkspaceName(args: {
  flowName: string
  node: FlowNode
  runNumber: number | null
  createdAt: number
}): string {
  const slug = `${args.flowName}-${flowNodeProvenanceLabel(args.node)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const stamp = new Date(args.createdAt).toISOString().replace(/[-:]/g, '').slice(0, 13)
  return `flow-${slug || 'run'}-${args.runNumber ?? stamp}`
}

function failed(error: string): FlowNodeResult {
  return {
    status: 'dispatch_failed',
    output: null,
    usage: null,
    exitCode: null,
    workspaceId: null,
    workspaceDisplayName: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    error
  }
}

/**
 * Runs agent nodes in a server process, where no renderer exists to drive the
 * workspace/terminal machinery. Same shape as the automation headless
 * dispatcher: create-or-reuse a workspace, launch the agent, wait for the TUI to
 * go idle, and capture its tail as the node output.
 */
export function createHeadlessFlowNodeDispatcher(args: {
  runtime: HeadlessFlowRuntime
  repository: FlowRepository
  getRepo: (repoId: string) => Repo | undefined
}): FlowNodeDispatcher {
  return {
    dispatchNode: async ({ node, context }) => {
      const config = node.config
      if (config.kind !== 'agent-prompt') {
        return failed(`Headless flow dispatch cannot run a ${config.kind} node.`)
      }
      try {
        const launched =
          config.workspaceMode === 'new_per_run'
            ? await createWorkspaceForNode({ ...args, node, config, context })
            : await reuseWorkspaceForNode({ runtime: args.runtime, config })
        return await awaitCompletion(args.runtime, launched)
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error))
      }
    }
  }
}

type LaunchedNode = {
  handle: string
  workspaceId: string
  workspaceDisplayName: string | null
  terminalSessionId: string | null
  terminalPaneKey: string | null
  terminalPtyId: string | null
}

async function createWorkspaceForNode(args: {
  runtime: HeadlessFlowRuntime
  repository: FlowRepository
  getRepo: (repoId: string) => Repo | undefined
  node: FlowNode
  config: Extract<FlowNode['config'], { kind: 'agent-prompt' }>
  context: FlowExecutionContext
}): Promise<LaunchedNode> {
  const projectId = args.config.projectId
  if (!projectId) {
    throw new Error('This agent node has no project to create its workspace in.')
  }
  const repo = args.getRepo(projectId)
  if (!repo) {
    throw new Error('The project for this agent node is no longer available.')
  }
  const run = args.repository.getRun(args.context.flowRunId)
  if (!run) {
    throw new Error('The flow run for this node is no longer available.')
  }
  const createdAt = Date.now()
  const createArgs: CreateManagedWorktreeArgs = {
    repoSelector: repo.id,
    name: buildHeadlessFlowWorkspaceName({
      flowName: args.context.flowName,
      node: args.node,
      runNumber: args.context.runNumber,
      createdAt
    }),
    baseBranch: args.config.baseBranch ?? undefined,
    setupDecision: args.config.setupDecision ?? 'skip',
    activate: false,
    createdWithAgent: args.config.agentId,
    startupAgent: args.config.agentId,
    startupPrompt: args.config.prompt,
    telemetrySource: 'unknown',
    automationProvenance: buildFlowWorkspaceProvenance({
      run: run satisfies Pick<FlowRun, 'id' | 'flowId' | 'flowSnapshot' | 'runNumber'>,
      node: args.node,
      projectId,
      repo,
      createdAt
    })
  }
  const created = await args.runtime.createManagedWorktree(createArgs)
  const handle = created.startupTerminal?.handle ?? ''
  if (!handle) {
    throw new Error(created.warning || 'The workspace was created, but no agent terminal started.')
  }
  return {
    handle,
    workspaceId: created.worktree.id,
    workspaceDisplayName: created.worktree.displayName ?? null,
    terminalSessionId: created.startupTerminal?.tabId ?? null,
    terminalPaneKey: created.startupTerminal?.paneKey ?? null,
    terminalPtyId: created.startupTerminal?.ptyId ?? null
  }
}

async function reuseWorkspaceForNode(args: {
  runtime: HeadlessFlowRuntime
  config: Extract<FlowNode['config'], { kind: 'agent-prompt' }>
}): Promise<LaunchedNode> {
  if (!args.config.workspaceId) {
    throw new Error('The target workspace is no longer available.')
  }
  const terminal = await args.runtime.launchAgentTerminal(`id:${args.config.workspaceId}`, {
    agent: args.config.agentId,
    prompt: args.config.prompt
  })
  const worktree = await args.runtime.showManagedWorktree(`id:${terminal.worktreeId}`)
  return {
    handle: terminal.handle,
    workspaceId: terminal.worktreeId,
    workspaceDisplayName: worktree.displayName ?? null,
    terminalSessionId: terminal.tabId ?? null,
    terminalPaneKey: terminal.paneKey ?? null,
    terminalPtyId: terminal.ptyId ?? null
  }
}

async function awaitCompletion(
  runtime: HeadlessFlowRuntime,
  launched: LaunchedNode
): Promise<FlowNodeResult> {
  const wait = await runtime.waitForTerminal(launched.handle, { condition: 'tui-idle' })
  const read = await runtime.readTerminal(launched.handle, { limit: TERMINAL_SNAPSHOT_LIMIT })
  const buffer = createHeadlessAutomationOutputSnapshotBuffer()
  buffer.append(read.tail.join('\n'))
  const output: AutomationRunOutputSnapshot | null = buffer.snapshot()
  const target = {
    workspaceId: launched.workspaceId,
    workspaceDisplayName: launched.workspaceDisplayName,
    terminalSessionId: launched.terminalSessionId,
    terminalPaneKey: launched.terminalPaneKey,
    terminalPtyId: launched.terminalPtyId
  }
  if (wait.satisfied) {
    return { status: 'completed', output, usage: null, exitCode: null, ...target, error: null }
  }
  return {
    status: 'dispatch_failed',
    output,
    usage: null,
    exitCode: null,
    ...target,
    error: wait.blockedReason
      ? `The agent is blocked: ${wait.blockedReason}.`
      : 'The agent did not report completion.'
  }
}
