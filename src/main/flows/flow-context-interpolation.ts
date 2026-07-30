import type { FlowNode, FlowNodeConfig } from '../../shared/flows-types'
import type { FlowExecutionContext, FlowNodeResult } from './flow-node-dispatcher'

// Tokens: {{previous.output}}, {{previous.exitCode}}, {{<nodeId>.output}},
// {{<nodeId>.exitCode}}. Unknown references resolve to an empty string.
const TOKEN_PATTERN = /\{\{\s*([\w-]+)\.(output|exitCode)\s*\}\}/g

function resolveToken(
  ref: string,
  field: 'output' | 'exitCode',
  context: FlowExecutionContext
): string {
  const nodeId = ref === 'previous' ? context.previousNodeId : ref
  const result: FlowNodeResult | undefined = nodeId ? context.results.get(nodeId) : undefined
  if (!result) {
    return ''
  }
  if (field === 'exitCode') {
    return result.exitCode === null ? '' : String(result.exitCode)
  }
  return result.output?.content ?? ''
}

function interpolate(text: string, context: FlowExecutionContext): string {
  return text.replace(TOKEN_PATTERN, (_, ref: string, field: 'output' | 'exitCode') =>
    resolveToken(ref, field, context)
  )
}

/**
 * Return a copy of the node whose config has upstream results substituted into
 * the interpolatable fields (agent prompt, shell command). Other kinds are
 * returned unchanged.
 */
export function interpolateNodeConfig(node: FlowNode, context: FlowExecutionContext): FlowNode {
  const config: FlowNodeConfig = node.config
  if (config.kind === 'agent-prompt') {
    return { ...node, config: { ...config, prompt: interpolate(config.prompt, context) } }
  }
  if (config.kind === 'shell-command') {
    return { ...node, config: { ...config, command: interpolate(config.command, context) } }
  }
  return node
}
