import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { format } from 'date-fns'
import { fromISO, todayISO } from '../lib/dates'
import { useGoogle } from '../lib/google'
import { deleteSynced, skipSynced, syncAfterSave } from '../lib/sync'
import { uid } from '../lib/id'
import { useStore } from '../store/store'
import type { Freq, Item, ItemKind } from '../store/types'
import { KIND_META } from '../theme/themes'
import { Modal, Seg, toast } from './ui'

interface EditorState { item?: Item; occurrence?: string; open: boolean }
export const useEditor = create<EditorState>(() => ({ open: false }))
export const openEditor = (item: Partial<Item> & { id?: string }, occurrence?: string) => {
  const existing = item.id ? useStore.getState().items.find((i) => i.id === item.id) : undefined
  useEditor.setState({
    open: true, occurrence,
    item: existing ?? { id: uid(), kind: 'task', title: '', date: todayISO(), createdAt: Date.now(), ...item } as Item,
  })
}
const close = () => useEditor.setState({ open: false })

const FREQS: { value: Freq | ''; label: string }[] = [
  { value: '', label: 'Does not repeat' }, { value: 'daily', label: 'Every day' }, { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: 'Every 2 weeks' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' },
]
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function ItemEditor() {
  const { open, item: initial, occurrence } = useEditor()
  const courses = useStore((s) => s.courses)
  const exists = useStore((s) => !!initial && s.items.some((i) => i.id === initial.id))
  const { upsertItem } = useStore.getState()
  const gToken = useGoogle((s) => s.token)
  const [it, setIt] = useState<Item | undefined>(initial)
  const [push, setPush] = useState(false)
  const [newStep, setNewStep] = useState('')
  useEffect(() => { setIt(initial); setPush(!!initial?.gcal); setNewStep('') }, [initial])
  if (!open || !it) return null

  const set = (p: Partial<Item>) => setIt({ ...it, ...p })
  const addStep = () => { if (!newStep.trim()) return; set({ steps: [...(it.steps ?? []), { id: uid(), text: newStep.trim(), done: false }] }); setNewStep('') }
  const timed = it.start !== undefined
  const showGrade = it.kind === 'assignment' || it.kind === 'exam'
  const showSteps = it.kind === 'assignment' || it.kind === 'task'

  async function save() {
    if (!it) return
    if (!it.title.trim()) { toast('Give it a title'); return }
    // A step typed but not confirmed with Enter still counts.
    const pending = newStep.trim() ? [{ id: uid(), text: newStep.trim(), done: false }] : []
    const next: Item = { ...it, title: it.title.trim(), ...(pending.length && { steps: [...(it.steps ?? []), ...pending] }) }
    if (next.end && next.start && next.end <= next.start) next.end = undefined
    upsertItem(next)
    close()
    const r = await syncAfterSave(next, push)
    toast(r?.message ?? (exists ? 'Saved' : `${KIND_META[next.kind].label} added`))
  }

  async function remove() {
    if (!it) return
    close()
    const { undo, warning } = await deleteSynced(it)
    toast(warning ?? 'Deleted', { label: 'Undo', run: undo })
  }

  return (
    <Modal open onClose={close} title={exists ? 'Edit' : 'New'} wide
      footer={<>
        <div className="row">
          {exists && <button className="btn ghost danger" onClick={remove}>Delete</button>}
          {exists && it.recurrence && occurrence && (
            <button className="btn ghost" onClick={async () => { close(); const r = await skipSynced(it.id, occurrence); toast(r?.message ?? `Skipped ${format(fromISO(occurrence), 'MMM d')}`) }}>Skip this date only</button>
          )}
        </div>
        <div className="row">
          <button className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" onClick={save}>Save <kbd className="kbd-hint">⌘↵</kbd></button>
        </div>
      </>}>
      <div className="stack" style={{ gap: 14 }} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save() }}>
        <Seg<ItemKind> className="kinds" value={it.kind} onChange={(kind) => set({ kind, countdown: kind === 'exam' ? true : it.countdown })} label="Type"
          options={(Object.keys(KIND_META) as ItemKind[]).map((k) => ({ value: k, label: <span className="kind-opt"><span aria-hidden>{KIND_META[k].emoji}</span> <span>{KIND_META[k].label}</span></span> }))} />
        <input className="input" style={{ height: 44, fontSize: 18, fontWeight: 600 }} autoFocus placeholder={it.kind === 'exam' ? 'e.g. Biology midterm' : it.kind === 'assignment' ? 'e.g. Essay draft' : 'Title'}
          value={it.title} onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) save() }} />

        <div className="grid cols-3">
          <label className="field"><span>{it.kind === 'assignment' || it.kind === 'task' ? 'Due' : 'Date'}</span>
            <input type="date" className="input" value={it.date} onChange={(e) => e.target.value && set({ date: e.target.value })} /></label>
          <label className="field"><span>Class</span>
            <select className="select" value={it.courseId ?? ''} onChange={(e) => set({ courseId: e.target.value || undefined })}>
              <option value="">None</option>
              {courses.filter((c) => !c.archived).map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.code || c.name}</option>)}
            </select></label>
          <label className="field"><span>Repeat</span>
            <select className="select" value={it.recurrence?.freq ?? ''} onChange={(e) => set({ recurrence: e.target.value ? { ...it.recurrence, freq: e.target.value as Freq } : undefined })}>
              {FREQS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select></label>
        </div>

        {(it.recurrence?.freq === 'weekly' || it.recurrence?.freq === 'biweekly') && (
          <div className="row wrap">
            <span className="small muted">On</span>
            {DOW.map((d, i) => {
              const days = it.recurrence!.byDay ?? [fromISO(it.date).getDay()]
              const on = days.includes(i)
              return <button key={i} className={`chip${on ? '' : ' outline'}`} aria-pressed={on} onClick={() => {
                const next = on ? days.filter((x) => x !== i) : [...days, i].sort()
                set({ recurrence: { ...it.recurrence!, byDay: next.length ? next : undefined } })
              }}>{d}</button>
            })}
            <label className="row small muted" style={{ marginLeft: 'auto' }}>until <input type="date" className="input" style={{ width: 150 }} value={it.recurrence.until ?? ''} onChange={(e) => set({ recurrence: { ...it.recurrence!, until: e.target.value || undefined } })} /></label>
          </div>
        )}

        <div className="row wrap" style={{ gap: 12 }}>
          <label className="row small"><input type="checkbox" className="check" checked={!timed} onChange={(e) => set(e.target.checked ? { start: undefined, end: undefined } : { start: it.kind === 'assignment' ? '23:59' : '09:00' })} /> All day</label>
          {timed && <>
            <input type="time" className="input" style={{ width: 130 }} value={it.start} onChange={(e) => set({ start: e.target.value })} aria-label="Start time" />
            <span className="muted">→</span>
            <input type="time" className="input" style={{ width: 130 }} value={it.end ?? ''} onChange={(e) => set({ end: e.target.value || undefined })} aria-label="End time" />
          </>}
          <label className="row small" style={{ marginLeft: 'auto' }}><input type="checkbox" className="check" checked={!!it.countdown} onChange={(e) => set({ countdown: e.target.checked })} /> Show countdown</label>
        </div>

        {showSteps && (
          <div className="field"><span>Steps</span>
            <div className="stack" style={{ gap: 4 }}>
              {(it.steps ?? []).map((s) => (
                <div key={s.id} className="row">
                  <input type="checkbox" className="check round" checked={s.done} onChange={() => set({ steps: it.steps!.map((x) => x.id === s.id ? { ...x, done: !x.done } : x) })} />
                  <input className="input bare grow" value={s.text} onChange={(e) => set({ steps: it.steps!.map((x) => x.id === s.id ? { ...x, text: e.target.value } : x) })} />
                  <button className="btn ghost icon sm" aria-label="Remove step" onClick={() => set({ steps: it.steps!.filter((x) => x.id !== s.id) })}>✕</button>
                </div>
              ))}
              <div className="row">
                <input className="input" placeholder="Add a step" value={newStep} onChange={(e) => setNewStep(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && newStep.trim()) { e.preventDefault(); addStep() } }} />
                <button className="btn" onClick={addStep} disabled={!newStep.trim()}>+ Add</button>
              </div>
            </div>
          </div>
        )}

        <details open={!!(it.location || it.notes || it.weight !== undefined || it.score !== undefined)}>
          <summary className="small muted" style={{ cursor: 'pointer', fontWeight: 600 }}>More details{showGrade ? ' — location, grade weight, notes' : ' — location, notes'}</summary>
          <div className="stack" style={{ gap: 14, marginTop: 12 }}>
        <label className="field"><span>Location</span><input className="input" placeholder="Room, building or link" value={it.location ?? ''} onChange={(e) => set({ location: e.target.value || undefined })} /></label>

        {showGrade && (
          <div className="grid cols-2">
            <label className="field"><span>Weight (% of grade)</span><input type="number" min={0} max={100} className="input" value={it.weight ?? ''} onChange={(e) => set({ weight: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
            <label className="field"><span>Score (%)</span><input type="number" min={0} max={150} className="input" placeholder="Once marked" value={it.score ?? ''} onChange={(e) => set({ score: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          </div>
        )}

        <label className="field"><span>Notes</span><textarea className="textarea" rows={3} value={it.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} /></label>
          </div>
        </details>

        {gToken && (
          <label className="row small"><input type="checkbox" className="check" checked={push} onChange={(e) => setPush(e.target.checked)} /> Also put this on my Google Calendar</label>
        )}
      </div>
    </Modal>
  )
}
