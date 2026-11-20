import type { CSSProperties } from 'react'
import { navigate } from 'wouter/use-browser-location'
import { ROUTER_BASE } from '../config'
import type { Entry } from '../lib/agenda'
import { fmtTime } from '../lib/dates'
import { useStore } from '../store/store'
import { KIND_META } from '../theme/themes'
import { openEditor } from './ItemEditor'

export function openEntry(e: Entry) {
  if (e.item) openEditor({ id: e.item.id }, e.date)
  else if (e.workoutId) navigate(`${ROUTER_BASE}/fitness?w=${e.workoutId}`)
  else if (e.google?.htmlLink) window.open(e.google.htmlLink, '_blank', 'noopener')
}

export function toggleEntry(e: Entry) {
  const st = useStore.getState()
  if (e.item) st.toggleItem(e.item.id, e.date)
  else if (e.workoutId) {
    const w = st.workouts.find((x) => x.id === e.workoutId)
    if (w) st.upsertWorkout({ ...w, done: !w.done })
  }
}

const label = (e: Entry) => e.kind === 'workout' ? '🏃‍♀️ Workout' : e.kind === 'google' ? 'Google' : `${KIND_META[e.kind].emoji} ${KIND_META[e.kind].label}`

export function EntryRow({ e, showDate }: { e: Entry; showDate?: string }) {
  const checkable = e.kind === 'task' || e.kind === 'assignment' || e.kind === 'workout'
  const steps = e.item?.steps
  const stepDone = steps?.filter((s) => s.done).length ?? 0
  return (
    <div className={`lrow${e.done ? ' done' : ''}`} style={{ '--accent': e.color } as CSSProperties}>
      <div className="time-col">{showDate ?? (e.start ? fmtTime(e.start) : 'All day')}</div>
      {checkable
        ? <input type="checkbox" className="check round" checked={e.done} onChange={() => toggleEntry(e)} aria-label={`Mark ${e.title} done`} />
        : <span className="bar" />}
      <button className="linkish" onClick={() => openEntry(e)}>
        <div className="lrow-title ellipsis">{e.title}</div>
        <div className="tiny muted ellipsis">
          {label(e)}{e.course ? ` · ${e.course.code || e.course.name}` : ''}{e.end && e.start ? ` · until ${fmtTime(e.end)}` : ''}{e.location ? ` · ${e.location}` : ''}
          {steps?.length ? ` · ${stepDone}/${steps.length} steps` : ''}
        </div>
      </button>
    </div>
  )
}
