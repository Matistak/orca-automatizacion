import type { FlowPromptMarkdownFile } from './flows-types'

export type FlowAgentPromptParts = {
  prompt?: string
  rules?: string
  /** Attached markdown files with their contents already read. */
  files?: { file: FlowPromptMarkdownFile; content: string }[]
}

/** An agent node is dispatchable with a prompt, attached markdown, or both. */
export function hasAgentPromptContent(config: {
  prompt: string
  markdownFiles?: FlowPromptMarkdownFile[]
}): boolean {
  return config.prompt.trim().length > 0 || (config.markdownFiles?.length ?? 0) > 0
}

/** Flattens rules + attached markdown + prompt into the single string a TUI agent receives. */
export function composeAgentPrompt({ prompt, rules, files }: FlowAgentPromptParts): string {
  const sections: string[] = []
  const trimmedRules = rules?.trim()
  if (trimmedRules) {
    sections.push(`# Rules\n\n${trimmedRules}`)
  }
  for (const entry of files ?? []) {
    const content = entry.content.trim()
    if (content) {
      sections.push(`# ${entry.file.name}\n\n${content}`)
    }
  }
  const trimmedPrompt = prompt?.trim()
  if (trimmedPrompt) {
    sections.push(sections.length > 0 ? `# Task\n\n${trimmedPrompt}` : trimmedPrompt)
  }
  return sections.join('\n\n---\n\n')
}
