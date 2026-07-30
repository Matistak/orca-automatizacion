import type { FlowConditionExpression } from '../../shared/flows-types'
import type { FlowNodeResult } from './flow-node-dispatcher'

/**
 * Evaluate a condition against the upstream node's result and return the handle
 * ('true' | 'false') whose branch the flow should follow.
 */
export function evaluateCondition(
  expression: FlowConditionExpression,
  upstream: FlowNodeResult | undefined
): 'true' | 'false' {
  return conditionHolds(expression, upstream) ? 'true' : 'false'
}

function conditionHolds(
  expression: FlowConditionExpression,
  upstream: FlowNodeResult | undefined
): boolean {
  if (!upstream) {
    return false
  }
  switch (expression.source) {
    case 'exit-code':
      return upstream.exitCode === expression.equals
    case 'output-contains': {
      const haystack = upstream.output?.content ?? ''
      if (expression.caseSensitive) {
        return haystack.includes(expression.substring)
      }
      return haystack.toLowerCase().includes(expression.substring.toLowerCase())
    }
  }
}
