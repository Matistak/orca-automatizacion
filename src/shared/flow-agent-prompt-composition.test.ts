import { describe, expect, it } from 'vitest'
import { composeAgentPrompt, hasAgentPromptContent } from './flow-agent-prompt-composition'

describe('hasAgentPromptContent', () => {
  it('accepts a prompt with no attachments', () => {
    expect(hasAgentPromptContent({ prompt: 'do the thing' })).toBe(true)
  })

  it('accepts attachments with no prompt', () => {
    expect(
      hasAgentPromptContent({
        prompt: '  ',
        markdownFiles: [{ path: '/a/spec.md', name: 'spec.md' }]
      })
    ).toBe(true)
  })

  it('rejects neither', () => {
    expect(hasAgentPromptContent({ prompt: '', markdownFiles: [] })).toBe(false)
  })
})

describe('composeAgentPrompt', () => {
  it('returns the bare prompt when nothing else is set', () => {
    expect(composeAgentPrompt({ prompt: 'run tests' })).toBe('run tests')
  })

  it('orders rules, attachments, then the prompt as a task', () => {
    const composed = composeAgentPrompt({
      prompt: 'apply it',
      rules: 'never push to main',
      files: [{ file: { path: '/a/spec.md', name: 'spec.md' }, content: '# Spec\nbody' }]
    })
    expect(composed).toBe(
      '# Rules\n\nnever push to main\n\n---\n\n# spec.md\n\n# Spec\nbody\n\n---\n\n# Task\n\napply it'
    )
  })

  it('skips empty sections', () => {
    expect(
      composeAgentPrompt({
        prompt: '',
        rules: '   ',
        files: [{ file: { path: '/a/spec.md', name: 'spec.md' }, content: 'body' }]
      })
    ).toBe('# spec.md\n\nbody')
  })
})
