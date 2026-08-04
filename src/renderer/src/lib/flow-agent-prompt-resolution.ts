import type { FlowNodeConfig } from '../../../shared/flows-types'
import { composeAgentPrompt } from '../../../shared/flow-agent-prompt-composition'

/**
 * Reads the node's attached markdown from disk and flattens rules + files +
 * prompt into the single string the agent is dispatched with. Throws when an
 * attachment can no longer be read, so the node fails loudly instead of
 * silently running with missing instructions.
 */
export async function resolveAgentNodePrompt(
  config: Extract<FlowNodeConfig, { kind: 'agent-prompt' }>
): Promise<string> {
  const files = await Promise.all(
    (config.markdownFiles ?? []).map(async (file) => {
      const read = await window.api.fs.readFile({ filePath: file.path })
      return { file, content: read.content }
    })
  )
  return composeAgentPrompt({ prompt: config.prompt, rules: config.rules, files })
}
