import React, { useState } from 'react'
import { FilePlus2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { FlowNodeConfig, FlowPromptMarkdownFile } from '../../../../shared/flows-types'
import { hasAgentPromptContent } from '../../../../shared/flow-agent-prompt-composition'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

type AgentPromptConfig = Extract<FlowNodeConfig, { kind: 'agent-prompt' }>

const TEXTAREA_CLASS =
  'min-h-24 w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30'

function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

/**
 * Prompt / markdown attachments / rules, all optional individually — a node
 * only needs a prompt or at least one attached file to be runnable.
 */
export function AgentInstructionTabs({
  config,
  onConfigChange
}: {
  config: AgentPromptConfig
  onConfigChange: (config: FlowNodeConfig) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<string>('prompt')
  const files = config.markdownFiles ?? []
  const rules = config.rules ?? ''

  const attach = async (): Promise<void> => {
    let picked: string[] = []
    try {
      picked = await window.api.flows.pickMarkdownFiles()
    } catch (error) {
      toast.error(
        translate(
          'auto.components.flows.AgentInstructionTabs.9f1a2b3c48',
          'Could not open the file picker.'
        ),
        { description: error instanceof Error ? error.message : String(error) }
      )
      return
    }
    if (picked.length === 0) {
      return
    }
    const existing = new Set(files.map((file) => file.path))
    const added: FlowPromptMarkdownFile[] = picked
      .filter((filePath) => !existing.has(filePath))
      .map((filePath) => ({ path: filePath, name: fileNameOf(filePath) }))
    onConfigChange({ ...config, markdownFiles: [...files, ...added] })
  }

  return (
    <div className="space-y-2">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="prompt">
            {translate('auto.components.flows.AgentInstructionTabs.9f1a2b3c40', 'Prompt')}
          </TabsTrigger>
          <TabsTrigger value="files">
            {translate('auto.components.flows.AgentInstructionTabs.9f1a2b3c41', 'Files')}
            {files.length > 0 ? (
              <span className="text-[11px] text-muted-foreground">{files.length}</span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="rules">
            {translate('auto.components.flows.AgentInstructionTabs.9f1a2b3c42', 'Rules')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prompt">
          <textarea
            value={config.prompt}
            placeholder={translate(
              'auto.components.flows.NodeInspector.d546b22080',
              'Review the recent changes and summarize any risks.'
            )}
            onChange={(event) => onConfigChange({ ...config, prompt: event.target.value })}
            className={TEXTAREA_CLASS}
          />
        </TabsContent>

        <TabsContent value="files" className="space-y-2">
          {files.length > 0 ? (
            <ul className="space-y-1">
              {files.map((file) => (
                <li
                  key={file.path}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{file.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {file.path}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={translate(
                      'auto.components.flows.AgentInstructionTabs.9f1a2b3c43',
                      'Remove file'
                    )}
                    onClick={() =>
                      onConfigChange({
                        ...config,
                        markdownFiles: files.filter((entry) => entry.path !== file.path)
                      })
                    }
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.flows.AgentInstructionTabs.9f1a2b3c44',
                'Attach .md files to send their contents as instructions.'
              )}
            </p>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => void attach()}>
            <FilePlus2 className="size-3.5" />
            {translate('auto.components.flows.AgentInstructionTabs.9f1a2b3c45', 'Attach .md files')}
          </Button>
        </TabsContent>

        <TabsContent value="rules">
          <textarea
            value={rules}
            placeholder={translate(
              'auto.components.flows.AgentInstructionTabs.9f1a2b3c46',
              'Never push to main. Always run the test suite before finishing.'
            )}
            onChange={(event) => onConfigChange({ ...config, rules: event.target.value })}
            className={TEXTAREA_CLASS}
          />
        </TabsContent>
      </Tabs>

      {hasAgentPromptContent(config) ? null : (
        <p className={cn('text-xs text-destructive')}>
          {translate(
            'auto.components.flows.AgentInstructionTabs.9f1a2b3c47',
            'Add a prompt or attach at least one .md file.'
          )}
        </p>
      )}
    </div>
  )
}
