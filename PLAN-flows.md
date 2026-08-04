# Plan: Editor de flujos por nodos sobre las automatizaciones de Orca

> Sistema de automatización visual por nodos construido **encima de** la infraestructura de
> automatizaciones existente de Orca. Cada nodo es una acción; un flujo es un grafo (DAG) de
> nodos que puede ejecutarse programado o bajo demanda.
>
> **Estrategia de almacenamiento:** empezar con el store JSON actual (Opción A) detrás de una
> capa de repositorio, para poder migrar a SQLite más adelante sin reescribir la lógica.

---

## Registro de progreso

| Etapa | Estado | Notas |
|-------|--------|-------|
| 0 — Decisiones y andamiaje | ✅ Hecho | Tipos, interfaz `FlowRepository`, migraciones stub. Canvas: `@xyflow/react`. |
| 1 — Modelo de datos y persistencia | ✅ Hecho | `JsonFlowRepository` sobre el store JSON. 22 tests · typecheck 0 · lint OK. |
| 2 — Puente IPC/RPC y store del renderer | ✅ Hecho | IPC `flows:*`, RPC `flow.*` (zod), `window.api.flows.*`, slice `flowSlice`. typecheck 0 · lint OK · tests verdes. |
| 3 — Motor de ejecución del DAG (MVP) | ✅ Hecho | `FlowExecutionEngine` + validación/topo/condición/interpolación, dispatcher abstracto. 29 tests · typecheck 0 · lint OK. |
| 4 — Editor visual de nodos (UI) | ✅ Hecho | `@xyflow/react` instalado. Vista `flows` cableada, canvas + paleta + inspector + autosave + validación en vivo. `flow-graph` movido a `shared/`. typecheck (node/cli/web) 0 · lint OK. |
| 5 — Ejecución desde UI + observabilidad | ✅ Hecho | `flows:runNow` + `FlowRunService`, dispatcher shell (main) y agent (renderer, reusando el coordinador de automatizaciones), overlay de estado en vivo, historial y detalle de run. 45 tests flows · typecheck 0 · lint OK. |
| 5.5 — Cierre de observabilidad y provenance | ✅ Hecho | `kind: 'created-by-flow'` validado contra el `FlowRun`, "Open" enfoca el panel exacto, tokens/coste recolectados. 62 tests flows · typecheck 0 · lint OK. |
| 6 — Integración con el scheduler | ✅ Hecho | `FlowSchedulerService` (tick 60s), ocurrencia derivada del nodo (sin `nextRunAt` persistido), gracia por flujo, dispatcher headless para serve. 103 tests flows+schedule · typecheck 0 · lint + 8 gates OK. |
| 7 — Preparación SQLite + pulido | ⬜ Pendiente | |

> Convención: cada etapa se marca aquí y sus checkboxes se actualizan al terminar, con archivos
> tocados y resultado de verificación (typecheck/tests/lint).

---

## 0. Contexto: qué reutilizamos y qué construimos

Orca ya tiene un sistema de automatizaciones maduro. **No lo reemplazamos: lo envolvemos.**

### Lo que ya existe y reutilizamos tal cual

| Pieza | Ubicación | Qué nos da |
|-------|-----------|------------|
| Ejecución de agente en terminal | `src/renderer/src/hooks/useAutomationDispatchEvents.ts` | Crear workspace, lanzar agente, observar `working→done`, capturar salida |
| Ejecución de comando shell | `src/main/automations/precheck-runner.ts` | Correr comandos local/SSH con timeout y captura de stdout/stderr |
| Scheduling RRULE/cron | `src/shared/automation-schedules.ts` | Presets (`hourly`/`daily`/`weekdays`/`weekly`) + cron custom |
| Tick del scheduler | `src/main/automations/service.ts` | `setInterval` cada 60s que detecta runs "due" |
| Tipos de estado/uso | `src/shared/automations-types.ts` | `AutomationRunStatus`, `AutomationRunUsage`, `AutomationRunOutputSnapshot` |
| Recolección de tokens/coste | `src/main/automations/run-usage-collection.ts` | Atribución de uso por ventana de sesión del proveedor |
| Provenance / dispatch token | `src/main/automations/dispatch-tokens.ts`, `workspace-provenance.ts` | Autenticar que un workspace creado pertenece a un run |
| Persistencia (store JSON) | `src/main/persistence.ts` (clase `Store`) | `flush()` a disco, migración de estado al arrancar, sync a hosts remotos |

### Lo que construimos nuevo

1. **Modelo de grafo** (`Flow` = nodos + aristas) — hoy una `Automation` es una sola acción plana.
2. **Capa de repositorio** (`FlowRepository`) — el linchpin para la migración futura a SQLite.
3. **Motor de ejecución del DAG** (`FlowExecutionEngine`) — recorre el grafo, pasa contexto entre
   nodos, evalúa condiciones. Hoy `AutomationService` ejecuta una acción, no orquesta un grafo.
4. **Editor visual de nodos** (canvas) — no existe nada parecido en la app.

---

## Principio rector para la migración a SQLite

La clave de "fácil de migrar" **no es el formato en disco**, es la **capa de repositorio (interfaz)**
entre la lógica de negocio y el almacenamiento. Toda la app habla con la interfaz `FlowRepository`.
Hoy la implementa `JsonFlowRepository`; mañana `SqliteFlowRepository`. Nadie fuera de esa capa toca
`state.flows` directamente.

Tres reglas que hacen la migración trivial:

1. **Queries estrechas y explícitas** (`findById`, `listSummaries`, `listRunsByFlow`, `appendRun`,
   `pruneRuns`) — nada de "dame todo el estado y filtra en memoria". Cada método mapea 1:1 a un
   `SELECT`/`INSERT`.
2. **IDs generados por la app** (uuid), no autoincrement — sobreviven a cualquier backend.
3. **`schemaVersion` + migraciones desde el día uno** — Orca ya hace esto con
   `backfillLegacyAutomationContexts`.

**Regla de oro de inmutabilidad:** cada `FlowRun` guarda un **`flowSnapshot`** (copia del grafo tal
como estaba al ejecutarse). Si el usuario edita el flujo después, sus runs históricos siguen siendo
interpretables. Orca ya aplica esta filosofía congelando `workspaceDisplayName` en el run.

---

## Modelo de datos (referencia)

```typescript
// src/shared/flows-types.ts

export const FLOW_SCHEMA_VERSION = 1

export type FlowNodeKind =
  | 'trigger-schedule'   // reusa rrule/dtstart/timezone
  | 'trigger-manual'     // punto de entrada para "Run now"
  | 'agent-prompt'       // reusa agentId + prompt (la acción actual de Automation)
  | 'shell-command'      // reusa precheck-runner.ts (local/ssh)
  | 'condition'          // branch según exit code / salida del nodo previo
  // extensible: 'http-request', 'delay', 'notify', ...

// Config es una UNIÓN DISCRIMINADA por kind — cada variante reutiliza tipos existentes
export type FlowNodeConfig =
  | { kind: 'trigger-schedule'; rrule: string; dtstart: number; timezone: string }
  | { kind: 'trigger-manual' }
  | {
      kind: 'agent-prompt'
      agentId: TuiAgent
      prompt: string
      workspaceMode: AutomationWorkspaceMode
      workspaceId?: string | null
      baseBranch?: string | null
      reuseSession?: boolean
    }
  | { kind: 'shell-command'; command: string; timeoutSeconds: number }
  | { kind: 'condition'; expression: ConditionExpression }

export type FlowNode = {
  id: string                          // uuid estable — las aristas apuntan aquí
  config: FlowNodeConfig              // lógica de ejecución (backend la lee)
  position: { x: number; y: number }  // SOLO para el editor (backend la ignora)
  label?: string
}

export type FlowEdge = {
  id: string
  source: string          // FlowNode.id
  sourceHandle?: string   // p.ej. 'true' | 'false' en un condition
  target: string
}

export type Flow = {
  id: string
  name: string
  description?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  enabled: boolean        // gobierna si los triggers-schedule están activos
  schemaVersion: number
  createdAt: number
  updatedAt: number
}

// Runs — separados a propósito (append-heavy, futura tabla SQLite propia)
export type FlowRun = {
  id: string
  flowId: string
  flowSnapshot: Flow      // ⚠️ grafo congelado al momento de ejecutar
  status: FlowRunStatus
  trigger: 'scheduled' | 'manual'
  nodeRuns: FlowNodeRun[]
  startedAt: number
  completedAt: number | null
  runNumber?: number
}

export type FlowNodeRun = {
  nodeId: string
  status: AutomationRunStatus                    // REUSADO
  output: AutomationRunOutputSnapshot | null     // REUSADO
  usage: AutomationRunUsage | null               // REUSADO
  terminalSessionId: string | null               // REUSADO
  terminalPaneKey: string | null
  terminalPtyId: string | null
  error: string | null
  startedAt: number | null
  completedAt: number | null
}
```

**Separación crítica:** `position` (editor) vs `config` (ejecución). El backend/scheduler nunca lee
coordenadas → el motor es testeable sin UI.

---

## Etapas de implementación

### Etapa 0 — Decisiones y andamiaje

**Objetivo:** cerrar decisiones caras de cambiar. Sin features.

- [x] **Librería del canvas: `@xyflow/react` (React Flow).** ✅ Decidido. Autocontenida
      (compatible con CSP de Electron), nodos custom, handles, pan/zoom, minimap, soporte de
      teclado. Se instala al **inicio de la Etapa 4** (no antes, para no dejar una dependencia sin
      usar que dispare el lint). Estilos importados y sobreescritos con los tokens del
      `STYLEGUIDE.md` para respetar el look monocromo (no usar la paleta por defecto de React Flow).
- [x] Crear carpetas/módulos con nombres concretos (sin `utils`/`helpers`, por `AGENTS.md`):
  - [x] `src/shared/flows-types.ts`
  - [x] `src/main/flows/flow-repository.ts` (interfaz → tipo `FlowRepository`)
  - [x] `src/main/flows/json-flow-repository.ts` (implementado en Etapa 1)
  - [x] `src/main/flows/flow-execution-engine.ts` (Etapa 3)
  - [x] `src/main/flows/flow-schema-migrations.ts`
  - [x] `src/renderer/src/components/flows/` (Etapa 4)
- [x] Definir `FLOW_SCHEMA_VERSION` y stub de `migrateFlow(raw): Flow`.

**Entregable:** estructura + tipos + interfaz. Nada funcional aún. ✅ **HECHO**

**Notas de implementación:**
- `FlowStoreBackend` (`src/main/flows/flow-store-backend.ts`) añadido como interfaz de slots
  mínima — mantiene la lógica CRUD fuera de la clase `Store`.
- Interfaces convertidas a `type` (regla de lint `consistent-type-definitions`).

---

### Etapa 1 — Modelo de datos y persistencia

**Objetivo:** crear/leer/editar/borrar flujos, persistidos. Sin ejecución todavía.

- [x] Completar `flows-types.ts` reutilizando tipos existentes de `automations-types.ts`.
- [x] Definir la interfaz `FlowRepository` (queries estrechas 1:1 con SELECT/INSERT). Añadido
      también `getRun(runId)` respecto al borrador inicial.
- [x] `JsonFlowRepository`: delega en `Store` vía `FlowStoreBackend`, con nuevos arrays
      `state.flows` / `state.flowRuns`. Slots crudos (`readFlows`/`writeFlows`/`readFlowRuns`/
      `writeFlowRuns`) en `Store`, usando `flush()`.
- [x] Migración de esquema al cargar (`parsed.flows.map(migrateFlow)` en `persistence.ts`).
- [x] Retención de runs (`pruneFlowRuns`, máx 100/flow, nunca evicta runs no finales; marca
      `loadNeedsSave` si podó al cargar). **Truncado de outputs** se aplica en el productor de
      snapshots (Etapa 3), no en la retención.
- [x] **Tests** del repositorio (22 tests: CRUD, cascada, migración, retención, snapshot inmutable,
      upsert de node-run, orden/límite).

**Entregable:** `FlowRepository` funcional sobre JSON, cubierto por tests. ✅ **HECHO**
(typecheck node 0 errores · 22 tests verdes · lint limpio)

**Archivos tocados:**
- `src/shared/flows-types.ts`, `src/shared/flow-run-retention.ts` (+ tests)
- `src/shared/types.ts` (`PersistedState.flows`/`flowRuns`), `src/shared/constants.ts` (defaults)
- `src/main/persistence.ts` (parseo con migración + retención, slots de backend)
- `src/main/flows/{flow-repository,flow-store-backend,json-flow-repository,flow-schema-migrations}.ts`
  (+ tests de `json-flow-repository` y `flow-schema-migrations`)

---

### Etapa 2 — Puente IPC/RPC y store del renderer

**Objetivo:** el renderer puede hablar con el repositorio.

- [x] Handlers IPC en `src/main/ipc/flows.ts` (patrón `ipc/automations.ts`):
      `flows:list/get/create/update/delete`, `flows:listRuns`. `flows:runNow` se difiere a la
      Etapa 3 (necesita el motor de ejecución). Registrados en `register-core-handlers.ts`.
- [x] Métodos RPC en `src/main/runtime/rpc/methods/flows.ts` con validación **zod**
      (unión discriminada de `FlowNodeConfig`) — registrados en el manifiesto `ALL_RPC_METHODS`.
      Delegan en nuevos métodos del `OrcaRuntime` (`listFlows/getFlow/createFlow/updateFlow/
      deleteFlow/listFlowRuns`) que construyen un `JsonFlowRepository` sobre los slots del store.
- [x] Expuesto en `src/preload/index.ts` + `api-types.ts` (`window.api.flows.*`).
- [x] Slice `flowSlice` (`store/slices/flows.ts`) cableado en `store/index.ts`, `types.ts` y los
      helpers de test de store.

**Entregable:** CRUD de flujos accesible desde el renderer (aún sin UI de canvas ni ejecución).
✅ **HECHO** (typecheck 0 · lint OK · tests RPC + store cascades verdes)

**Archivos tocados:**
- `src/main/ipc/flows.ts` (nuevo), `src/main/ipc/register-core-handlers.ts`
- `src/main/runtime/rpc/methods/flows.ts` (+ `.test.ts`), `src/main/runtime/rpc/methods/index.ts`
- `src/main/runtime/orca-runtime.ts` (slots de store + métodos de flows)
- `src/preload/index.ts`, `src/preload/api-types.ts`
- `src/renderer/src/store/slices/flows.ts` (nuevo), `store/index.ts`, `store/types.ts`,
  `store/slices/store-test-helpers.ts`, `store/slices/diffComments.test.ts`

---

### Etapa 3 — Motor de ejecución del DAG (lo más nuevo)

**Objetivo:** ejecutar un flujo end-to-end. **Aquí está el MVP vertical.**

- [x] `FlowExecutionEngine` en `main`:
  - [x] **Validación del grafo:** detectar ciclos (rechazar — es un DAG), nodos huérfanos
        (warning), múltiples triggers / sin trigger, aristas colgantes, branch faltante en
        `condition`. → `flow-graph.ts` (`validateFlowGraph`).
  - [x] **Orden topológico:** Kahn (`topologicalOrder`), con fallback defensivo anti-ciclo.
  - [x] **Paso de contexto:** `output`/`exitCode` de nodos previos disponibles vía tokens
        `{{previous.output}}` / `{{<nodeId>.output|exitCode}}`. → `flow-context-interpolation.ts`.
  - [x] **Ejecución por tipo de nodo** detrás de un **dispatcher abstracto** (`FlowNodeDispatcher`)
        — testeable sin renderer/shell. El wiring real (`useAutomationDispatchEvents`,
        `precheck-runner.ts`, `dispatchToken`, `flows:runNow`) se hace en Etapa 5.
    - `agent-prompt` / `shell-command` → `dispatcher.dispatchNode` (config ya interpolada).
    - `condition` → evaluado en el motor (`flow-condition.ts`), activa solo la arista `true`/`false`.
  - [x] **Manejo de estados por nodo** reusando `AutomationRunStatus`; `updateNodeRun` a medida
        que avanza + nuevo `updateRunStatus` en el repo para el roll-up final del `FlowRun`.
  - [x] **Fallo y corte:** un nodo fallido deja sus aristas de salida "muertas" → los sucesores
        no se activan y se persisten como `skipped_unavailable`; el run queda `failed`.
- [x] **Estrategia incremental dentro de la etapa:** lineal → encadenado (agent→shell con
      interpolación) → branching (`condition`), todo cubierto por tests.
- [x] **Tests** del motor con dispatcher scripteado sobre el `JsonFlowRepository` real
      (lineal, encadenado+interpolación, branching true/false, ciclo rechazado, fallo a mitad
      de grafo, snapshot inmutable) + tests de `flow-graph`.

**Entregable:** ejecutar un flujo manual desde el backend y ver los `FlowNodeRun` persistidos.
✅ **HECHO** (29 tests verdes · typecheck node 0 · lint limpio)

**Archivos tocados:**
- `src/main/flows/flow-execution-engine.ts` (+ `.test.ts`), `flow-graph.ts` (+ `.test.ts`),
  `flow-condition.ts`, `flow-context-interpolation.ts`, `flow-node-dispatcher.ts`
- `src/main/flows/flow-repository.ts` + `json-flow-repository.ts` (nuevo `updateRunStatus`)

---

### Etapa 4 — Editor visual de nodos (UI/UX)

**Objetivo:** construir/editar flujos visualmente. Ver sección **Diseño UI/UX** abajo.

- [x] Ruta/vista nueva `FlowsPage.tsx`, entrada en `SidebarNav.tsx`. Vista `flows` cableada en
      `TopLevelView`, `top-level-view.ts`, `ui.ts` (`openFlowsPage`/`closeFlowsPage`/
      `previousViewBeforeFlows`), `worktree-nav-history.ts`, `worktree-activation.ts`,
      `right-sidebar-visibility.ts`, `resolve-zoom-target.ts`, `client-ui-schemas.ts`, `App.tsx`.
- [x] Lista de flujos (`FlowList.tsx`): cards con nombre, nº de nodos y estado (enabled).
      _Último/próximo run se muestran en Etapa 5 (requieren runs/scheduler)._
- [x] Canvas del editor (`FlowCanvas.tsx`) con `@xyflow/react`: pan/zoom, arrastrar nodos,
      conectar handles, minimap/controls, drag-drop desde paleta, borrar con Delete/Backspace.
- [x] Nodo custom (`FlowNodeCard.tsx`): un card por `kind` (icono lucide monocromo, preview de
      config, doble handle `true`/`false` en `condition`, halo `ring` al seleccionar,
      borde `destructive` si inválido).
- [x] Paleta de nodos (`NodePalette.tsx`): arrastrar-para-crear + click-para-añadir.
- [x] Panel de inspección (`NodeInspector.tsx`): editar el `config` por `kind`. Reutiliza
      `AutomationSchedulePicker` (vía `FlowScheduleField`, adaptando rrule↔draft) y
      `WorkspaceCombobox`. _`AutomationPrecheckFields`/`AutomationSessionField` no aplican al
      modelo de nodos actual; se evaluará su reuso en Etapa 5._
- [x] Autosave con debounce (700ms) + indicador dirty/saving/saved; validación en vivo con
      `validateFlowGraph` (movido a `src/shared/flow-graph.ts` para reuso main+renderer) y banner
      de errores no-bloqueante.

**Entregable:** crear y guardar un flujo completo desde la UI. ✅ **HECHO**
(typecheck node/cli/web 0 · lint OK · tests de `flow-graph` verdes tras el move)

**Archivos tocados:**
- `src/renderer/src/components/flows/` (nuevo): `FlowsPage.tsx`, `flows-page-parts.tsx`,
  `FlowList.tsx`, `FlowCanvas.tsx`, `flow-canvas-theme.css`, `FlowNodeCard.tsx`, `NodePalette.tsx`,
  `NodeInspector.tsx`, `FlowScheduleField.tsx`, `flow-node-presentation.ts`
- Wiring de vista: `src/shared/types.ts`, `src/shared/top-level-view.ts`,
  `src/renderer/src/store/slices/ui.ts`, `store/slices/worktree-nav-history.ts`,
  `src/renderer/src/lib/worktree-activation.ts`, `lib/right-sidebar-visibility.ts`,
  `hooks/resolve-zoom-target.ts`, `components/sidebar/SidebarNav.tsx`, `App.tsx`,
  `src/main/runtime/rpc/methods/client-ui-schemas.ts`
- Refactor: `src/main/flows/flow-graph.ts` → re-export desde `src/shared/flow-graph.ts`
- Dependencia: `@xyflow/react`

---

### Etapa 5 — Ejecución desde la UI + observabilidad

**Objetivo:** correr flujos desde la UI y ver qué pasó.

- [x] Botón **"Run now"** en el header → `flows:runNow` → `FlowRunService.runNow` (guard de
      concurrencia por flujo, patrón del flag `evaluating`). Deshabilitado si la validación
      del grafo tiene errores.
- [x] **Ejecución real por tipo de nodo** (el wiring que la Etapa 3 dejó tras el dispatcher
      abstracto):
  - `shell-command` → `dispatchShellFlowNode` reusa `runAutomationPrecheck` (local/SSH).
    El workspace sale del config o **se hereda** del nodo anterior (`flow-shell-target.ts`).
    `failOnNonZeroExit` (default `true`) permite que un exit≠0 siga vivo para que una
    `condition` pueda ramificar sobre él.
  - `agent-prompt` → `RendererFlowNodeDispatcher` envía `flows:nodeDispatchRequested` y
    espera un estado final; los estados intermedios se persisten como progreso en vivo.
    El renderer (`useFlowDispatchEvents`) sintetiza un `Automation`/`AutomationRun`
    (`flow-agent-node-automation.ts`) y reusa el coordinador de dispatch de automatizaciones.
- [x] **Overlay de estado en vivo** sobre el canvas: cada nodo pinta idle/running/done/
      failed/skipped (`flow-run-presentation.ts`, `FlowNodeCard`), alimentado por el evento
      `flows:runUpdated` que emite `BroadcastingFlowRepository`.
- [x] Historial de runs (`FlowRunHistory.tsx`) colapsable + detalle por nodo: output snapshot,
      error, exit code, tokens/coste y botón para abrir el workspace del nodo.
- [x] Estados de error claros: se reusan `skipped_unavailable` /
      `skipped_needs_interactive_auth` / `dispatch_failed` del camino de automatizaciones.
- [x] Validación de config de nodo en `validateFlowGraph` (prompt/proyecto/workspace/comando
      faltantes) para que un run inválido no falle recién en ejecución.
- [x] **Tests**: `flow-shell-target`, `shell-flow-node-dispatcher` (exit codes, timeout,
      opt-out), `renderer-flow-node-dispatcher` (progreso vs. estado final, sin ventana,
      abandono) y validación de config. 45 tests de flows verdes.

**Entregable:** ejecución manual completa observable desde la UI. ✅ **HECHO**
(typecheck node/cli/web 0 · lint + gates OK · 45 tests flows · suites de automatizaciones verdes)

**Archivos tocados:**
- Main: `src/main/flows/{flow-run-service,renderer-flow-node-dispatcher,shell-flow-node-dispatcher,
  flow-shell-target}.ts` (+ tests), `flow-execution-engine.ts`, `flow-node-dispatcher.ts`,
  `src/main/ipc/flows.ts`, `src/main/index.ts`, `src/main/runtime/rpc/methods/flows.ts`
- Shared: `src/shared/flows-types.ts` (config `projectId`/`workspaceId`/`failOnNonZeroExit`,
  `FlowNodeDispatchRequest/Result`, `FlowRunUpdatedEvent`, node-run `workspaceId`/`exitCode`),
  `src/shared/flow-graph.ts` (validación de config)
- Preload: `src/preload/{index,api-types}.ts` (`runNow`, `getRun`, `markNodeDispatchResult`,
  `onNodeDispatchRequested`, `onRunUpdated`)
- Renderer: `hooks/useFlowDispatchEvents.ts`, `lib/flow-agent-node-automation.ts`,
  `components/flows/{FlowRunHistory.tsx,flow-run-presentation.ts,use-flow-runs.ts}`,
  `FlowsPage.tsx`, `flows-page-parts.tsx`, `FlowCanvas.tsx`, `FlowNodeCard.tsx`,
  `NodeInspector.tsx`, `store/slices/flows.ts`, `App.tsx`
- Refactor (sin duplicar 600 líneas de dispatch): `useAutomationDispatchEvents.ts` se divide en
  `lib/dispatch-automation-run.ts` (orquestador) + `lib/automation-run-workspace-preparation.ts`
  + `lib/automation-run-agent-session.ts` + `lib/automation-run-completion-tracker.ts`.
  Esto además **elimina** el `eslint-disable max-lines` que arrastraba el hook.

**Limitaciones conocidas (deuda explícita):** las tres quedaron **cerradas en la Etapa 5.5**.
- Los workspaces creados por un nodo de agente **no llevan provenance** de automatización:
  `resolveAutomationWorkspaceProvenance` exige una `Automation` persistida y un nodo de flujo
  no lo es.
- "Open" en el detalle de run navega al workspace del nodo; **no** restaura el panel/PTY exacto
  (`resolveAutomationRunOpenTarget`), que sigue siendo específico de automatizaciones.
- La recolección de tokens/coste (`run-usage-collection`) **nunca corre** para nodos de flujo, y
  ningún dispatch reporta `usage` → el bloque de tokens/coste de `FlowRunHistory` es UI muerta.

---

### Etapa 5.5 — Cierre de observabilidad y provenance

**Objetivo:** cerrar los tres huecos que dejó la Etapa 5. El punto 1 es **bloqueante para la
Etapa 6**: un `trigger-schedule` diario con un nodo `new_per_run` acumula un workspace por día,
invisible al filtro de la sidebar y a la limpieza segura de no registrados.

#### 1. Provenance de workspaces creados por un nodo de agente

- [x] Nuevo tipo `FlowWorkspaceProvenance` (`kind: 'created-by-flow'`) en `shared/types.ts` con
      `flowId`/`flowNameSnapshot`/`flowRunId`/`flowRunNumber`/`nodeId`/`nodeLabelSnapshot` +
      `projectId`/`repoId`/`hostId`. Se escribe en el mismo campo `Worktree.automationProvenance`,
      ahora tipado como `SystemRunWorkspaceProvenance` (unión de los dos orígenes) — un solo campo,
      un solo badge, un solo filtro. Builder en `shared/flow-workspace-provenance.ts`.
      `worktree-metadata-merge.ts` no necesitó cambios: pasa el metadato tal cual.
- [x] Request: `FlowWorkspaceProvenanceRequest` (`kind: 'flow'`) y `AutomationWorkspaceProvenanceRequest`
      pasa a llevar `kind: 'automation'`; el schema zod de `worktree.create` es ahora una
      `discriminatedUnion('kind', …)`. Un solo campo de request, así el coordinador del renderer
      (`dispatch-automation-run` → `automation-run-workspace-preparation`) no necesitó una segunda
      vía paralela.
- [x] `resolveFlowWorkspaceProvenance` (`main/flows/flow-workspace-provenance.ts`) valida contra
      `getFlowRun(runId)`: run existe, `flowId` coincide, run en `running`, el nodo sigue en el
      **snapshot congelado** siendo `agent-prompt` + `new_per_run`, su node-run **no** está en un
      estado final (eso es lo que evita que un request repetido mine un segundo workspace), repo
      selector = `projectId` del nodo, y el `dispatchToken` contra el registro real.
      _Nota: no se valida "node-run en `dispatching`" como decía el borrador — el engine persiste el
      node-run **después** de que el nodo resuelve, así que en el momento de crear el workspace
      todavía no existe. La condición correcta es "no finalizado"._
- [x] Router único `main/workspace-run-provenance.ts` para los dos handlers de create
      (`ipc/worktrees.ts`, `rpc/methods/worktree.ts`); la autoridad de automatizaciones queda
      intacta. `OrcaRuntime.getFlowRun()` añadido como autoridad de flujos.
- [x] `useFlowDispatchEvents` ya pasa `buildProvenanceRequest` (comentario de deuda eliminado);
      el `dispatchToken` que emitía `renderer-flow-node-dispatcher.ts` **ahora sí se consume**.
- [x] Consumidores: badge propio ("Created by flow", icono `Workflow`) en `WorktreeCardMetaBadges`;
      `isAutomationGeneratedWorkspace` cubre ambos `kind`, con lo que el filtro de la sidebar
      (`visible-worktrees.ts:184`), el jump palette (`WorktreeJumpPalette.tsx:493`) y el auto-clear
      de filtros al revelar (`worktree-activation.ts`) quedan cubiertos de una sola vez.
      `worktree-removal-safety` es kind-agnóstico (mira la clave, no el `kind`) → sin cambios.
- [x] Sección de detalle propia (`WorktreeCardFlowDetailSection`) con nombre del flujo, run + nodo,
      aviso si el flujo ya no existe y acción "Open flow" que abre la página de flujos **con ese
      flujo seleccionado** (nuevo `pendingFlowSelectionId` en el slice).
- [x] **Tests:** 9 de `resolveFlowWorkspaceProvenance` (provenance válida; rechazo por run
      inexistente / run terminado / nodo fuera del snapshot / nodo no `new_per_run` / node-run ya
      final / repo selector distinto / token inválido / reutilización del token) + filtro de sidebar
      ocultando workspaces de flujo. Los 6 literales de request de `worktree.test.ts` recibieron el
      discriminador `kind`.

#### 2. "Open" restaura el panel/PTY exacto

- [x] Módulo movido a `lib/run-pane-open-target.ts` con nombres neutrales
      (`resolveRunPaneOpenTarget`/`buildRunPaneOpenLayout`/`getRunPaneOpenTabId`/
      `runMatchesPaneKey`/`canOpenRunPaneTarget`) y el parámetro relajado a `RunPaneIdentity`
      (`terminalPaneKey`+`terminalPtyId`), que es lo único que el resolver lee — así sirve a
      `AutomationRun` y a `FlowNodeRun` sin duplicar lógica.
- [x] `open-flow-node-run.ts`: resuelve el target, aplica el layout con el leaf enfocado y activa
      el workspace vía `activateAndRevealWorktree` (antes era `setActiveWorktree`, que no crea la
      terminal). Devuelve `pane` / `workspace-without-pane` / `unavailable`.
- [x] **Fallback cuando el pane murió:** `workspace-without-pane` → abre el workspace y avisa con
      un toast ("Run terminal is no longer available…"), en lugar de aterrizar sin pista.
- [x] **Tests:** 6 de `open-flow-node-run` (pane enfocado, pty muerto, tab cerrada, nodo sin pane,
      sin workspace, activación fallida) + los 9 del módulo movido. 15 verdes.

#### 3. Tokens y coste para nodos de flujo

- [x] Los usage stores ya llegaban a `registerCoreHandlers`; solo hubo que pasarlos a
      `registerFlowHandlers(store, { claudeUsage, codexUsage })` → `FlowRunService` →
      `RendererFlowNodeDispatcher`.
- [x] `collectAutomationRunUsage` **no necesita una `Automation` falsa**: se estrecharon sus
      parámetros a `UsageCollectionAutomation` (`agentId`+`executionTargetType`) y
      `UsageCollectionRun` (`status`/`workspaceId`/`terminalSessionId`/`startedAt`). Los llamadores
      de automatizaciones siguen pasando los objetos completos sin cambios.
- [x] `flow-node-usage-collection.ts`: recolecta solo para nodos `agent-prompt` `completed` con
      workspace, y **devuelve `null` si el dispatch ya reportó usage** — ese es el guard
      anti-doble-recolección, más simple que el de `service.ts:148` porque la recolección ocurre
      una sola vez, donde el nodo se resuelve.
- [x] La ventana temporal arranca cuando el dispatcher pide el nodo al renderer (`startedAt`), y un
      fallo del collector nunca tumba un nodo que sí terminó (se loguea y se sigue).
- [x] **Tests:** 6 de `flow-node-usage-collection` (claude/codex, ya reportado, nodo no-agente, no
      completado / sin workspace, store ausente → `unavailable`) + 2 de wiring en el dispatcher.
      53 tests de flows verdes.

_Limitación consciente: `executionTargetType` se fija a `'local'` porque un nodo de flujo siempre
despacha por el renderer local. Un workspace remoto simplemente no encuentra filas de uso locales y
cae en `unavailable`, en vez de reportar un número equivocado._

#### Arreglos colaterales (bugs de flows que la suite completa destapó)

- [x] `register-core-handlers.test.ts` fallaba desde la Etapa 5: `registerFlowHandlers` llama
      `ipcMain.handle` al registrarse y el mock de `electron` de ese test solo exponía `app`.
      Verificado con `git stash` que era preexistente. Se añadió `ipcMain` al mock.
- [x] `flow-node-presentation.ts` evaluaba `translate()` **en carga de módulo** (10 sitios en la
      constante `FLOW_NODE_KIND_META`), lo que violaba el gate `no-top-level-translate`: los títulos
      de nodo quedaban congelados en el idioma activo al importar y podían resolverse antes de que
      i18n estuviera inicializado. Ahora son `listFlowNodeKindMeta()` / `getFlowNodeKindMeta()`, que
      traducen en cada llamada con las mismas claves.

**Entregable:** un workspace creado por un flujo se distingue y se filtra como tal; "Open" enfoca
el panel exacto; el detalle de run muestra tokens/coste reales. ✅ **HECHO**
(typecheck node/cli/web 0 · lint + los 8 gates OK · 62 tests de flows · 113 con las suites del
renderer tocadas)

**Archivos tocados:**
- Shared: `src/shared/types.ts` (`FlowWorkspaceProvenance`, `SystemRunWorkspaceProvenance`,
  requests + unión), `src/shared/flow-workspace-provenance.ts` (nuevo)
- Main: `src/main/flows/{flow-workspace-provenance,flow-node-usage-collection}.ts` (+ tests),
  `flow-run-service.ts`, `renderer-flow-node-dispatcher.ts` (+ test),
  `src/main/workspace-run-provenance.ts` (nuevo), `automations/{workspace-provenance,
  run-usage-collection}.ts`, `ipc/{flows,register-core-handlers,worktrees,worktree-remote}.ts`,
  `runtime/orca-runtime.ts` (`getFlowRun`), `runtime/rpc/methods/{worktree,worktree-schemas}.ts`
- Renderer: `lib/run-pane-open-target.ts` (movido desde `components/automations/`, + test),
  `components/flows/{open-flow-node-run.ts,FlowsPage.tsx,flow-node-presentation.ts,NodePalette.tsx}`,
  `components/sidebar/{WorktreeCardFlowDetailSection.tsx,WorktreeCard.tsx,WorktreeCardMeta.tsx,
  WorktreeCardMetaBadges.tsx,worktree-card-meta-types.ts,visible-worktrees.ts}`,
  `lib/{worktree-activation,dispatch-automation-run,automation-run-workspace-preparation}.ts`,
  `hooks/{useFlowDispatchEvents,useAutomationDispatchEvents}.ts`, `store/slices/flows.ts`,
  `components/automations/AutomationsPage.tsx`, locales (6 claves nuevas × 5 idiomas)

---

### Etapa 6 — Integración con el scheduler

**Objetivo:** flujos programados (no solo manuales).

- [x] `FlowSchedulerService` nuevo (no se extendió `AutomationService`: el estado de schedule vive
      dentro de un nodo, no en la fila del flujo). Tick de 60s, `evaluateDueFlows(now)` público para
      tests y para el pase de catch-up de arranque.
- [x] **Sin `nextRunAt` persistido.** `shared/flow-schedule.ts` deriva la ocurrencia con
      `latestAutomationOccurrenceAtOrBefore` / `nextAutomationOccurrenceAfter` y el marcador de
      "ya disparada" es el `scheduledFor` del `FlowRun` programado más reciente
      (`findLatestScheduledRun`, nueva query del repositorio).
      _Por qué: el editor reescribe el nodo de trigger en cada autosave; un `nextRunAt` guardado
      quedaría desincronizado en cuanto el usuario cambia la hora._
- [x] Ventana de gracia por flujo: `missedRunGraceMinutes` opcional en el config de
      `trigger-schedule` (default 720, igual que automatizaciones) → `FlowRunStatus`
      `'skipped_missed'` nuevo. El run perdido se persiste y **doble como marcador**, así el tick
      siguiente no reintenta la misma ocurrencia.
- [x] Elegibilidad: `isFlowScheduleEligible` exige `enabled` + nodo de schedule + grafo válido
      (`validateFlowGraph`), para que un flujo a medio editar no acumule un run fallido por tick.
- [x] **Aislamiento por host:** `flow-scheduler-host-eligibility.ts` mira los repos que los nodos
      declaran (projectId / repoId del workspaceId) y rechaza hosts `runtime:` salvo en serve
      (`allowRemoteHostScheduling`), igual que `run-target-resolution.ts` para automatizaciones.
      El run se registra como `skipped` con el motivo.
- [x] **Modo headless/serve:** `createHeadlessFlowNodeDispatcher` corre nodos `agent-prompt` sin
      renderer (crear/reusar workspace → lanzar agente → `waitForTerminal('tui-idle')` → tail como
      output), reusando `createHeadlessAutomationOutputSnapshotBuffer` y estampando la provenance
      `created-by-flow` de la Etapa 5.5. Los shell nodes ya corrían en main.
- [x] Gate de readiness del renderer: nuevo `flows:rendererReady` (patrón
      `automations:rendererReady`). Una ventana adjunta pero sin el listener montado se trata como
      ausente → cae al dispatcher headless en vez de colgarse esperando una respuesta.
- [x] Propiedad de los servicios movida a `flows/flow-services.ts` (singleton `initFlowServices`),
      porque serve arma el scheduler **sin** registrar handlers IPC de renderer.
- [x] UI: próxima ejecución en `FlowList`, selector de gracia en el inspector (reusando
      `AutomationMissedRunGraceField`), etiqueta "Missed" y motivo del run en el detalle de historial.
- [x] **Tests** (41 nuevos): `flow-scheduler-service` (due, no-doble-disparo, siguiente ocurrencia,
      gracia default y por flujo, disabled, manual-only, grafo inválido, flujo ya corriendo,
      no-solape de ticks, host remoto), `flow-schedule` (7), `headless-flow-node-dispatcher` (9),
      `flow-run-service` (7: fallback headless, gate de readiness, concurrencia, `scheduledFor`).

**Entregable:** un flujo con `trigger-schedule` corre solo a su hora. ✅ **HECHO**
(typecheck node/cli/web 0 · lint + los 8 gates OK · 103 tests flows/schedule · 515 tests de
main y 2163 del renderer verdes)

**Archivos tocados:**
- Shared: `flow-schedule.ts` (nuevo, + test), `flows-types.ts` (`missedRunGraceMinutes`,
  `skipped_missed`, `FlowRun.scheduledFor`/`error`)
- Main: `flows/{flow-scheduler-service,flow-scheduler-host-eligibility,headless-flow-node-dispatcher,
  flow-services}.ts` (+ tests), `flow-run-service.ts` (+ test: `runScheduled`,
  `recordUnexecutedRun`, gate de readiness, fallback headless), `flow-execution-engine.ts`
  (`scheduledFor`), `flow-repository.ts` + `json-flow-repository.ts`
  (`findLatestScheduledRun`, `nextRunAt` en summaries), `ipc/flows.ts`, `index.ts`,
  `runtime/rpc/methods/flows.ts`
- Preload: `index.ts`, `api-types.ts` (`flows.rendererReady`)
- Renderer: `hooks/useFlowDispatchEvents.ts`, `components/flows/{FlowList,FlowScheduleField,
  NodeInspector,FlowRunHistory}.tsx`, `flow-run-presentation.ts`, locales (3 claves × 5 idiomas)

**Limitación consciente:** el scheduler evalúa el cron en la hora local del host que corre Orca; el
campo `timezone` del nodo se guarda pero todavía no se aplica (misma limitación que
`automation-schedules.ts`). Un flujo diario dispara a su hora local, no a la del `timezone` elegido.

---

### Etapa 7 — Preparación para SQLite + pulido

**Objetivo:** validar que la abstracción aguanta y dejar todo listo para migrar cuando haga falta.

- [ ] Escribir un **`SqliteFlowRepository` de prueba (spike)** contra la MISMA interfaz y correr
      la misma suite de tests del repositorio contra ambas implementaciones (test paramétrico).
      Esto **valida el diseño** aunque no se adopte todavía.
- [ ] **Nota sobre `better-sqlite3`:** es dependencia nativa → cuidado con el piso de glibc en
      Linux (`docs/reference/linux-glibc-compatibility.md`, Ubuntu 20.04 / glibc 2.31). El
      empaquetado falla si un binario nativo requiere glibc más nuevo. No adoptar hasta tener
      evidencia de que el JSON no rinde.
- [ ] Herramienta de import/export de flujos (JSON portable) — útil para compartir y debug.
- [ ] Documentar el modelo y el motor en comentarios inline (el proyecto prefiere esto sobre
      docs de arquitectura separados).

**Entregable:** confianza de que migrar es cambiar una línea de wiring.

---

## Diseño UI/UX

> Regla base del `docs/STYLEGUIDE.md`: identidad **monocroma y silenciosa**. La UI de Orca "recede
> and frames". **Nada de la paleta saturada tipo n8n.** El color se reserva para *estado*.

### Layout general (`FlowsPage`)

```
┌───────────────────────────────────────────────────────────────────────┐
│  Flows                                              [+ New flow]  [Run]  │  ← header
├──────────────┬────────────────────────────────────────┬────────────────┤
│              │                                          │                │
│  Node        │                                          │  Inspector     │
│  Palette     │            Canvas (pan/zoom)             │  (config del   │
│              │                                          │   nodo activo) │
│  · Trigger   │        ┌──────┐      ┌──────┐            │                │
│  · Agent     │        │trigger│─────▶│agent │            │  [campos del   │
│  · Shell     │        └──────┘      └──┬───┘            │   nodo select] │
│  · Condition │                         │                │                │
│              │                    ┌────▼────┐           │                │
│  (arrastrar  │                    │ shell   │           │                │
│   al canvas) │                    └─────────┘           │                │
│              │                                    [mini]│                │
├──────────────┴────────────────────────────────────────┴────────────────┤
│  Run history (colapsable) · #12 completed · #11 failed · ...            │
└───────────────────────────────────────────────────────────────────────┘
```

- **Canvas:** fondo `background`, hairlines de grid muy sutiles con `border` a baja opacidad.
- **Paleta izquierda:** panel `card`, filas con hover `bg-accent` (patrón de list rows del styleguide).
- **Inspector derecho:** panel `card`; reutiliza los campos de formulario ya existentes de
  automatizaciones (no reinventar los inputs de schedule/precheck/workspace).
- **Run history abajo:** colapsable, patrón `AutomationRunHistory`.

### Anatomía de un nodo

```
   ┌─────────────────────────────┐
 ○─┤  [icono]  Agent prompt       │─○     ○ = handle de conexión (borde `border`)
   │  claude · new workspace      │        icono monocromo (lucide)
   │  ─────────────────────────── │
   │  "Revisa los cambios y..."   │  ← preview del prompt/comando, `muted-foreground`
   └─────────────────────────────┘
```

- **Superficie:** `card` / `card-foreground`. Borde `border`.
- **Seleccionado:** halo con `ring` (no color de acento sólido).
- **Handles:** círculos pequeños en `border`; al conectar válido → `ring`.
- **Título:** peso medio, `foreground`. **Subtítulo/preview:** `muted-foreground`.
- **Icono por tipo** (lucide, monocromo): trigger=`clock`/`play`, agent=`bot`/`sparkles`,
  shell=`terminal`, condition=`git-branch`.

### Color = estado (única excepción al monocromo)

Durante la ejecución, el borde/indicador del nodo comunica estado. **Reutilizar la semántica de
tokens existente, no inventar colores:**

| Estado nodo | Señal visual |
|-------------|--------------|
| Idle | Borde `border`, sin énfasis |
| Running | Borde `ring` + spinner sutil |
| Completed | Check en `muted-foreground` (o `--git-decoration-added` si se quiere verde discreto) |
| Failed | Borde `destructive` + icono de error |
| Skipped | Atenuado (`opacity-50`), texto `muted-foreground` |

### Interacciones clave

- **Arrastrar** desde la paleta o hacer doble clic en el canvas para crear nodo.
- **Conectar** arrastrando de un handle de salida a uno de entrada. Validación en vivo:
  no permitir ciclos, resaltar handles compatibles.
- **Nodo `condition`** con dos handles de salida etiquetados (`true` / `false`).
- **Autosave** con indicador de estado (dirty/guardado), patrón del resto de la app.
- **Atajos multiplataforma** (por `AGENTS.md`): nada de `metaKey` hardcodeado — usar el check de
  plataforma; mostrar `⌘` en Mac y `Ctrl+` en Linux/Windows. Delete = borrar nodo/arista
  seleccionada, `⌘/Ctrl+Z` = undo.
- **Accesibilidad:** el canvas necesita fallback de teclado para seleccionar/mover nodos
  (React Flow lo soporta; no dejarlo solo-mouse).

### Estados vacíos y de error

- **Sin flujos:** empty state con CTA "New flow" + link a plantillas (patrón `CreateFromPicker`).
- **Flujo inválido:** banner no-bloqueante listando problemas (sin trigger, nodo desconectado,
  ciclo detectado). No permitir "Run" hasta resolverlos.
- **Run fallido:** el nodo culpable resaltado en `destructive`; click → detalle del error.

---

## Consideraciones transversales (esenciales)

1. **Cross-platform** (`AGENTS.md`): rutas con `path.join`, atajos por plataforma, sin asumir
   ejecución local-only.
2. **SSH y folder workspaces:** todo nodo de ejecución debe considerar hosts remotos y folder
   workspaces, no solo git worktrees locales (igual que `useAutomationDispatchEvents` hoy).
3. **Git binary compatibility:** cualquier nodo que corra git debe respetar el baseline 2.25 y el
   patrón `GitCapabilityCache` (`docs/reference/git-compatibility.md`).
4. **Provider compatibility:** si un nodo integra source-control, considerar GitLab/otros, no
   solo GitHub.
5. **Sin `eslint-disable max-lines`:** dividir módulos grandes (el motor y la página de canvas
   tienden a crecer — partirlos por responsabilidad desde el inicio).
6. **Concurrencia del scheduler:** el tick no debe re-disparar un flujo ya en curso
   (patrón del flag `evaluating` en `AutomationService`).
7. **Seguridad de dispatch:** reusar `dispatchToken` para autenticar workspaces creados por un run.
8. **Retención y tamaño del JSON:** truncar outputs y podar runs agresivamente mientras estemos
   en Opción A — es el mayor riesgo del store JSON.
9. **Tests en cada etapa:** repositorio, motor (con dispatcher mock), scheduling, y aislamiento
   por host. El test paramétrico Json-vs-Sqlite (Etapa 7) es el que valida la abstracción.

---

## Resumen de secuencia recomendada

```
Etapa 0 (andamiaje) → Etapa 1 (datos) → Etapa 2 (IPC) → Etapa 3 (motor, MVP lineal) ★
    ★ punto de "probar que funciona"
→ Etapa 4 (canvas UI) → Etapa 5 (ejecución+observabilidad UI)
→ Etapa 5.5 (provenance + observabilidad; provenance bloquea la 6) → Etapa 6 (scheduler)
→ Etapa 7 (spike SQLite + pulido)
```

**Camino más corto a un demo funcional:** Etapas 0→1→2→3 con solo `trigger-manual` + `agent-prompt`
en modo lineal. Eso prueba toda la cadena (datos → repositorio → motor → dispatch → reuso de la
ejecución de agente existente) antes de invertir en el canvas.

---

## Casos de uso y flujos de ejemplo

El valor del editor por nodos frente a la automatización actual (una sola acción) es **encadenar
pasos, ramificar según resultados y mezclar agentes de IA con comandos shell** en un mismo flujo.
Estos son los usos que el sistema habilita.

### 1. Revisión y mantenimiento de repositorio

- **Auditoría diaria de código:** `trigger-schedule (cada día 8am)` → `shell (git pull)` →
  `agent (revisa cambios recientes y resume riesgos)` → `condition (¿encontró issues?)` →
  si sí, `agent (abre draft PR / crea issue)`.
- **Guardián de dependencias:** `trigger-schedule (semanal)` → `shell (npm outdated / audit)` →
  `condition (¿hay vulnerabilidades?)` → `agent (propone bumps y prueba el build)`.
- **Higiene de ramas:** `trigger-schedule` → `shell (lista ramas merged)` →
  `agent (identifica cuáles borrar de forma segura)` → `shell (git branch -d)`.

### 2. Pipelines de trabajo agéntico multi-paso

Aquí es donde el grafo brilla: un agente prepara el contexto, otro actúa sobre él.

- **Triage → fix:** `agent (lee un issue/tarea y clasifica)` → `condition (¿es trivial?)` →
  si sí, `agent (implementa el fix en un workspace nuevo)`; si no, `shell (notifica al equipo)`.
- **Refactor por lotes:** `trigger-manual` → `agent (localiza todos los usos de un patrón)` →
  `agent (aplica la migración archivo por archivo)` → `shell (corre tests)` →
  `condition (¿pasan?)` → `agent (abre PR)` o `agent (reporta qué falló)`.
- **Documentación viva:** `trigger-schedule` → `agent (detecta APIs sin documentar)` →
  `agent (genera/actualiza docs)` → `shell (commit)`.

### 3. Preparación de releases

- **Release semanal asistida:** `trigger-schedule (viernes)` → `shell (genera changelog desde git)`
  → `agent (redacta las release notes a partir del changelog)` →
  `condition (¿build verde?)` → `agent (prepara el tag/PR de release)`.

### 4. Verificación y control de calidad (con precondiciones)

- **Gate de CI local:** `trigger-manual` → `shell (lint + typecheck + test)` como precondición →
  `condition (¿todo verde?)` → `agent (procede)` o corta el flujo con estado `skipped`.
- **Reproducción de bugs:** `trigger-manual` → `agent (lee un reporte de bug)` →
  `shell (levanta el entorno y reproduce)` → `agent (analiza logs y propone causa raíz)`.

### 5. Flujos programados de monitoreo/ops

- **Chequeo horario de salud:** `trigger-schedule (cada hora)` → `shell (health check / endpoint)`
  → `condition (¿degradado?)` → `agent (investiga y resume el incidente)`.
- **Backup/sync de artefactos:** `trigger-schedule (nocturno)` → `shell (export/backup)` →
  `condition (¿ok?)` → `shell (notifica éxito/fallo)`.

### 6. Flujos reutilizables bajo demanda (guardados, no programados)

Flujos que el usuario **guarda una vez y dispara manualmente** cuando los necesita — la otra mitad
de tu idea original:

- **"Onboarding de tarea":** un flujo que, dado un ticket, crea el workspace, corre el setup,
  lanza el agente con el contexto del ticket y deja todo listo para trabajar.
- **"Cierre de feature":** corre tests → genera changelog → redacta descripción de PR → abre el PR.
- **"Snapshot de estado del repo":** reúne git status + tests + resumen del agente en un solo run
  para revisar rápido en qué estado quedó todo.

### Qué hace posible cada tipo de nodo

| Nodo | Habilita |
|------|----------|
| `trigger-schedule` | Flujos periódicos (cron/RRULE) sin intervención |
| `trigger-manual` | Flujos guardados que se corren bajo demanda ("Run now") |
| `agent-prompt` | Cualquier tarea de razonamiento/edición sobre el código (el núcleo de Orca) |
| `shell-command` | Puente con el mundo real: git, tests, builds, health checks, notificaciones |
| `condition` | Ramificación: reaccionar distinto según resultado/exit code de un paso previo |

### Patrón mental para el usuario

> **Un agente decide o produce, un shell verifica o actúa, una condición ramifica.**
> Encadenando estos tres, un flujo puede "leer contexto → hacer trabajo → verificar → reaccionar"
> — cosa que la automatización de acción única de hoy no puede expresar.
