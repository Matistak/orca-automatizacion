import React, { useMemo, useState } from 'react'
import {
  buildAutomationRrule,
  tryParseAutomationRrule
} from '../../../../shared/automation-schedules'
import { DEFAULT_FLOW_MISSED_RUN_GRACE_MINUTES } from '../../../../shared/flow-schedule'
import { AutomationSchedulePicker } from '@/components/automations/AutomationSchedulePicker'
import { AutomationMissedRunGraceField } from '@/components/automations/AutomationMissedRunGraceField'
import { Field } from '@/components/automations/automation-page-parts'
import type { AutomationDraft } from '@/components/automations/AutomationEditorDialog'
import { translate } from '@/i18n/i18n'

/**
 * Schedule editor for a trigger-schedule node. Reuses the automations
 * AutomationSchedulePicker by adapting its AutomationDraft to/from an rrule.
 */
export function FlowScheduleField({
  rrule,
  missedRunGraceMinutes,
  onRruleChange,
  onMissedRunGraceMinutesChange
}: {
  rrule: string
  missedRunGraceMinutes: number | undefined
  onRruleChange: (rrule: string) => void
  onMissedRunGraceMinutesChange: (minutes: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<AutomationDraft>(() => ({
    ...seedDraftFromRrule(rrule),
    missedRunGraceMinutes: String(missedRunGraceMinutes ?? DEFAULT_FLOW_MISSED_RUN_GRACE_MINUTES)
  }))

  const label = useMemo(() => rrule || 'No schedule set', [rrule])

  return (
    <>
      <Field label={translate('auto.components.flows.FlowScheduleField.2465676bae', 'Schedule')}>
        <AutomationSchedulePicker
          draft={draft}
          onDraftChange={(updater) =>
            setDraft((current) => {
              const next = updater(current)
              onRruleChange(rruleFromDraft(next))
              return next
            })
          }
        />
        <p className="mt-1 truncate text-[11px] text-muted-foreground">{label}</p>
      </Field>
      <AutomationMissedRunGraceField
        draft={draft}
        disabled={false}
        pickerTriggerClassName="h-8 text-xs"
        onDraftChange={(updater) =>
          setDraft((current) => {
            const next = updater(current)
            const parsed = Number(next.missedRunGraceMinutes)
            onMissedRunGraceMinutesChange(
              Number.isFinite(parsed) ? parsed : DEFAULT_FLOW_MISSED_RUN_GRACE_MINUTES
            )
            return next
          })
        }
      />
    </>
  )
}

function rruleFromDraft(draft: AutomationDraft): string {
  if (draft.preset === 'custom') {
    return draft.customSchedule.trim()
  }
  const [rawHour, rawMinute] = draft.time.split(':').map((part) => Number(part))
  return buildAutomationRrule({
    preset: draft.preset,
    hour: Number.isFinite(rawHour) ? rawHour : 9,
    minute: Number.isFinite(rawMinute) ? rawMinute : 0,
    dayOfWeek: Number(draft.dayOfWeek)
  })
}

function seedDraftFromRrule(rrule: string): AutomationDraft {
  const parsed = tryParseAutomationRrule(rrule)
  const base: AutomationDraft = {
    name: '',
    prompt: '',
    agentId: 'claude',
    projectId: '',
    workspaceMode: 'existing',
    workspaceId: '',
    baseBranch: '',
    setupDecision: undefined,
    reuseSession: false,
    precheckCommand: '',
    precheckTimeoutSeconds: '60',
    preset: 'daily',
    time: '09:00',
    dayOfWeek: '1',
    customSchedule: '',
    missedRunGraceMinutes: '720',
    scheduleWarning: null
  }
  if (!parsed) {
    // Unrecognized rrule → treat as a custom advanced schedule.
    return { ...base, preset: 'custom', customSchedule: rrule }
  }
  return {
    ...base,
    preset: parsed.preset,
    time: `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`,
    dayOfWeek: String(parsed.dayOfWeek)
  }
}
