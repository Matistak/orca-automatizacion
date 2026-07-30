import type { AutomationRunOutputSnapshot } from '../../shared/automations-types'
import type { FlowNode } from '../../shared/flows-types'
import type { Repo } from '../../shared/types'
import { runAutomationPrecheck } from '../automations/precheck-runner'
import type { FlowExecutionContext, FlowNodeResult } from './flow-node-dispatcher'
import { inheritedWorkspaceId, resolveFlowShellTarget } from './flow-shell-target'

function emptyResult(overrides: Partial<FlowNodeResult>): FlowNodeResult {
  return {
    status: 'completed',
    output: null,
    usage: null,
    exitCode: null,
    workspaceId: null,
    workspaceDisplayName: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    error: null,
    ...overrides
  }
}

function snapshot(stdout: string, stderr: string, truncated: boolean): AutomationRunOutputSnapshot {
  const content = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
  return { format: 'plain_text', content, capturedAt: Date.now(), truncated }
}

/**
 * Runs a `shell-command` node through the same local/SSH runner automations use
 * for prechecks. Exit code is carried on the result so a downstream `condition`
 * can branch on it.
 */
export async function dispatchShellFlowNode(args: {
  node: FlowNode
  context: FlowExecutionContext
  getRepo: (repoId: string) => Repo | undefined
}): Promise<FlowNodeResult> {
  const config = args.node.config
  if (config.kind !== 'shell-command') {
    throw new Error(`dispatchShellFlowNode received a ${config.kind} node.`)
  }
  const target = resolveFlowShellTarget({
    workspaceId: config.workspaceId ?? inheritedWorkspaceId(args.context),
    getRepo: args.getRepo
  })
  if (!target.ok) {
    return emptyResult({ status: 'skipped_unavailable', error: target.error })
  }

  const result = await runAutomationPrecheck({
    precheck: { command: config.command, timeoutSeconds: config.timeoutSeconds },
    target: target.connectionId
      ? { type: 'ssh', cwd: target.cwd, connectionId: target.connectionId }
      : { type: 'local', cwd: target.cwd }
  })

  // Why: a non-zero exit is a legitimate branch input, so failing the node is
  // opt-in (default) rather than implicit — see failOnNonZeroExit.
  const failOnNonZero = config.failOnNonZeroExit !== false
  const ranCleanly = result.exitCode === 0 && !result.timedOut && !result.error
  const failed = result.error !== null || result.timedOut || (failOnNonZero && !ranCleanly)
  return emptyResult({
    status: failed ? 'dispatch_failed' : 'completed',
    exitCode: result.exitCode,
    workspaceId: target.workspaceId,
    output: snapshot(
      result.stdout,
      result.stderr,
      result.stdoutTruncated || result.stderrTruncated
    ),
    error: failed
      ? (result.error ??
        (result.timedOut
          ? `Command timed out after ${config.timeoutSeconds}s.`
          : `Command exited with code ${result.exitCode}.`))
      : null
  })
}
