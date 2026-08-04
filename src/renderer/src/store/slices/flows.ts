import type { StateCreator } from 'zustand'
import type {
  Flow,
  FlowCreateInput,
  FlowRun,
  FlowSummary,
  FlowUpdateInput
} from '../../../../shared/flows-types'
import type {
  FlowExportOutcome,
  FlowImportOutcome
} from '../../../../shared/flow-portable-document'
import type { AppState } from '../types'

export type FlowSlice = {
  flowSummaries: FlowSummary[]
  /** Flow the Flows page should open on, set when navigating from elsewhere
   *  (e.g. a workspace created by one of its nodes). Consumed once. */
  pendingFlowSelectionId: string | null
  setPendingFlowSelection: (flowId: string | null) => void
  fetchFlows: () => Promise<void>
  getFlow: (id: string) => Promise<Flow | undefined>
  createFlow: (input: FlowCreateInput) => Promise<Flow>
  updateFlow: (id: string, updates: FlowUpdateInput) => Promise<Flow>
  deleteFlow: (id: string) => Promise<void>
  listFlowRuns: (flowId: string, limit?: number) => Promise<FlowRun[]>
  runFlowNow: (flowId: string) => Promise<FlowRun>
  exportFlow: (id: string) => Promise<FlowExportOutcome>
  importFlow: () => Promise<FlowImportOutcome>
}

export const createFlowSlice: StateCreator<AppState, [], [], FlowSlice> = (set) => ({
  flowSummaries: [],
  pendingFlowSelectionId: null,

  setPendingFlowSelection: (flowId) => {
    set({ pendingFlowSelectionId: flowId })
  },

  fetchFlows: async () => {
    try {
      const flowSummaries = await window.api.flows.list()
      set({ flowSummaries })
    } catch (error) {
      console.error('Failed to fetch flows:', error)
    }
  },

  getFlow: async (id) => window.api.flows.get({ id }),

  createFlow: async (input) => {
    const flow = await window.api.flows.create(input)
    await refreshFlowSummaries(set)
    return flow
  },

  updateFlow: async (id, updates) => {
    const flow = await window.api.flows.update({ id, updates })
    await refreshFlowSummaries(set)
    return flow
  },

  deleteFlow: async (id) => {
    await window.api.flows.delete({ id })
    await refreshFlowSummaries(set)
  },

  listFlowRuns: async (flowId, limit) => window.api.flows.listRuns({ flowId, limit }),

  exportFlow: async (id) => window.api.flows.exportFlow({ id }),

  importFlow: async () => {
    const outcome = await window.api.flows.importFlow()
    if (outcome.status === 'imported') {
      await refreshFlowSummaries(set)
    }
    return outcome
  },

  runFlowNow: async (flowId) => {
    const run = await window.api.flows.runNow({ flowId })
    await refreshFlowSummaries(set)
    return run
  }
})

// Why: refresh the index after any mutation so summaries stay in sync without
// each action re-implementing the fetch.
async function refreshFlowSummaries(set: (partial: Partial<FlowSlice>) => void): Promise<void> {
  try {
    const flowSummaries = await window.api.flows.list()
    set({ flowSummaries })
  } catch (error) {
    console.error('Failed to refresh flows:', error)
  }
}
