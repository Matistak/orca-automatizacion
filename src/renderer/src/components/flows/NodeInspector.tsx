import React, { useMemo } from 'react'
import { Trash2 } from 'lucide-react'
import type {
  FlowConditionExpression,
  FlowNode,
  FlowNodeConfig
} from '../../../../shared/flows-types'
import type { AutomationWorkspaceMode } from '../../../../shared/automations-types'
import type { TuiAgent } from '../../../../shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { WorkspaceCombobox } from '@/components/automations/WorkspaceCombobox'
import AutomationProjectCombobox from '@/components/automations/AutomationProjectCombobox'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/automations/automation-page-parts'
import { getFlowNodeKindMeta } from './flow-node-presentation'
import { FlowScheduleField } from './FlowScheduleField'
import { translate } from '@/i18n/i18n'

const FIELD_CONTROL_CLASS = 'border-input bg-input/30 shadow-xs dark:bg-input/30'
const TEXTAREA_CLASS =
  'min-h-24 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'

type NodeInspectorProps = {
  node: FlowNode
  onConfigChange: (config: FlowNodeConfig) => void
  onLabelChange: (label: string) => void
  onDelete: () => void
}

export function NodeInspector({
  node,
  onConfigChange,
  onLabelChange,
  onDelete
}: NodeInspectorProps): React.JSX.Element {
  const meta = getFlowNodeKindMeta(node.config.kind)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <meta.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
          <span className="text-[13px] font-medium">{meta.title}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onDelete}
          aria-label={translate('auto.components.flows.NodeInspector.dea86daf79', 'Delete node')}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <div className="scrollbar-sleek flex-1 space-y-3 overflow-y-auto p-3">
        <Field label={translate('auto.components.flows.NodeInspector.af4b6c472c', 'Label')}>
          <Input
            value={node.label ?? ''}
            placeholder={meta.title}
            onChange={(event) => onLabelChange(event.target.value)}
            className={FIELD_CONTROL_CLASS}
          />
        </Field>
        <NodeConfigFields config={node.config} onConfigChange={onConfigChange} />
      </div>
    </div>
  )
}

function NodeConfigFields({
  config,
  onConfigChange
}: {
  config: FlowNodeConfig
  onConfigChange: (config: FlowNodeConfig) => void
}): React.JSX.Element {
  switch (config.kind) {
    case 'trigger-manual':
      return (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.flows.NodeInspector.363268c9ca',
            'This flow runs when you click “Run now”. No configuration needed.'
          )}
        </p>
      )
    case 'trigger-schedule':
      return (
        <FlowScheduleField
          rrule={config.rrule}
          onRruleChange={(rrule) => onConfigChange({ ...config, rrule })}
        />
      )
    case 'agent-prompt':
      return <AgentPromptFields config={config} onConfigChange={onConfigChange} />
    case 'shell-command':
      return <ShellCommandFields config={config} onConfigChange={onConfigChange} />
    case 'condition':
      return <ConditionFields config={config} onConfigChange={onConfigChange} />
  }
}

function AgentPromptFields({
  config,
  onConfigChange
}: {
  config: Extract<FlowNodeConfig, { kind: 'agent-prompt' }>
  onConfigChange: (config: FlowNodeConfig) => void
}): React.JSX.Element {
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const repos = useAppStore((s) => s.repos)
  const agents = useMemo(() => getAgentCatalog(), [])
  const allWorktrees = useMemo(() => Object.values(worktreesByRepo).flat(), [worktreesByRepo])

  return (
    <>
      <Field label={translate('auto.components.flows.NodeInspector.db52cbdc6a', 'Agent')}>
        <Select
          value={config.agentId}
          onValueChange={(agentId) => onConfigChange({ ...config, agentId: agentId as TuiAgent })}
        >
          <SelectTrigger className={cn('w-full', FIELD_CONTROL_CLASS)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id}>
                {agent.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={translate('auto.components.flows.NodeInspector.40c692ef3b', 'Prompt')}>
        <textarea
          value={config.prompt}
          placeholder={translate(
            'auto.components.flows.NodeInspector.d546b22080',
            'Review the recent changes and summarize any risks.'
          )}
          onChange={(event) => onConfigChange({ ...config, prompt: event.target.value })}
          className={TEXTAREA_CLASS}
        />
      </Field>
      <Field label={translate('auto.components.flows.NodeInspector.19137dff8d', 'Workspace')}>
        <Select
          value={config.workspaceMode}
          onValueChange={(mode) =>
            onConfigChange({ ...config, workspaceMode: mode as AutomationWorkspaceMode })
          }
        >
          <SelectTrigger className={cn('w-full', FIELD_CONTROL_CLASS)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new_per_run">
              {translate('auto.components.flows.NodeInspector.d339acbb4a', 'New workspace per run')}
            </SelectItem>
            <SelectItem value="existing">
              {translate('auto.components.flows.NodeInspector.6f087906c3', 'Existing workspace')}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {config.workspaceMode === 'new_per_run' ? (
        <Field label={translate('auto.components.flows.NodeInspector.5a1f3b7c92', 'Project')}>
          <AutomationProjectCombobox
            repos={repos}
            value={config.projectId ?? ''}
            triggerClassName={FIELD_CONTROL_CLASS}
            onValueChange={(projectId) => onConfigChange({ ...config, projectId })}
          />
        </Field>
      ) : null}
      {config.workspaceMode === 'existing' ? (
        <Field
          label={translate('auto.components.flows.NodeInspector.0ba1b86a57', 'Target workspace')}
        >
          <WorkspaceCombobox
            worktrees={allWorktrees}
            value={config.workspaceId ?? ''}
            triggerClassName={FIELD_CONTROL_CLASS}
            onValueChange={(workspaceId) => onConfigChange({ ...config, workspaceId })}
          />
        </Field>
      ) : (
        <Field
          label={translate(
            'auto.components.flows.NodeInspector.36d8ae3178',
            'Base branch (optional)'
          )}
        >
          <Input
            value={config.baseBranch ?? ''}
            placeholder={translate('auto.components.flows.NodeInspector.171962b508', 'main')}
            onChange={(event) =>
              onConfigChange({ ...config, baseBranch: event.target.value || null })
            }
            className={FIELD_CONTROL_CLASS}
          />
        </Field>
      )}
    </>
  )
}

function ShellCommandFields({
  config,
  onConfigChange
}: {
  config: Extract<FlowNodeConfig, { kind: 'shell-command' }>
  onConfigChange: (config: FlowNodeConfig) => void
}): React.JSX.Element {
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const allWorktrees = useMemo(() => Object.values(worktreesByRepo).flat(), [worktreesByRepo])
  return (
    <>
      <Field label={translate('auto.components.flows.NodeInspector.4bc45d9209', 'Command')}>
        <textarea
          value={config.command}
          placeholder={translate('auto.components.flows.NodeInspector.6134d3963b', 'npm test')}
          onChange={(event) => onConfigChange({ ...config, command: event.target.value })}
          className={cn(TEXTAREA_CLASS, 'font-mono text-[13px]')}
        />
      </Field>
      <Field
        label={translate('auto.components.flows.NodeInspector.f1c90909d0', 'Timeout (seconds)')}
      >
        <Input
          type="number"
          min={1}
          value={String(config.timeoutSeconds)}
          onChange={(event) =>
            onConfigChange({
              ...config,
              timeoutSeconds: Math.max(1, Number(event.target.value) || 60)
            })
          }
          className={FIELD_CONTROL_CLASS}
        />
      </Field>
      <Field
        label={translate('auto.components.flows.NodeInspector.7d2e9a4b10', 'Workspace (optional)')}
      >
        <WorkspaceCombobox
          worktrees={allWorktrees}
          value={config.workspaceId ?? ''}
          triggerClassName={FIELD_CONTROL_CLASS}
          onValueChange={(workspaceId) => onConfigChange({ ...config, workspaceId })}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.flows.NodeInspector.8e3f0b5c21',
          'Leave empty to run in the workspace an earlier node created.'
        )}
      </p>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox
          checked={config.failOnNonZeroExit !== false}
          onCheckedChange={(checked) =>
            onConfigChange({ ...config, failOnNonZeroExit: checked === true })
          }
        />
        {translate(
          'auto.components.flows.NodeInspector.0a9b8c7d6e',
          'Fail the flow when the command exits non-zero'
        )}
      </label>
    </>
  )
}

function ConditionFields({
  config,
  onConfigChange
}: {
  config: Extract<FlowNodeConfig, { kind: 'condition' }>
  onConfigChange: (config: FlowNodeConfig) => void
}): React.JSX.Element {
  const { expression } = config
  const setExpression = (next: FlowConditionExpression): void =>
    onConfigChange({ ...config, expression: next })

  return (
    <>
      <Field label={translate('auto.components.flows.NodeInspector.3c76ea2c03', 'Branch on')}>
        <Select
          value={expression.source}
          onValueChange={(source) =>
            setExpression(
              source === 'exit-code'
                ? { source: 'exit-code', equals: 0 }
                : { source: 'output-contains', substring: '' }
            )
          }
        >
          <SelectTrigger className={cn('w-full', FIELD_CONTROL_CLASS)}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="exit-code">
              {translate('auto.components.flows.NodeInspector.d5120e8a54', 'Previous exit code')}
            </SelectItem>
            <SelectItem value="output-contains">
              {translate(
                'auto.components.flows.NodeInspector.94d3a82151',
                'Previous output contains'
              )}
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {expression.source === 'exit-code' ? (
        <Field label={translate('auto.components.flows.NodeInspector.c5d810b9ba', 'Equals')}>
          <Input
            type="number"
            value={String(expression.equals)}
            onChange={(event) =>
              setExpression({ source: 'exit-code', equals: Number(event.target.value) || 0 })
            }
            className={FIELD_CONTROL_CLASS}
          />
        </Field>
      ) : (
        <Field label={translate('auto.components.flows.NodeInspector.b8f9b7250f', 'Substring')}>
          <Input
            value={expression.substring}
            placeholder={translate('auto.components.flows.NodeInspector.1de8290a7d', 'PASS')}
            onChange={(event) =>
              setExpression({
                source: 'output-contains',
                substring: event.target.value,
                caseSensitive: expression.caseSensitive
              })
            }
            className={FIELD_CONTROL_CLASS}
          />
        </Field>
      )}
      <p className="text-xs text-muted-foreground">
        {translate('auto.components.flows.NodeInspector.16b24dd46d', 'Connect the')}
        <span className="font-medium">
          {translate('auto.components.flows.NodeInspector.04909be122', 'true')}
        </span>{' '}
        {translate('auto.components.flows.NodeInspector.c041575875', 'and')}{' '}
        <span className="font-medium">
          {translate('auto.components.flows.NodeInspector.cd5a418e3b', 'false')}
        </span>{' '}
        {translate(
          'auto.components.flows.NodeInspector.815ee41877',
          'handles to the nodes that should run for each outcome.'
        )}
      </p>
    </>
  )
}
