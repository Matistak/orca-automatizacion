import { describe, expect, it, vi } from 'vitest'
import { JsonFlowRepository } from './json-flow-repository'
import type { FlowStoreBackend } from './flow-store-backend'
import type { Flow, FlowRun } from '../../shared/flows-types'
import { serializeFlowPortableDocument } from '../../shared/flow-portable-document'
import {
  exportFlowToFile,
  importFlowFromFile,
  type FlowDocumentFileHost
} from './flow-document-file-io'

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => null }, dialog: {} }))

class FakeBackend implements FlowStoreBackend {
  flows: Flow[] = []
  flowRuns: FlowRun[] = []
  readFlows(): Flow[] {
    return this.flows
  }
  writeFlows(flows: Flow[]): void {
    this.flows = flows
  }
  readFlowRuns(): FlowRun[] {
    return this.flowRuns
  }
  writeFlowRuns(runs: FlowRun[]): void {
    this.flowRuns = runs
  }
}

function makeHost(overrides: Partial<FlowDocumentFileHost> = {}): FlowDocumentFileHost {
  return {
    promptSavePath: vi.fn(async () => '/tmp/flow.json'),
    promptOpenPath: vi.fn(async () => '/tmp/flow.json'),
    readTextFile: vi.fn(async () => '{}'),
    writeTextFile: vi.fn(async () => {}),
    ...overrides
  }
}

function makeRepo() {
  return new JsonFlowRepository(new FakeBackend())
}

describe('exportFlowToFile', () => {
  it('writes the portable document to the chosen path', async () => {
    const repo = makeRepo()
    const flow = repo.createFlow({ name: 'Audit' })
    const writeTextFile = vi.fn(async (_filePath: string, _contents: string) => {})
    const promptSavePath = vi.fn(async () => '/tmp/audit.json')
    const outcome = await exportFlowToFile(
      repo,
      flow.id,
      makeHost({ promptSavePath, writeTextFile }),
      7
    )

    expect(promptSavePath).toHaveBeenCalledWith('audit.orca-flow.json')
    expect(outcome).toEqual({ status: 'saved', filePath: '/tmp/audit.json' })
    expect(writeTextFile.mock.calls[0]?.[1]).toBe(serializeFlowPortableDocument(flow, 7))
  })

  it('reports cancel without touching the filesystem', async () => {
    const repo = makeRepo()
    const flow = repo.createFlow({ name: 'Audit' })
    const writeTextFile = vi.fn(async () => {})
    const outcome = await exportFlowToFile(
      repo,
      flow.id,
      makeHost({ promptSavePath: async () => null, writeTextFile }),
      1
    )
    expect(outcome).toEqual({ status: 'canceled' })
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('surfaces a write failure', async () => {
    const repo = makeRepo()
    const flow = repo.createFlow({ name: 'Audit' })
    const outcome = await exportFlowToFile(
      repo,
      flow.id,
      makeHost({
        writeTextFile: async () => {
          throw new Error('disk full')
        }
      }),
      1
    )
    expect(outcome).toEqual({ status: 'error', message: 'disk full' })
  })

  it('reports a missing flow', async () => {
    const outcome = await exportFlowToFile(makeRepo(), 'nope', makeHost(), 1)
    expect(outcome).toEqual({ status: 'error', message: 'Flow not found.' })
  })
})

describe('importFlowFromFile', () => {
  it('creates a new, disabled flow from the document', async () => {
    const repo = makeRepo()
    const source = repo.createFlow({
      name: 'Shared flow',
      nodes: [{ id: 'n1', config: { kind: 'trigger-manual' }, position: { x: 1, y: 2 } }],
      enabled: true
    })
    const outcome = await importFlowFromFile(
      repo,
      makeHost({ readTextFile: async () => serializeFlowPortableDocument(source, 1) })
    )

    expect(outcome.status).toBe('imported')
    if (outcome.status !== 'imported') {
      return
    }
    expect(outcome.flow.id).not.toBe(source.id)
    expect(outcome.flow.enabled).toBe(false)
    expect(outcome.flow.nodes).toEqual(source.nodes)
    expect(repo.listFlowSummaries()).toHaveLength(2)
  })

  it('reports cancel', async () => {
    const outcome = await importFlowFromFile(
      makeRepo(),
      makeHost({ promptOpenPath: async () => null })
    )
    expect(outcome).toEqual({ status: 'canceled' })
  })

  it('rejects a file that is not a flow export without creating anything', async () => {
    const repo = makeRepo()
    const outcome = await importFlowFromFile(
      repo,
      makeHost({ readTextFile: async () => '{"kind":"other"}' })
    )
    expect(outcome).toEqual({ status: 'error', message: 'The file is not an Orca flow export.' })
    expect(repo.listFlowSummaries()).toHaveLength(0)
  })

  it('surfaces a read failure', async () => {
    const outcome = await importFlowFromFile(
      makeRepo(),
      makeHost({
        readTextFile: async () => {
          throw new Error('permission denied')
        }
      })
    )
    expect(outcome).toEqual({ status: 'error', message: 'permission denied' })
  })
})
