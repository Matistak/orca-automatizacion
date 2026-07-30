import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { FLOW_METHODS } from './flows'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

describe('flow RPC methods', () => {
  it('routes flow CRUD and run listing to the runtime server', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      listFlows: vi.fn().mockReturnValue([{ id: 'flow-1', name: 'Daily audit' }]),
      getFlow: vi.fn().mockReturnValue({ id: 'flow-1', name: 'Daily audit' }),
      createFlow: vi.fn().mockReturnValue({ id: 'flow-2', name: 'Release prep' }),
      updateFlow: vi.fn().mockReturnValue({ id: 'flow-1', name: 'Paused' }),
      deleteFlow: vi.fn().mockReturnValue({ removed: true, id: 'flow-1' }),
      listFlowRuns: vi.fn().mockReturnValue([{ id: 'run-1', flowId: 'flow-1' }])
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: FLOW_METHODS })

    await dispatcher.dispatch(makeRequest('flow.list'))
    await dispatcher.dispatch(makeRequest('flow.show', { id: 'flow-1' }))
    await dispatcher.dispatch(
      makeRequest('flow.create', {
        name: 'Release prep',
        nodes: [
          { id: 'n1', config: { kind: 'trigger-manual' }, position: { x: 0, y: 0 } },
          {
            id: 'n2',
            config: {
              kind: 'agent-prompt',
              agentId: 'codex',
              prompt: 'Review changes',
              workspaceMode: 'new_per_run'
            },
            position: { x: 200, y: 0 }
          }
        ],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
        enabled: true
      })
    )
    await dispatcher.dispatch(
      makeRequest('flow.update', { id: 'flow-1', updates: { enabled: false } })
    )
    await dispatcher.dispatch(makeRequest('flow.delete', { id: 'flow-1' }))
    await dispatcher.dispatch(makeRequest('flow.runs', { flowId: 'flow-1', limit: 10 }))

    expect(runtime.listFlows).toHaveBeenCalled()
    expect(runtime.getFlow).toHaveBeenCalledWith('flow-1')
    expect(runtime.createFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Release prep',
        enabled: true,
        nodes: expect.arrayContaining([expect.objectContaining({ id: 'n2' })])
      })
    )
    expect(runtime.updateFlow).toHaveBeenCalledWith('flow-1', { enabled: false })
    expect(runtime.deleteFlow).toHaveBeenCalledWith('flow-1')
    expect(runtime.listFlowRuns).toHaveBeenCalledWith('flow-1', 10)
  })

  it('rejects unknown agent providers and malformed node configs', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      createFlow: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: FLOW_METHODS })

    await expect(
      dispatcher.dispatch(
        makeRequest('flow.create', {
          name: 'Bad provider',
          nodes: [
            {
              id: 'n1',
              config: {
                kind: 'agent-prompt',
                agentId: 'not-real',
                prompt: 'Run',
                workspaceMode: 'existing'
              },
              position: { x: 0, y: 0 }
            }
          ]
        })
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })

    await expect(
      dispatcher.dispatch(
        makeRequest('flow.create', {
          name: 'Bad node',
          nodes: [{ id: 'n1', config: { kind: 'unknown-kind' }, position: { x: 0, y: 0 } }]
        })
      )
    ).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })

    expect(runtime.createFlow).not.toHaveBeenCalled()
  })
})
