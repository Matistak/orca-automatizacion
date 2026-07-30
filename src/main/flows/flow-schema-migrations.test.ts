import { describe, expect, it } from 'vitest'
import { FLOW_SCHEMA_VERSION, type Flow } from '../../shared/flows-types'
import { migrateFlow } from './flow-schema-migrations'

function baseFlow(overrides: Partial<Flow> = {}): Flow {
  return {
    id: 'f1',
    name: 'A',
    nodes: [],
    edges: [],
    enabled: false,
    schemaVersion: FLOW_SCHEMA_VERSION,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe('migrateFlow', () => {
  it('returns a current-version flow unchanged', () => {
    const flow = baseFlow()
    expect(migrateFlow(flow)).toEqual(flow)
  })

  it('stamps the current schema version onto a legacy flow', () => {
    const legacy = baseFlow({ schemaVersion: 0 })
    expect(migrateFlow(legacy).schemaVersion).toBe(FLOW_SCHEMA_VERSION)
  })

  it('treats a missing schemaVersion as legacy', () => {
    const raw = { ...baseFlow(), schemaVersion: undefined }
    expect(migrateFlow(raw).schemaVersion).toBe(FLOW_SCHEMA_VERSION)
  })
})
