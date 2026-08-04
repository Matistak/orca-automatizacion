import { describe, expect, it } from 'vitest'
import { FLOW_SCHEMA_VERSION, type Flow } from './flows-types'
import {
  buildFlowPortableDocument,
  flowDocumentFileName,
  parseFlowPortableDocument,
  serializeFlowPortableDocument
} from './flow-portable-document'

function makeFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: 'flow-1',
    name: 'Nightly audit',
    description: 'checks the repo',
    nodes: [
      { id: 'n1', config: { kind: 'trigger-manual' }, position: { x: 10, y: 20 } },
      {
        id: 'n2',
        label: 'status',
        config: { kind: 'shell-command', command: 'git status', timeoutSeconds: 30 },
        position: { x: 40, y: 20 }
      }
    ],
    edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    enabled: true,
    schemaVersion: FLOW_SCHEMA_VERSION,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  }
}

describe('flow portable document — export', () => {
  it('carries the graph but not install-local identity', () => {
    const document = buildFlowPortableDocument(makeFlow(), 555)
    expect(document).toMatchObject({
      kind: 'orca.flow',
      schemaVersion: FLOW_SCHEMA_VERSION,
      exportedAt: 555
    })
    expect(document.flow).not.toHaveProperty('id')
    expect(document.flow).not.toHaveProperty('createdAt')
    expect(document.flow).not.toHaveProperty('enabled')
    expect(document.flow.nodes).toHaveLength(2)
  })

  it('round-trips through serialize/parse', () => {
    const flow = makeFlow()
    const parsed = parseFlowPortableDocument(serializeFlowPortableDocument(flow, 1))
    expect(parsed).toEqual({
      ok: true,
      input: {
        name: flow.name,
        description: flow.description,
        nodes: flow.nodes,
        edges: flow.edges,
        enabled: false
      }
    })
  })

  it('never imports a flow as enabled', () => {
    const parsed = parseFlowPortableDocument(
      serializeFlowPortableDocument(makeFlow({ enabled: true }), 1)
    )
    expect(parsed.ok && parsed.input.enabled).toBe(false)
  })

  it('builds a filesystem-safe file name', () => {
    expect(flowDocumentFileName('Nightly audit / prod')).toBe('nightly-audit-prod.orca-flow.json')
    expect(flowDocumentFileName('   ')).toBe('flow.orca-flow.json')
  })
})

describe('flow portable document — parse rejections', () => {
  const cases: { name: string; text: string; error: string }[] = [
    { name: 'not JSON', text: 'nope{', error: 'The file is not valid JSON.' },
    {
      name: 'foreign document',
      text: JSON.stringify({ kind: 'something.else' }),
      error: 'The file is not an Orca flow export.'
    },
    {
      name: 'newer schema',
      text: JSON.stringify({
        kind: 'orca.flow',
        schemaVersion: FLOW_SCHEMA_VERSION + 1,
        flow: { name: 'x', nodes: [], edges: [] }
      }),
      error: 'The flow was exported by a newer version of Orca.'
    },
    {
      name: 'missing name',
      text: JSON.stringify({ kind: 'orca.flow', flow: { name: '  ', nodes: [], edges: [] } }),
      error: 'The flow is missing a name.'
    },
    {
      name: 'unknown node kind',
      text: JSON.stringify({
        kind: 'orca.flow',
        flow: { name: 'x', nodes: [{ id: 'n1', config: { kind: 'http-request' } }], edges: [] }
      }),
      error: 'The flow contains an unreadable node.'
    },
    {
      name: 'duplicate node ids',
      text: JSON.stringify({
        kind: 'orca.flow',
        flow: {
          name: 'x',
          nodes: [
            { id: 'n1', config: { kind: 'trigger-manual' } },
            { id: 'n1', config: { kind: 'trigger-manual' } }
          ],
          edges: []
        }
      }),
      error: 'The flow contains duplicate node ids.'
    },
    {
      name: 'dangling edge',
      text: JSON.stringify({
        kind: 'orca.flow',
        flow: {
          name: 'x',
          nodes: [{ id: 'n1', config: { kind: 'trigger-manual' } }],
          edges: [{ id: 'e1', source: 'n1', target: 'gone' }]
        }
      }),
      error: 'The flow has a connection pointing at a missing node.'
    }
  ]

  it.each(cases)('rejects $name', ({ text, error }) => {
    expect(parseFlowPortableDocument(text)).toEqual({ ok: false, error })
  })

  it('defaults a missing canvas position instead of failing', () => {
    const parsed = parseFlowPortableDocument(
      JSON.stringify({
        kind: 'orca.flow',
        flow: { name: 'x', nodes: [{ id: 'n1', config: { kind: 'trigger-manual' } }], edges: [] }
      })
    )
    expect(parsed.ok && parsed.input.nodes?.[0]?.position).toEqual({ x: 0, y: 0 })
  })
})
