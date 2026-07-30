import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutomationPrecheckResult } from '../../shared/automations-types'
import type { FlowNode } from '../../shared/flows-types'
import type { Repo } from '../../shared/types'
import { WORKTREE_ID_SEPARATOR } from '../../shared/worktree-id'
import type { FlowExecutionContext } from './flow-node-dispatcher'

const runAutomationPrecheck = vi.fn()
vi.mock('../automations/precheck-runner', () => ({
  runAutomationPrecheck: (args: unknown) => runAutomationPrecheck(args)
}))

const { dispatchShellFlowNode } = await import('./shell-flow-node-dispatcher')

const repo = { id: 'repo-1', path: '/repos/app' } as Repo
const workspaceId = `repo-1${WORKTREE_ID_SEPARATOR}/repos/app/wt-a`

const context: FlowExecutionContext = {
  flowId: 'flow-1',
  flowName: 'Flow',
  flowRunId: 'run-1',
  runNumber: 1,
  trigger: 'manual',
  results: new Map(),
  previousNodeId: null
}

function shellNode(overrides: Record<string, unknown> = {}): FlowNode {
  return {
    id: 'node-1',
    position: { x: 0, y: 0 },
    config: {
      kind: 'shell-command',
      command: 'npm test',
      timeoutSeconds: 60,
      workspaceId,
      ...overrides
    }
  }
}

function precheckResult(overrides: Partial<AutomationPrecheckResult>): AutomationPrecheckResult {
  return {
    command: 'npm test',
    exitCode: 0,
    timedOut: false,
    durationMs: 5,
    stdout: 'ok',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    error: null,
    startedAt: 0,
    completedAt: 5,
    ...overrides
  }
}

describe('dispatchShellFlowNode', () => {
  beforeEach(() => {
    runAutomationPrecheck.mockReset()
  })

  it('completes and captures the exit code and output', async () => {
    runAutomationPrecheck.mockResolvedValue(precheckResult({ exitCode: 0, stdout: 'all green' }))
    const result = await dispatchShellFlowNode({
      node: shellNode(),
      context,
      getRepo: () => repo
    })
    expect(result.status).toBe('completed')
    expect(result.exitCode).toBe(0)
    expect(result.workspaceId).toBe(workspaceId)
    expect(result.output?.content).toContain('all green')
  })

  it('fails the node on a non-zero exit by default', async () => {
    runAutomationPrecheck.mockResolvedValue(precheckResult({ exitCode: 2, stderr: 'boom' }))
    const result = await dispatchShellFlowNode({
      node: shellNode(),
      context,
      getRepo: () => repo
    })
    expect(result.status).toBe('dispatch_failed')
    expect(result.error).toContain('2')
  })

  it('keeps a non-zero exit runnable when the node opts out, so a condition can branch', async () => {
    runAutomationPrecheck.mockResolvedValue(precheckResult({ exitCode: 1 }))
    const result = await dispatchShellFlowNode({
      node: shellNode({ failOnNonZeroExit: false }),
      context,
      getRepo: () => repo
    })
    expect(result.status).toBe('completed')
    expect(result.exitCode).toBe(1)
  })

  it('still fails on a timeout even when non-zero exits are allowed', async () => {
    runAutomationPrecheck.mockResolvedValue(precheckResult({ exitCode: null, timedOut: true }))
    const result = await dispatchShellFlowNode({
      node: shellNode({ failOnNonZeroExit: false }),
      context,
      getRepo: () => repo
    })
    expect(result.status).toBe('dispatch_failed')
  })

  it('skips when no workspace can be resolved', async () => {
    const result = await dispatchShellFlowNode({
      node: shellNode({ workspaceId: null }),
      context,
      getRepo: () => repo
    })
    expect(result.status).toBe('skipped_unavailable')
    expect(runAutomationPrecheck).not.toHaveBeenCalled()
  })
})
