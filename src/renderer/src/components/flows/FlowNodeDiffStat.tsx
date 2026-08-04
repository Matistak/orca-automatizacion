import React from 'react'
import type { FlowNodeDiffStat as DiffStat } from '../../../../shared/flows-types'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

/** `diff +468 −0 · 8 files` — what a node left behind, at a glance. */
export function FlowNodeDiffStat({
  diffStat,
  className
}: {
  diffStat: DiffStat
  className?: string
}): React.JSX.Element {
  return (
    <p className={cn('text-[10px] tabular-nums text-muted-foreground', className)}>
      <span className="text-muted-foreground/70">
        {translate('auto.components.flows.FlowNodeDiffStat.5a0c1e7b93', 'diff')}{' '}
      </span>
      <span className="text-status-success">+{diffStat.insertions}</span>{' '}
      <span className="text-destructive">−{diffStat.deletions}</span>
      {' · '}
      {diffStat.filesChanged}{' '}
      {diffStat.filesChanged === 1
        ? translate('auto.components.flows.FlowNodeDiffStat.d1f4a2c806', 'file')
        : translate('auto.components.flows.FlowNodeDiffStat.7c9b3e5f20', 'files')}
    </p>
  )
}
