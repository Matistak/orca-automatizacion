import { describe, expect, it } from 'vitest'
import type { Repo } from '../../shared/types'
import { WORKTREE_ID_SEPARATOR } from '../../shared/worktree-id'
import type { FlowExecutionContext, FlowNodeResult } from './flow-node-dispatcher'
import { inheritedWorkspaceId, resolveFlowShellTarget } from './flow-shell-target'

const repo = { id: 'repo-1', path: '/repos/app' } as Repo
const sshRepo = { id: 'repo-2', path: '/repos/api', connectionId: 'ssh-1' } as Repo
const workspaceId = `repo-1${WORKTREE_ID_SEPARATOR}/repos/app/wt-a`

function nodeResult(overrides: Partial<FlowNodeResult>): FlowNodeResult {
  return {
    status: 'completed',
    output: null,
    usage: null,
    exitCode: null,
    workspaceId: null,
    workspaceDisplayName: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    error: null,
    ...overrides
  }
}

function contextWith(results: [string, FlowNodeResult][]): FlowExecutionContext {
  return {
    flowId: 'flow-1',
    flowName: 'Flow',
    flowRunId: 'run-1',
    runNumber: 1,
    trigger: 'manual',
    results: new Map(results),
    previousNodeId: results.at(-1)?.[0] ?? null
  }
}

describe('resolveFlowShellTarget', () => {
  it('resolves a local workspace to its path', () => {
    const target = resolveFlowShellTarget({ workspaceId, getRepo: () => repo })
    expect(target).toEqual({
      ok: true,
      workspaceId,
      cwd: '/repos/app/wt-a',
      connectionId: null
    })
  })

  it('carries the repo SSH connection so remote hosts run remotely', () => {
    const target = resolveFlowShellTarget({
      workspaceId: `repo-2${WORKTREE_ID_SEPARATOR}/repos/api/wt-b`,
      getRepo: () => sshRepo
    })
    expect(target).toMatchObject({ ok: true, connectionId: 'ssh-1' })
  })

  it('fails with guidance when no workspace is available', () => {
    const target = resolveFlowShellTarget({ workspaceId: null, getRepo: () => repo })
    expect(target.ok).toBe(false)
  })

  it('fails when the project is gone', () => {
    const target = resolveFlowShellTarget({ workspaceId, getRepo: () => undefined })
    expect(target).toMatchObject({ ok: false })
  })
})

describe('inheritedWorkspaceId', () => {
  it('takes the most recent upstream workspace', () => {
    const context = contextWith([
      ['a', nodeResult({ workspaceId: 'repo-1::/first' })],
      ['b', nodeResult({ workspaceId: 'repo-1::/second' })],
      ['c', nodeResult({ workspaceId: null })]
    ])
    expect(inheritedWorkspaceId(context)).toBe('repo-1::/second')
  })

  it('is null when no upstream node produced a workspace', () => {
    expect(inheritedWorkspaceId(contextWith([['a', nodeResult({})]]))).toBeNull()
  })
})
