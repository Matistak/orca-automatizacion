import { useEffect } from 'react'
import { dispatchAutomationRun } from '@/lib/dispatch-automation-run'

const AUTOMATIONS_CHANGED_EVENT = 'orca:automations-changed'

export function useAutomationDispatchEvents(): void {
  useEffect(() => {
    const unsubscribe = window.api.automations.onDispatchRequested(
      async ({ automation, run, dispatchToken }) => {
        await dispatchAutomationRun({
          automation,
          run,
          markDispatchResult: async (result) => {
            await window.api.automations.markDispatchResult(result)
            window.dispatchEvent(new Event(AUTOMATIONS_CHANGED_EVENT))
          },
          runPrecheck: () =>
            window.api.automations.runPrecheck({ automationId: automation.id, runId: run.id }),
          listRuns: () => window.api.automations.listRuns({ automationId: automation.id }),
          buildProvenanceRequest: (createRequestId) => ({
            automationId: automation.id,
            automationRunId: run.id,
            dispatchToken,
            createRequestId
          })
        })
      }
    )
    void window.api.automations.rendererReady()
    return unsubscribe
  }, [])
}
