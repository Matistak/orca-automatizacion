import React from 'react'
import { Workflow } from 'lucide-react'
import type { FlowWorkspaceProvenance } from '../../../../shared/types'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from './WorktreeCardDetailSection'
import { DetailHeader, MetadataActionIcon } from './WorktreeCardMetadataControls'
import { translate } from '@/i18n/i18n'

type WorktreeCardFlowDetailSectionProps = {
  provenance: FlowWorkspaceProvenance
  onOpenFlow?: (event: React.MouseEvent) => void
}

export function WorktreeCardFlowDetailSection({
  provenance,
  onOpenFlow
}: WorktreeCardFlowDetailSectionProps): React.JSX.Element {
  const [flowExists, setFlowExists] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void window.api.flows
      .get({ id: provenance.flowId })
      .then((flow) => {
        if (!cancelled) {
          setFlowExists(Boolean(flow))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFlowExists(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [provenance.flowId])

  const runLabel =
    provenance.flowRunNumber !== null
      ? `#${provenance.flowRunNumber} · ${provenance.nodeLabelSnapshot}`
      : provenance.nodeLabelSnapshot

  return (
    <WorktreeCardDetailSection>
      <DetailHeader
        icon={<Workflow className="size-3 text-muted-foreground" />}
        label={translate('auto.components.sidebar.WorktreeCardMeta.flowHeader', 'Flow')}
        actions={
          onOpenFlow && flowExists ? (
            <MetadataActionIcon
              label={translate('auto.components.sidebar.WorktreeCardMeta.openFlow', 'Open flow')}
              onClick={onOpenFlow}
            >
              <Workflow className="size-3" />
            </MetadataActionIcon>
          ) : null
        }
      />
      <WorktreeCardDetailSectionContent className="space-y-1.5">
        <div className="text-[13px] font-semibold leading-snug text-foreground break-words">
          {provenance.flowNameSnapshot}
        </div>
        <div className="text-[11.5px] leading-snug text-muted-foreground break-words">
          {runLabel}
        </div>
        {flowExists === false ? (
          <div className="text-[11px] leading-snug text-muted-foreground">
            {translate(
              'auto.components.sidebar.WorktreeCardMeta.flowMissing',
              'Flow no longer available.'
            )}
          </div>
        ) : null}
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}
