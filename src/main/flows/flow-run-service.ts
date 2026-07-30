import type { WebContents } from 'electron'
import type {
  Flow,
  FlowNodeDispatchResult,
  FlowNodeRun,
  FlowRun,
  FlowRunStatus,
  FlowRunTrigger
} from '../../shared/flows-types'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import type { Store } from '../persistence'
import { FlowExecutionEngine } from './flow-execution-engine'
import { createFlowNodeUsageCollector } from './flow-node-usage-collection'
import type { FlowNodeDispatcher } from './flow-node-dispatcher'
import type { FlowRepository } from './flow-repository'
import { RendererFlowNodeDispatcher } from './renderer-flow-node-dispatcher'
import { dispatchShellFlowNode } from './shell-flow-node-dispatcher'

/**
 * Wraps the repository so every write that changes a run reaches the renderer.
 * Keeping it here (rather than in the repository) leaves storage free of any
 * knowledge about windows or IPC.
 */
class BroadcastingFlowRepository implements FlowRepository {
  constructor(
    private readonly inner: FlowRepository,
    private readonly onRunChanged: (run: FlowRun) => void
  ) {}

  listFlowSummaries = (): ReturnType<FlowRepository['listFlowSummaries']> =>
    this.inner.listFlowSummaries()
  getFlow = (id: string): Flow | undefined => this.inner.getFlow(id)
  createFlow: FlowRepository['createFlow'] = (input) => this.inner.createFlow(input)
  updateFlow: FlowRepository['updateFlow'] = (id, patch) => this.inner.updateFlow(id, patch)
  deleteFlow = (id: string): void => this.inner.deleteFlow(id)
  listRunsByFlow = (flowId: string, limit?: number): FlowRun[] =>
    this.inner.listRunsByFlow(flowId, limit)
  getRun = (runId: string): FlowRun | undefined => this.inner.getRun(runId)
  pruneRuns = (flowId: string, keep: number): void => this.inner.pruneRuns(flowId, keep)

  appendRun = (run: FlowRun): FlowRun => this.notify(this.inner.appendRun(run))
  updateNodeRun = (runId: string, nodeRun: FlowNodeRun): FlowRun =>
    this.notify(this.inner.updateNodeRun(runId, nodeRun))
  updateRunStatus = (runId: string, status: FlowRunStatus, completedAt: number | null): FlowRun =>
    this.notify(this.inner.updateRunStatus(runId, status, completedAt))

  private notify(run: FlowRun): FlowRun {
    this.onRunChanged(run)
    return run
  }
}

/**
 * Owns manual flow execution: resolves the flow, guards against a second
 * concurrent run of the same flow, and routes each node kind to the dispatcher
 * that can execute it (shell in main, agent in the renderer).
 */
export class FlowRunService {
  private readonly repository: FlowRepository
  private readonly rendererDispatcher: RendererFlowNodeDispatcher
  private readonly running = new Set<string>()
  private webContents: WebContents | null = null

  constructor(
    private readonly store: Store,
    repository: FlowRepository,
    opts: {
      claudeUsage?: ClaudeUsageStore | null
      codexUsage?: CodexUsageStore | null
    } = {}
  ) {
    this.repository = new BroadcastingFlowRepository(repository, (run) => this.broadcastRun(run))
    this.rendererDispatcher = new RendererFlowNodeDispatcher(
      this.repository,
      () => this.webContents,
      createFlowNodeUsageCollector({
        claudeUsage: opts.claudeUsage ?? null,
        codexUsage: opts.codexUsage ?? null
      })
    )
  }

  setWebContents(webContents: WebContents | null): void {
    this.webContents = webContents
    if (!webContents) {
      this.rendererDispatcher.abandonAll('The Orca window closed before this node finished.')
    }
  }

  reportNodeResult(result: FlowNodeDispatchResult): void {
    this.rendererDispatcher.reportNodeResult(result)
  }

  isRunning(flowId: string): boolean {
    return this.running.has(flowId)
  }

  async runNow(flowId: string): Promise<FlowRun> {
    const flow = this.repository.getFlow(flowId)
    if (!flow) {
      throw new Error('Flow not found.')
    }
    // Why: mirrors the scheduler's `evaluating` guard — a flow must never have
    // two live runs writing node results into each other's history.
    if (this.running.has(flowId)) {
      throw new Error('This flow is already running.')
    }
    this.running.add(flowId)
    try {
      const engine = new FlowExecutionEngine(this.repository, this.createDispatcher())
      const { run } = await engine.run(flow, 'manual' satisfies FlowRunTrigger)
      return run
    } finally {
      this.running.delete(flowId)
    }
  }

  private createDispatcher(): FlowNodeDispatcher {
    return {
      dispatchNode: async ({ node, context }) => {
        if (node.config.kind === 'shell-command') {
          return await dispatchShellFlowNode({
            node,
            context,
            getRepo: (repoId) => this.store.getRepo(repoId)
          })
        }
        return await this.rendererDispatcher.dispatchAgentNode({ node, context })
      }
    }
  }

  private broadcastRun(run: FlowRun): void {
    const webContents = this.webContents
    if (!webContents || webContents.isDestroyed()) {
      return
    }
    webContents.send('flows:runUpdated', { run })
  }
}
