import { FLOW_SCHEMA_VERSION, type Flow } from '../../shared/flows-types'

/**
 * Upgrade a persisted flow to the current schema. Runs on load, before any flow
 * reaches the app. Add a migration step per FLOW_SCHEMA_VERSION bump — never
 * mutate stored shapes in place without one, or older saved flows break.
 */
export function migrateFlow(raw: unknown): Flow {
  const flow = raw as Flow
  const version = typeof flow?.schemaVersion === 'number' ? flow.schemaVersion : 0

  // v0 → v1: baseline. Future steps chain here, e.g.:
  //   if (version < 2) { /* transform */ }

  if (version === FLOW_SCHEMA_VERSION) {
    return flow
  }
  return { ...flow, schemaVersion: FLOW_SCHEMA_VERSION }
}
