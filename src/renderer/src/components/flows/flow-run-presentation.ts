import type { AutomationRunStatus } from '../../../../shared/automations-types'
import type { FlowNodeRun, FlowRun, FlowRunStatus } from '../../../../shared/flows-types'
import { translate } from '@/i18n/i18n'

export type FlowNodeTone = 'idle' | 'running' | 'completed' | 'failed' | 'skipped'

export function getFlowNodeRunsByNodeId(run: FlowRun | null): Map<string, FlowNodeRun> {
  return new Map((run?.nodeRuns ?? []).map((nodeRun) => [nodeRun.nodeId, nodeRun]))
}

export function getFlowNodeTone(status: AutomationRunStatus | undefined): FlowNodeTone {
  switch (status) {
    case undefined:
    case 'pending':
      return 'idle'
    case 'dispatching':
    case 'dispatched':
      return 'running'
    case 'completed':
      return 'completed'
    case 'dispatch_failed':
      return 'failed'
    case 'skipped_precheck':
    case 'skipped_missed':
    case 'skipped_unavailable':
    case 'skipped_needs_interactive_auth':
      return 'skipped'
  }
}

export function getFlowNodeStatusLabel(status: AutomationRunStatus): string {
  switch (status) {
    case 'pending':
      return translate('auto.components.flows.flow.run.presentation.6b91a1d0f2', 'Pending')
    case 'dispatching':
      return translate('auto.components.flows.flow.run.presentation.2a7f0c5b19', 'Starting')
    case 'dispatched':
      return translate('auto.components.flows.flow.run.presentation.b2c4d6e8a0', 'Running')
    case 'completed':
      return translate('auto.components.flows.flow.run.presentation.3f8a6c2d41', 'Completed')
    case 'dispatch_failed':
      return translate('auto.components.flows.flow.run.presentation.9d1e7b5c30', 'Failed')
    case 'skipped_precheck':
    case 'skipped_missed':
    case 'skipped_unavailable':
    case 'skipped_needs_interactive_auth':
      return translate('auto.components.flows.flow.run.presentation.71c3f9a284', 'Skipped')
  }
}

export function getFlowRunStatusLabel(status: FlowRunStatus): string {
  switch (status) {
    case 'pending':
      return translate('auto.components.flows.flow.run.presentation.6b91a1d0f2', 'Pending')
    case 'running':
      return translate('auto.components.flows.flow.run.presentation.b2c4d6e8a0', 'Running')
    case 'completed':
      return translate('auto.components.flows.flow.run.presentation.3f8a6c2d41', 'Completed')
    case 'failed':
      return translate('auto.components.flows.flow.run.presentation.9d1e7b5c30', 'Failed')
    case 'skipped':
      return translate('auto.components.flows.flow.run.presentation.71c3f9a284', 'Skipped')
    case 'skipped_missed':
      return translate('auto.components.flows.flow.run.presentation.4c8b2e6f17', 'Missed')
  }
}

export function formatFlowRunTime(timestamp: number | null): string {
  if (!timestamp) {
    return '—'
  }
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatFlowRunDuration(run: FlowRun): string {
  const end = run.completedAt ?? Date.now()
  const seconds = Math.max(0, Math.round((end - run.startedAt) / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
