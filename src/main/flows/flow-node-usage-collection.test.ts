import { describe, expect, it, vi } from 'vitest'
import type { AutomationRunUsage } from '../../shared/automations-types'
import type { FlowNode } from '../../shared/flows-types'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'
import { createFlowNodeUsageCollector } from './flow-node-usage-collection'
import type { FlowNodeResult } from './flow-node-dispatcher'

const knownUsage = {
  status: 'known',
  provider: 'claude',
  inputTokens: 100,
  outputTokens: 20,
  estimatedCostUsd: 0.5
} as unknown as AutomationRunUsage

function agentNode(agentId: 'claude' | 'codex' = 'claude'): FlowNode {
  return {
    id: 'node-1',
    position: { x: 0, y: 0 },
    config: { kind: 'agent-prompt', agentId, prompt: 'go', workspaceMode: 'new_per_run' }
  }
}

function completedResult(overrides?: Partial<FlowNodeResult>): FlowNodeResult {
  return {
    status: 'completed',
    output: null,
    usage: null,
    exitCode: null,
    workspaceId: 'ws-1',
    workspaceDisplayName: null,
    terminalSessionId: 'session-1',
    terminalPaneKey: null,
    terminalPtyId: null,
    error: null,
    ...overrides
  }
}

function makeStores(): {
  claudeUsage: ClaudeUsageStore
  codexUsage: CodexUsageStore
  getClaude: ReturnType<typeof vi.fn>
  getCodex: ReturnType<typeof vi.fn>
} {
  const getClaude = vi.fn(async () => knownUsage)
  const getCodex = vi.fn(async () => knownUsage)
  return {
    claudeUsage: { getAutomationRunUsage: getClaude } as unknown as ClaudeUsageStore,
    codexUsage: { getAutomationRunUsage: getCodex } as unknown as CodexUsageStore,
    getClaude,
    getCodex
  }
}

describe('createFlowNodeUsageCollector', () => {
  it('attributes usage over the node session window', async () => {
    const stores = makeStores()
    const collect = createFlowNodeUsageCollector(stores)

    const usage = await collect({
      node: agentNode(),
      result: completedResult(),
      startedAt: 1_000
    })

    expect(usage).toBe(knownUsage)
    expect(stores.getClaude).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreeId: 'ws-1',
        terminalSessionId: 'session-1',
        startedAt: 1_000
      })
    )
  })

  it('routes codex nodes to the codex store', async () => {
    const stores = makeStores()
    const collect = createFlowNodeUsageCollector(stores)

    await collect({ node: agentNode('codex'), result: completedResult(), startedAt: 1 })

    expect(stores.getCodex).toHaveBeenCalled()
    expect(stores.getClaude).not.toHaveBeenCalled()
  })

  it('does not re-collect when the dispatch already reported usage', async () => {
    const stores = makeStores()
    const collect = createFlowNodeUsageCollector(stores)

    const usage = await collect({
      node: agentNode(),
      result: completedResult({ usage: knownUsage }),
      startedAt: 1
    })

    expect(usage).toBeNull()
    expect(stores.getClaude).not.toHaveBeenCalled()
  })

  it('skips non-agent nodes', async () => {
    const stores = makeStores()
    const collect = createFlowNodeUsageCollector(stores)

    const usage = await collect({
      node: {
        id: 'node-2',
        position: { x: 0, y: 0 },
        config: { kind: 'shell-command', command: 'ls', timeoutSeconds: 10 }
      },
      result: completedResult(),
      startedAt: 1
    })

    expect(usage).toBeNull()
    expect(stores.getClaude).not.toHaveBeenCalled()
  })

  it('skips nodes that did not complete or produced no workspace', async () => {
    const stores = makeStores()
    const collect = createFlowNodeUsageCollector(stores)

    expect(
      await collect({
        node: agentNode(),
        result: completedResult({ status: 'dispatch_failed' }),
        startedAt: 1
      })
    ).toBeNull()
    expect(
      await collect({
        node: agentNode(),
        result: completedResult({ workspaceId: null }),
        startedAt: 1
      })
    ).toBeNull()
    expect(stores.getClaude).not.toHaveBeenCalled()
  })

  it('reports usage as unavailable when the provider store is missing', async () => {
    const collect = createFlowNodeUsageCollector({ claudeUsage: null, codexUsage: null })

    const usage = await collect({ node: agentNode(), result: completedResult(), startedAt: 1 })

    expect(usage).toMatchObject({ status: 'unavailable', unavailableReason: 'scan_failed' })
  })
})
