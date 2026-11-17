import { useMemo, useState, type CSSProperties } from 'react'
import { useSearch } from 'wouter'
import { format } from 'date-fns'
import { openEditor } from '../components/ItemEditor'
import { PageShell } from '../components/PageShell'
import { Empty, Progress, toast } from '../components/ui'
import { countdownLabel, daysUntil, fromISO, isDone, nextOccurrence, todayISO } from '../lib/dates'
import { uid } from '../lib/id'
import { useStore } from '../store/store'
import type { Item, ItemKind } from '../store/types'
import { KIND_ACCENT, KIND_META } from '../theme/themes'

type F = 'open' | 'assignment' | 'task' | 'exam' | 'done'

export default function Tasks() {
  const params = new URLSearchParams(useSearch())
  const [f, setF] = useState<F>((params.get('f') as F) || 'open')
  const [q, setQ] = useState('')
  const [quick, setQuick] = useState('')
  const items = useStore((s) => s.items)
  const courses = useStore((s) => s.courses)
  const { toggleItem, upsertItem } = useStore.getState()
  const t = todayISO()
  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses])

  const rows = useMemo(() => {
    const kinds: ItemKind[] = f === 'assignment' ? ['assignment'] : f === 'task' ? ['task'] : f === 'exam' ? ['exam'] : ['task', 'assignment', 'exam']
    const ql = q.toLowerCase()
    return items
      .filter((i) => kinds.includes(i.kind))
      .map((i) => ({ i, date: i.recurrence ? nextOccurrence(i, t) ?? i.date : i.date }))
      .filter(({ i, date }) => (f === 'done' ? isDone(i, date) : !isDone(i, date)) && (!ql || i.title.toLowerCase().includes(ql)))
      .sort((a, b) => (f === 'done' ? (a.date > b.date ? -1 : 1) : a.date < b.date ? -1 : 1))
  }, [items, f, q, t])

  const groups = useMemo(() => {
    if (f === 'done') return [{ label: 'Completed', rows }]
    const g: Record<string, typeof rows> = { Overdue: [], Today: [], 'Next 7 days': [], Later: [] }
    for (const r of rows) {
      const n = daysUntil(r.date, t)
      g[n < 0 ? 'Overdue' : n === 0 ? 'Today' : n <= 7 ? 'Next 7 days' : 'Later'].push(r)
    }
    return Object.entries(g).filter(([, v]) => v.length).map(([label, rows]) => ({ label, rows }))
  }, [rows, f, t])

  function addQuick() {
    const title = quick.trim()
    if (!title) return
    const kind: ItemKind = /\b(exam|midterm|final|quiz)\b/i.test(title) ? 'exam' : /\b(essay|assignment|lab|report|due)\b/i.test(title) ? 'assignment' : 'task'
    upsertItem({ id: uid(), kind, title, date: t, createdAt: Date.now(), countdown: kind === 'exam' || undefined })
    setQuick('')
    toast(`${KIND_META[kind].label} added for today — click it to set a date`)
  }

  const tabs: { v: F; l: string }[] = [{ v: 'open', l: 'All open' }, { v: 'assignment', l: '📝 Assignments' }, { v: 'task', l: '☑️ Tasks' }, { v: 'exam', l: '🎯 Exams' }, { v: 'done', l: 'Done' }]

  return (
    <PageShell section="tasks" actions={<button className="btn primary" onClick={() => openEditor({ kind: 'assignment' })}>+ Assignment</button>}>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {tabs.map((x) => <button key={x.v} className={`chip${f === x.v ? '' : ' outline'}`} aria-pressed={f === x.v} onClick={() => setF(x.v)}>{x.l}</button>)}
        <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220, marginLeft: 'auto', height: 30 }} />
      </div>
      <div className="card" style={{ marginBottom: 16, padding: 10 }}>
        <input className="input bare" style={{ height: 36 }} placeholder="＋ Quick add — type and press Enter (words like “exam” or “essay” set the type)" value={quick}
          onChange={(e) => setQuick(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addQuick()} />
      </div>

      {!groups.length && <div className="card"><Empty emoji={f === 'done' ? '🫧' : '🎀'}>{f === 'done' ? 'Nothing completed yet.' : 'Nothing open. Enjoy it.'}</Empty></div>}
      <div className="stack" style={{ gap: 16 }}>
        {groups.map((g) => (
          <section key={g.label} className="card">
            <div className="card-head"><h3>{g.label} <span className="chip outline">{g.rows.length}</span></h3></div>
            {g.rows.map(({ i, date }) => <TaskRow key={i.id} i={i} date={date} course={i.courseId ? byId.get(i.courseId) : undefined} onToggle={() => toggleItem(i.id, date)} />)}
          </section>
        ))}
      </div>
    </PageShell>
  )
}

function TaskRow({ i, date, course, onToggle }: { i: Item; date: string; course?: { accent: string; emoji: string; code?: string; name: string }; onToggle: () => void }) {
  const n = daysUntil(date)
  const done = isDone(i, date)
  const steps = i.steps ?? []
  const sd = steps.filter((s) => s.done).length
  return (
    <div className={`lrow${done ? ' done' : ''}`} style={{ '--accent': course?.accent ?? KIND_ACCENT[i.kind] } as CSSProperties}>
      {i.kind === 'exam' ? <span style={{ width: 20, textAlign: 'center' }}>🎯</span>
        : <input type="checkbox" className="check round" checked={done} onChange={onToggle} aria-label={`Mark ${i.title} done`} />}
      <button className="linkish" onClick={() => openEditor({ id: i.id }, date)}>
        <div className="lrow-title ellipsis">{i.title}</div>
        <div className="tiny muted ellipsis">
          {KIND_META[i.kind].label}{course ? ` · ${course.emoji} ${course.code || course.name}` : ''} · {format(fromISO(date), 'EEE, MMM d')}{i.weight ? ` · ${i.weight}%` : ''}{i.score !== undefined ? ` · scored ${i.score}%` : ''}
        </div>
        {steps.length > 0 && <div style={{ maxWidth: 220, marginTop: 6 }}><Progress value={sd / steps.length} /></div>}
      </button>
      {!done && <span className="chip" style={n < 0 ? { background: 'color-mix(in oklab, var(--danger) 18%, var(--surface))', color: 'var(--danger)' } : undefined}>{countdownLabel(n)}</span>}
    </div>
  )
}
