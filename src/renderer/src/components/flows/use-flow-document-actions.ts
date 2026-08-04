import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

/**
 * Import/export of a flow as a portable JSON file. The file dialog and parsing
 * live in main; this only translates the outcome into toasts.
 */
export function useFlowDocumentActions({
  flowId,
  flushPendingSave,
  onImported
}: {
  flowId: string | null
  /** Runs before export so the file matches what is on screen. */
  flushPendingSave: () => Promise<void>
  onImported: (flowId: string) => void
}): { exportFlow: () => void; importFlow: () => void } {
  const exportFlowDocument = useAppStore((s) => s.exportFlow)
  const importFlowDocument = useAppStore((s) => s.importFlow)

  const exportFlow = useCallback(async () => {
    if (!flowId) {
      return
    }
    await flushPendingSave()
    const outcome = await exportFlowDocument(flowId)
    if (outcome.status === 'saved') {
      toast.success(translate('auto.components.flows.FlowsPage.b1c4a90d72', 'Flow exported'))
    } else if (outcome.status === 'error') {
      toast.error(
        translate('auto.components.flows.FlowsPage.5d2e7f1a83', 'Failed to export flow'),
        {
          description: outcome.message
        }
      )
    }
  }, [exportFlowDocument, flowId, flushPendingSave])

  const importFlow = useCallback(async () => {
    const outcome = await importFlowDocument()
    if (outcome.status === 'imported') {
      onImported(outcome.flow.id)
      toast.success(
        translate(
          'auto.components.flows.FlowsPage.7c0b9e4d15',
          'Flow imported — review it before enabling.'
        )
      )
    } else if (outcome.status === 'error') {
      toast.error(
        translate('auto.components.flows.FlowsPage.a86f3b2c04', 'Failed to import flow'),
        {
          description: outcome.message
        }
      )
    }
  }, [importFlowDocument, onImported])

  return {
    exportFlow: () => void exportFlow(),
    importFlow: () => void importFlow()
  }
}
