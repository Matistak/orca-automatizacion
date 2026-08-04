import { readFile, writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, type WebContents } from 'electron'
import {
  flowDocumentFileName,
  parseFlowPortableDocument,
  serializeFlowPortableDocument,
  type FlowExportOutcome,
  type FlowImportOutcome
} from '../../shared/flow-portable-document'
import type { FlowRepository } from './flow-repository'

/**
 * File-dialog side of flow import/export. The dialog and filesystem calls are
 * injectable so the decision logic (cancel, unreadable file, invalid document)
 * is testable without Electron.
 */

export type FlowDocumentFileHost = {
  promptSavePath(defaultFileName: string): Promise<string | null>
  promptOpenPath(): Promise<string | null>
  readTextFile(filePath: string): Promise<string>
  writeTextFile(filePath: string, contents: string): Promise<void>
}

export function createElectronFlowDocumentFileHost(
  webContents: WebContents | null
): FlowDocumentFileHost {
  const ownerWindow = webContents ? BrowserWindow.fromWebContents(webContents) : null
  return {
    async promptSavePath(defaultFileName) {
      const options = {
        title: 'Export Flow',
        defaultPath: defaultFileName,
        filters: [{ name: 'Orca flow', extensions: ['json'] }]
      }
      const result = ownerWindow
        ? await dialog.showSaveDialog(ownerWindow, options)
        : await dialog.showSaveDialog(options)
      return result.canceled || !result.filePath ? null : result.filePath
    },
    async promptOpenPath() {
      const options = {
        title: 'Import Flow',
        properties: ['openFile' as const],
        filters: [{ name: 'Orca flow', extensions: ['json'] }]
      }
      const result = ownerWindow
        ? await dialog.showOpenDialog(ownerWindow, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    readTextFile: (filePath) => readFile(filePath, 'utf8'),
    writeTextFile: (filePath, contents) => writeFile(filePath, contents, 'utf8')
  }
}

export async function exportFlowToFile(
  repository: FlowRepository,
  flowId: string,
  host: FlowDocumentFileHost,
  now: number = Date.now()
): Promise<FlowExportOutcome> {
  const flow = repository.getFlow(flowId)
  if (!flow) {
    return { status: 'error', message: 'Flow not found.' }
  }
  const filePath = await host.promptSavePath(flowDocumentFileName(flow.name))
  if (!filePath) {
    return { status: 'canceled' }
  }
  try {
    await host.writeTextFile(filePath, serializeFlowPortableDocument(flow, now))
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  return { status: 'saved', filePath }
}

export async function importFlowFromFile(
  repository: FlowRepository,
  host: FlowDocumentFileHost
): Promise<FlowImportOutcome> {
  const filePath = await host.promptOpenPath()
  if (!filePath) {
    return { status: 'canceled' }
  }
  let contents: string
  try {
    contents = await host.readTextFile(filePath)
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  }
  const parsed = parseFlowPortableDocument(contents)
  if (!parsed.ok) {
    return { status: 'error', message: parsed.error }
  }
  return { status: 'imported', flow: repository.createFlow(parsed.input) }
}
