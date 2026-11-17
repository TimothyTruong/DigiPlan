import { useEffect, useMemo, useState } from 'react'
import { useSearch } from 'wouter'
import { format } from 'date-fns'
import { PageShell } from '../components/PageShell'
import { Empty, Modal, Seg, toast } from '../components/ui'
import { addDaysISO, fmtTime, fromISO, todayISO, weekDays } from '../lib/dates'
import { uid } from '../lib/id'
import { useStore } from '../store/store'
import type { Workout, WorkoutType } from '../store/types'

const TYPES: { value: WorkoutType; label: string; emoji: string }[] = [
  { value: 'strength', label: 'Strength', emoji: '🏋️‍♀️' }, { value: 'cardio', label: 'Cardio', emoji: '🏃‍♀️' },
  { value: 'mobility', label: 'Mobility', emoji: '🧘‍♀️' }, { value: 'sport', label: 'Sport', emoji: '🏸' }, { value: 'other', label: 'Other', emoji: '✨' },
]
const emojiFor = (t: WorkoutType) => TYPES.find((x) => x.value === t)!.emoji

export default function Fitness() {
  const params = new URLSearchParams(useSearch())
  const workouts = useStore((s) => s.workouts)
  const ws = useStore((s) => s.settings.weekStartsOn)
  const { upsertWorkout } = useStore.getState()
  const [anchor, setAnchor] = useState(todayISO())
  const [editing, setEditing] = useState<Workout | null>(null)
  const t = todayISO()
  const days = weekDays(anchor, ws)
  useEffect(() => {
    const id = params.get('w')
    const w = id && useStore.getState().workouts.find((x) => x.id === id)
    if (w) setEditing(w)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const week = useMemo(() => workouts.filter((w) => w.date >= days[0] && w.date <= days[6]).sort((a, b) => (a.date + (a.time ?? '') < b.date + (b.time ?? '') ? -1 : 1)), [workouts, days])
  const done = week.filter((w) => w.done)
  const minutes = done.reduce((n, w) => n + (w.durationMin ?? 0), 0)
  const streak = useMemo(() => {
    // consecutive weeks (ending this or last week) with at least one completed workout
    const doneDates = new Set(workouts.filter((w) => w.done).map((w) => w.date))
    let n = 0, start = weekDays(t, ws)[0]
    const hasIn = (s: string) => Array.from({ length: 7 }, (_, i) => addDaysISO(s, i)).some((d) => doneDates.has(d))
    if (!hasIn(start)) start = addDaysISO(start, -7)
    while (hasIn(start)) { n++; start = addDaysISO(start, -7) }
    return n
  }, [workouts, t, ws])
  const blank = (date = t): Workout => ({ id: uid(), date, title: '', type: 'strength', exercises: [], done: false })

  return (
    <PageShell section="fitness" actions={<button className="btn primary" onClick={() => setEditing(blank())}>+ Workout</button>}>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="l">This week</div><div className="v">{done.length}/{week.length || 0}</div><div className="small muted">sessions done</div></div>
        <div className="stat"><div className="l">Active minutes</div><div className="v">{minutes}</div><div className="small muted">this week</div></div>
        <div className="stat"><div className="l">Streak</div><div className="v">{streak} wk{streak === 1 ? '' : 's'}</div><div className="small muted">with at least one workout</div></div>
      </div>
      <div className="card">
        <div className="cal-toolbar">
          <button className="btn icon" onClick={() => setAnchor(addDaysISO(anchor, -7))} aria-label="Previous week">‹</button>
          <button className="btn sm" onClick={() => setAnchor(t)}>This week</button>
          <button className="btn icon" onClick={() => setAnchor(addDaysISO(anchor, 7))} aria-label="Next week">›</button>
          <div className="cal-title">{format(fromISO(days[0]), 'MMM d')} – {format(fromISO(days[6]), 'MMM d')}</div>
          <div className="grow" />
          {week.length > 0 && <button className="btn sm" onClick={() => {
            week.forEach((w) => upsertWorkout({ ...w, id: uid(), date: addDaysISO(w.date, 7), done: false }))
            toast(`Copied ${week.length} workouts to next week`); setAnchor(addDaysISO(anchor, 7))
          }}>Repeat week →</button>}
        </div>
        {days.map((d) => {
          const list = week.filter((w) => w.date === d)
          return (
            <div key={d} className="agenda-day">
              <div className={`agenda-date${d === t ? ' today' : ''}`}><b>{format(fromISO(d), 'd')}</b><span className="small muted">{format(fromISO(d), 'EEE')}</span></div>
              <div className="stack" style={{ gap: 4 }}>
                {list.map((w) => (
                  <div key={w.id} className={`lrow${w.done ? ' done' : ''}`}>
                    <input type="checkbox" className="check round" checked={w.done} onChange={() => upsertWorkout({ ...w, done: !w.done })} aria-label={`Mark ${w.title} done`} />
                    <button className="linkish" onClick={() => setEditing(w)}>
                      <div className="lrow-title">{emojiFor(w.type)} {w.title || 'Workout'}</div>
                      <div className="tiny muted">{[w.time && fmtTime(w.time), w.durationMin && `${w.durationMin} min`, w.exercises.length && `${w.exercises.length} exercises`].filter(Boolean).join(' · ') || TYPES.find((x) => x.value === w.type)!.label}</div>
                    </button>
                  </div>
                ))}
                {!list.length && <button className="btn ghost sm" style={{ alignSelf: 'flex-start', color: 'var(--faint)' }} onClick={() => setEditing(blank(d))}>+ plan</button>}
              </div>
            </div>
          )
        })}
        {!workouts.length && <Empty emoji="🏃‍♀️">Plan your first workout — it’ll show on your calendar and Today page.</Empty>}
      </div>
      {editing && <WorkoutEditor w={editing} onClose={() => setEditing(null)} />}
    </PageShell>
  )
}

function WorkoutEditor({ w: init, onClose }: { w: Workout; onClose: () => void }) {
  const exists = useStore((s) => s.workouts.some((x) => x.id === init.id))
  const { upsertWorkout, deleteWorkout } = useStore.getState()
  const [w, setW] = useState(init)
  const set = (p: Partial<Workout>) => setW({ ...w, ...p })
  const setEx = (id: string, p: object) => set({ exercises: w.exercises.map((e) => (e.id === id ? { ...e, ...p } : e)) })
  const num = (v: string) => (v === '' ? undefined : Number(v))
  function save() { upsertWorkout({ ...w, title: w.title.trim() || TYPES.find((x) => x.value === w.type)!.label }); onClose() }
  return (
    <Modal open onClose={onClose} wide title={exists ? 'Workout' : 'Plan a workout'} footer={<>
      <div className="row">{exists && <button className="btn ghost danger" onClick={() => { deleteWorkout(w.id); onClose() }}>Delete</button>}</div>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <Seg<WorkoutType> value={w.type} onChange={(type) => set({ type })} options={TYPES.map((t) => ({ value: t.value, label: `${t.emoji} ${t.label}` }))} />
        <input className="input" style={{ height: 44, fontSize: 18, fontWeight: 600 }} autoFocus placeholder="e.g. Upper body, 5k run, Hot yoga" value={w.title} onChange={(e) => set({ title: e.target.value })} />
        <div className="grid cols-3">
          <label className="field"><span>Date</span><input type="date" className="input" value={w.date} onChange={(e) => e.target.value && set({ date: e.target.value })} /></label>
          <label className="field"><span>Time</span><input type="time" className="input" value={w.time ?? ''} onChange={(e) => set({ time: e.target.value || undefined })} /></label>
          <label className="field"><span>Duration (min)</span><input type="number" className="input" value={w.durationMin ?? ''} onChange={(e) => set({ durationMin: num(e.target.value) })} /></label>
        </div>
        <div className="field"><span>Exercises</span>
          {w.exercises.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              <div className="row tiny muted"><span className="grow">Exercise</span><span style={{ width: 64 }}>Sets</span><span style={{ width: 64 }}>Reps</span><span style={{ width: 72 }}>kg</span><span style={{ width: 28 }} /></div>
              {w.exercises.map((e) => (
                <div key={e.id} className="row">
                  <input className="input grow" value={e.name} onChange={(ev) => setEx(e.id, { name: ev.target.value })} aria-label="Exercise name" />
                  <input type="number" className="input" style={{ width: 64 }} value={e.sets ?? ''} onChange={(ev) => setEx(e.id, { sets: num(ev.target.value) })} aria-label="Sets" />
                  <input type="number" className="input" style={{ width: 64 }} value={e.reps ?? ''} onChange={(ev) => setEx(e.id, { reps: num(ev.target.value) })} aria-label="Reps" />
                  <input type="number" className="input" style={{ width: 72 }} value={e.weight ?? ''} onChange={(ev) => setEx(e.id, { weight: num(ev.target.value) })} aria-label="Weight" />
                  <button className="btn ghost icon sm" aria-label="Remove exercise" onClick={() => set({ exercises: w.exercises.filter((x) => x.id !== e.id) })}>✕</button>
                </div>
              ))}
            </div>
          )}
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ exercises: [...w.exercises, { id: uid(), name: '', sets: 3, reps: 10 }] })}>+ Exercise</button>
        </div>
        <label className="field"><span>Notes</span><textarea className="textarea" rows={2} value={w.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} /></label>
        <label className="row small"><input type="checkbox" className="check" checked={w.done} onChange={(e) => set({ done: e.target.checked })} /> Completed</label>
      </div>
    </Modal>
  )
}
