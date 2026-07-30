import { Bot, Clock, GitBranch, Play, Terminal, type LucideIcon } from 'lucide-react'
import type { FlowNodeConfig, FlowNodeKind } from '../../../../shared/flows-types'
import { translate } from '@/i18n/i18n'

export type FlowNodeKindMeta = {
  kind: FlowNodeKind
  title: string
  /** One-line description shown in the palette. */
  description: string
  icon: LucideIcon
  isTrigger: boolean
}

// Why: ordered so the palette lists triggers first, then actions, then branching.
// Labels are resolved per call, never at module load — importing this file must
// not evaluate translate() before i18n is initialized (and a language switch has
// to re-read them).
const FLOW_NODE_KINDS: readonly {
  kind: FlowNodeKind
  titleKey: string
  titleFallback: string
  descriptionKey: string
  descriptionFallback: string
  icon: LucideIcon
  isTrigger: boolean
}[] = [
  {
    kind: 'trigger-manual',
    titleKey: 'auto.components.flows.flow.node.presentation.7f72256204',
    titleFallback: 'Manual trigger',
    descriptionKey: 'auto.components.flows.flow.node.presentation.8926d60e5c',
    descriptionFallback: 'Entry point for a flow you run on demand.',
    icon: Play,
    isTrigger: true
  },
  {
    kind: 'trigger-schedule',
    titleKey: 'auto.components.flows.flow.node.presentation.2a6e380359',
    titleFallback: 'Schedule trigger',
    descriptionKey: 'auto.components.flows.flow.node.presentation.f5aafd203e',
    descriptionFallback: 'Run the flow on a recurring schedule.',
    icon: Clock,
    isTrigger: true
  },
  {
    kind: 'agent-prompt',
    titleKey: 'auto.components.flows.flow.node.presentation.e75b30e1ef',
    titleFallback: 'Agent prompt',
    descriptionKey: 'auto.components.flows.flow.node.presentation.0d4b0c7865',
    descriptionFallback: 'Run a coding agent with a prompt.',
    icon: Bot,
    isTrigger: false
  },
  {
    kind: 'shell-command',
    titleKey: 'auto.components.flows.flow.node.presentation.79d41cb149',
    titleFallback: 'Shell command',
    descriptionKey: 'auto.components.flows.flow.node.presentation.077baa943d',
    descriptionFallback: 'Run a shell command (local or SSH).',
    icon: Terminal,
    isTrigger: false
  },
  {
    kind: 'condition',
    titleKey: 'auto.components.flows.flow.node.presentation.2eee86d56a',
    titleFallback: 'Condition',
    descriptionKey: 'auto.components.flows.flow.node.presentation.e019c0d582',
    descriptionFallback: 'Branch on the previous node result.',
    icon: GitBranch,
    isTrigger: false
  }
]

export function listFlowNodeKindMeta(): FlowNodeKindMeta[] {
  return FLOW_NODE_KINDS.map((entry) => ({
    kind: entry.kind,
    title: translate(entry.titleKey, entry.titleFallback),
    description: translate(entry.descriptionKey, entry.descriptionFallback),
    icon: entry.icon,
    isTrigger: entry.isTrigger
  }))
}

export function getFlowNodeKindMeta(kind: FlowNodeKind): FlowNodeKindMeta {
  const entry = FLOW_NODE_KINDS.find((candidate) => candidate.kind === kind)
  if (!entry) {
    throw new Error(`Unknown flow node kind: ${kind}`)
  }
  return {
    kind: entry.kind,
    title: translate(entry.titleKey, entry.titleFallback),
    description: translate(entry.descriptionKey, entry.descriptionFallback),
    icon: entry.icon,
    isTrigger: entry.isTrigger
  }
}

/** A fresh default config for a newly-dropped node of the given kind. */
export function createDefaultNodeConfig(kind: FlowNodeKind): FlowNodeConfig {
  switch (kind) {
    case 'trigger-manual':
      return { kind: 'trigger-manual' }
    case 'trigger-schedule':
      return {
        kind: 'trigger-schedule',
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstart: 0,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }
    case 'agent-prompt':
      return {
        kind: 'agent-prompt',
        agentId: 'claude',
        prompt: '',
        workspaceMode: 'new_per_run'
      }
    case 'shell-command':
      return { kind: 'shell-command', command: '', timeoutSeconds: 60 }
    case 'condition':
      return { kind: 'condition', expression: { source: 'exit-code', equals: 0 } }
  }
}

/** Short, single-line preview of a node's config for the node card. */
export function getFlowNodeConfigSummary(config: FlowNodeConfig): string {
  switch (config.kind) {
    case 'trigger-manual':
      return 'Runs on demand'
    case 'trigger-schedule':
      return config.rrule || 'No schedule set'
    case 'agent-prompt':
      return config.prompt.trim() || 'No prompt yet'
    case 'shell-command':
      return config.command.trim() || 'No command yet'
    case 'condition':
      return config.expression.source === 'exit-code'
        ? `exit code == ${config.expression.equals}`
        : `output contains "${config.expression.substring || '…'}"`
  }
}

export function getFlowNodeTitle(config: FlowNodeConfig, label?: string): string {
  return label?.trim() || getFlowNodeKindMeta(config.kind).title
}
