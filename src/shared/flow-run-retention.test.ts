import { describe, expect, it } from 'vitest'
import type { FlowRun } from './flows-types'
import { MAX_FLOW_RUNS_PER_FLOW, nextFlowRunNumber, pruneFlowRuns } from './flow-run-retention'

function run(overrides: Partial<FlowRun> & Pick<FlowRun, 'id' | 'flowId'>): FlowRun {
  return {
    flowSnapshot: {} as FlowRun['flowSnapshot'],
    status: 'completed',
    trigger: 'manual',
    nodeRuns: [],
    startedAt: 0,
    completedAt: null,
    ...overrides
  }
}

describe('pruneFlowRuns', () => {
  it('keeps the newest N final runs per flow', () => {
    const runs = Array.from({ length: MAX_FLOW_RUNS_PER_FLOW + 10 }, (_, i) =>
      run({ id: `f1-${i}`, flowId: 'f1', startedAt: i })
    )
    const kept = pruneFlowRuns(runs)
    expect(kept).toHaveLength(MAX_FLOW_RUNS_PER_FLOW)
    // newest survive
    expect(kept.some((r) => r.id === `f1-${MAX_FLOW_RUNS_PER_FLOW + 9}`)).toBe(true)
    expect(kept.some((r) => r.id === 'f1-0')).toBe(false)
  })

  it('never evicts non-final runs', () => {
    const runs = [
      run({ id: 'running', flowId: 'f1', status: 'running', startedAt: 0 }),
      ...Array.from({ length: MAX_FLOW_RUNS_PER_FLOW + 5 }, (_, i) =>
        run({ id: `done-${i}`, flowId: 'f1', startedAt: i + 1 })
      )
    ]
    const kept = pruneFlowRuns(runs)
    expect(kept.some((r) => r.id === 'running')).toBe(true)
  })

  it('prunes each flow independently', () => {
    const runs = [
      ...Array.from({ length: MAX_FLOW_RUNS_PER_FLOW + 3 }, (_, i) =>
        run({ id: `a-${i}`, flowId: 'a', startedAt: i })
      ),
      run({ id: 'b-0', flowId: 'b', startedAt: 0 })
    ]
    const kept = pruneFlowRuns(runs)
    expect(kept.filter((r) => r.flowId === 'a')).toHaveLength(MAX_FLOW_RUNS_PER_FLOW)
    expect(kept.filter((r) => r.flowId === 'b')).toHaveLength(1)
  })

  it('preserves append order among survivors', () => {
    const runs = [
      run({ id: 'x', flowId: 'f1', startedAt: 2 }),
      run({ id: 'y', flowId: 'f1', startedAt: 1 })
    ]
    expect(pruneFlowRuns(runs).map((r) => r.id)).toEqual(['x', 'y'])
  })
})

describe('nextFlowRunNumber', () => {
  it('starts at 1 with no runs', () => {
    expect(nextFlowRunNumber([])).toBe(1)
  })

  it('continues from the highest existing number', () => {
    const runs = [
      run({ id: 'a', flowId: 'f1', runNumber: 7 }),
      run({ id: 'b', flowId: 'f1', runNumber: 3 })
    ]
    expect(nextFlowRunNumber(runs)).toBe(8)
  })

  it('seeds with count so unnumbered legacy runs still advance', () => {
    const runs = [run({ id: 'a', flowId: 'f1' }), run({ id: 'b', flowId: 'f1' })]
    expect(nextFlowRunNumber(runs)).toBe(3)
  })
})
