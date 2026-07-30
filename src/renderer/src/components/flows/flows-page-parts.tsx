import React from 'react'
import { AlertTriangle, Check, Loader2, Plus, Trash2, X } from 'lucide-react'
import type { Flow } from '../../../../shared/flows-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { translate } from '@/i18n/i18n'

export type SaveState = 'saved' | 'dirty' | 'saving'

export function FlowsHeader({
  flow,
  saveState,
  onRename,
  onToggleEnabled,
  onCreate,
  onDelete,
  onClose
}: {
  flow: Flow | null
  saveState: SaveState
  onRename: (name: string) => void
  onToggleEnabled: (enabled: boolean) => void
  onCreate: () => void
  onDelete: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
      <span className="text-sm font-semibold">
        {translate('auto.components.flows.flows.page.parts.da54929a93', 'Flows')}
      </span>
      {flow ? (
        <>
          <Input
            value={flow.name}
            onChange={(event) => onRename(event.target.value)}
            className="h-8 w-64 border-input bg-input/30 text-sm dark:bg-input/30"
          />
          <SaveIndicator saveState={saveState} />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={flow.enabled}
              onCheckedChange={(checked) => onToggleEnabled(checked === true)}
            />
            {translate('auto.components.flows.flows.page.parts.2b932e6556', 'Enabled')}
          </label>
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onCreate}>
          <Plus className="size-4" />
          {translate('auto.components.flows.flows.page.parts.5e7f6d1c63', 'New flow')}
        </Button>
        {flow ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" />
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label={translate('auto.components.flows.flows.page.parts.1dfd976b28', 'Close')}
        >
          <X className="size-4" />
        </Button>
      </div>
    </header>
  )
}

function SaveIndicator({ saveState }: { saveState: SaveState }): React.JSX.Element {
  if (saveState === 'saving') {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {translate('auto.components.flows.flows.page.parts.d01e1244c3', 'Saving…')}
      </span>
    )
  }
  if (saveState === 'dirty') {
    return (
      <span className="text-xs text-muted-foreground">
        {translate('auto.components.flows.flows.page.parts.7071a51cef', 'Unsaved changes')}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Check className="size-3" />
      {translate('auto.components.flows.flows.page.parts.71db7887f1', 'Saved')}
    </span>
  )
}

export function ValidationBanner({ messages }: { messages: string[] }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <ul className="space-y-0.5">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  )
}

export function FlowsEmptyState({
  onCreate,
  hasFlows
}: {
  onCreate: () => void
  hasFlows: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">
        {hasFlows
          ? translate(
              'auto.components.flows.flows.page.parts.71640a4d34',
              'Select a flow to edit it.'
            )
          : translate('auto.components.flows.flows.page.parts.6104665060', 'No flows yet.')}
      </p>
      {!hasFlows ? (
        <Button type="button" size="sm" variant="secondary" onClick={onCreate}>
          <Plus className="size-4" />
          {translate('auto.components.flows.flows.page.parts.5e7f6d1c63', 'New flow')}
        </Button>
      ) : null}
    </div>
  )
}
