import { useMemo, useState, type CSSProperties } from 'react'
import { useSearch } from 'wouter'
import { addMonths, addWeeks, format } from 'date-fns'
import { EntryRow, openEntry } from '../components/EntryRow'
import { openEditor } from '../components/ItemEditor'
import { PageShell } from '../components/PageShell'
import { Empty, Seg, useMediaQuery } from '../components/ui'
import { groupByDate, useAgenda, type Entry, type EntryKind } from '../lib/agenda'
import { addDaysISO, countdownLabel, daysUntil, fmtTime, fromISO, monthGrid, toISO, todayISO, weekDays } from '../lib/dates'
import { useGoogle } from '../lib/google'
import { useStore } from '../store/store'

type View = 'month' | 'week' | 'list'
const FILTERS: { value: 'all' | EntryKind; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'class', label: 'Classes' }, { value: 'assignment', label: 'Due' },
  { value: 'exam', label: 'Exams' }, { value: 'event', label: 'Events' }, { value: 'workout', label: 'Workouts' }, { value: 'google', label: 'Google' },
]

export default function Calendar() {
  const search = new URLSearchParams(useSearch())
  const t = todayISO()
  const [anchor, setAnchor] = useState(search.get('d') ?? t)
  const view = useStore((s) => s.settings.calendarView)
  const ws = useStore((s) => s.settings.weekStartsOn)
  const setSettings = useStore((s) => s.setSettings)
  const [filter, setFilter] = useState<'all' | EntryKind>('all')
  const [courseFilter, setCourseFilter] = useState('')
  const courses = useStore((s) => s.courses)
  const gStatus = useGoogle((s) => s.status)
  const narrow = useMediaQuery('(max-width: 760px)')
  const [selected, setSelected] = useState(search.get('d') ?? t)
  const [listDays, setListDays] = useState(14)
  const [hideClasses, setHideClasses] = useState(false)

  const range = useMemo(() => {
    if (view === 'month') { const g = monthGrid(anchor, ws); return [g[0], g[41]] as const }
    if (view === 'week') { const w = weekDays(anchor, ws); return [w[0], w[6]] as const }
    return [anchor, addDaysISO(anchor, listDays - 1)] as const
  }, [view, anchor, ws, listDays])
  const all = useAgenda(range[0], range[1])
  const entries = useMemo(() => all.filter((e) =>
    (filter === 'all' ? !(hideClasses && e.kind === 'class') : e.kind === filter || (filter === 'assignment' && e.kind === 'task')) &&
    (!courseFilter || e.course?.id === courseFilter)), [all, filter, courseFilter, hideClasses])
  const byDate = useMemo(() => groupByDate(entries), [entries])

  const step = (dir: number) => setAnchor(toISO(view === 'month' ? addMonths(fromISO(anchor), dir) : view === 'week' ? addWeeks(fromISO(anchor), dir) : fromISO(addDaysISO(anchor, dir * 14))))
  const title = view === 'month' ? format(fromISO(anchor), 'MMMM yyyy')
    : view === 'week' ? `${format(fromISO(range[0]), 'MMM d')} – ${format(fromISO(range[1]), 'MMM d')}`
    : `From ${format(fromISO(anchor), 'MMM d')}`

  return (
    <PageShell section="calendar" actions={<button className="btn primary" onClick={() => openEditor({ date: anchor, kind: 'event' })}>+ New</button>}>
      <div className="cal-toolbar">
        <div className="row">
          <button className="btn icon" onClick={() => step(-1)} aria-label="Previous">‹</button>
          <button className="btn sm" onClick={() => setAnchor(t)}>Today</button>
          <button className="btn icon" onClick={() => step(1)} aria-label="Next">›</button>
        </div>
        <div className="cal-title">{title}</div>
        {gStatus === 'loading' && <span className="tiny muted">Syncing Google…</span>}
        <div className="grow" />
        <Seg<View> value={view} onChange={(v) => setSettings({ calendarView: v })} label="View"
          options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'list', label: 'List' }]} />
      </div>
      <div className="row wrap filter-row" style={{ marginBottom: 14 }}>
        {FILTERS.map((f) => <button key={f.value} className={`chip${filter === f.value ? '' : ' outline'}`} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}</button>)}
        {filter === 'all' && <button className={`chip${hideClasses ? '' : ' outline'}`} aria-pressed={hideClasses} onClick={() => setHideClasses(!hideClasses)}>Hide classes</button>}
        {courses.length > 0 && (
          <select className="select" style={{ width: 'auto', height: 26, fontSize: 12, borderRadius: 99, marginLeft: 'auto' }} value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} aria-label="Filter by class">
            <option value="">All classes</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.code || c.name}</option>)}
          </select>
        )}
      </div>

      {view === 'month' && <MonthView anchor={anchor} ws={ws} byDate={byDate} selected={narrow ? selected : undefined}
        onDay={(d) => (narrow ? setSelected(d) : openEditor({ date: d, kind: 'event' }))} />}
      {view === 'month' && narrow && (
        <section className="card" style={{ marginTop: 12 }}>
          <div className="card-head"><h3>{format(fromISO(selected), 'EEEE, MMM d')}</h3><button className="btn sm primary" onClick={() => openEditor({ date: selected, kind: 'event' })}>+ Add</button></div>
          {(byDate.get(selected) ?? []).map((e) => <EntryRow key={e.key} e={e} />)}
          {!byDate.get(selected)?.length && <Empty emoji="☁️">Nothing on this day.</Empty>}
        </section>
      )}
      {view === 'week' && <WeekView days={weekDays(anchor, ws)} byDate={byDate} />}
      {view === 'list' && <ListView byDate={byDate} />}
      {view === 'list' && <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn" onClick={() => setListDays(listDays + 14)}>Show 2 more weeks</button></div>}
    </PageShell>
  )
}

function MonthView({ anchor, ws, byDate, selected, onDay }: { anchor: string; ws: 0 | 1; byDate: Map<string, Entry[]>; selected?: string; onDay: (d: string) => void }) {
  const t = todayISO()
  const grid = monthGrid(anchor, ws)
  const month = anchor.slice(0, 7)
  const dows = grid.slice(0, 7).map((d) => format(fromISO(d), 'EEE'))
  return (
    <div className="month" role="grid">
      {dows.map((d) => <div key={d} className="dow">{d}</div>)}
      {grid.map((d) => {
        const list = byDate.get(d) ?? []
        return (
          <div key={d} role="gridcell" tabIndex={0} aria-label={format(fromISO(d), 'EEEE MMMM d')}
            className={`day${d.slice(0, 7) !== month ? ' out' : ''}${d === t ? ' today' : ''}${d === selected ? ' sel' : ''}`}
            onClick={() => onDay(d)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget === e.target && onDay(d)}>
            <span className="dnum">{fromISO(d).getDate()}</span>
            {list.slice(0, 3).map((e) => <Chip key={e.key} e={e} />)}
            {list.length > 3 && <span className="more">+{list.length - 3} more</span>}
          </div>
        )
      })}
    </div>
  )
}

function Chip({ e }: { e: Entry }) {
  return (
    <button className={`evt${e.done ? ' done' : ''}${e.kind === 'google' ? ' g' : ''}`} style={{ '--c': e.color } as CSSProperties}
      title={`${e.start ? fmtTime(e.start) + ' ' : ''}${e.title}`} onClick={(ev) => { ev.stopPropagation(); openEntry(e) }}>
      {e.kind === 'exam' ? '🎯 ' : e.kind === 'assignment' ? '📝 ' : ''}{e.start && e.kind !== 'assignment' ? `${fmtTime(e.start)} ` : ''}{e.title}
    </button>
  )
}

function WeekView({ days, byDate }: { days: string[]; byDate: Map<string, Entry[]> }) {
  const t = todayISO()
  return (
    <div className="week">
      {days.map((d) => (
        <div key={d} className={`wcol${d === t ? ' today' : ''}`}>
          <div className="wcol-h" onClick={() => openEditor({ date: d, kind: 'event' })} title="Add on this day">
            <b>{format(fromISO(d), 'd')}</b><span className="small muted">{format(fromISO(d), 'EEE')}</span>
          </div>
          {(byDate.get(d) ?? []).map((e) => (
            <button key={e.key} className="wevt" style={{ '--c': e.color, opacity: e.done ? .55 : 1 } as CSSProperties} onClick={() => openEntry(e)}>
              <div className="tm">{e.start ? fmtTime(e.start) : 'All day'}{e.end ? `–${fmtTime(e.end)}` : ''}</div>
              <div className="tt" style={{ textDecoration: e.done ? 'line-through' : undefined }}>{e.title}</div>
              {e.location && <div className="tm ellipsis">{e.location}</div>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

function ListView({ byDate }: { byDate: Map<string, Entry[]> }) {
  const t = todayISO()
  if (!byDate.size) return <div className="card"><Empty emoji="🗓️">Nothing in this range with these filters.</Empty></div>
  return (
    <div className="card">
      {[...byDate.entries()].map(([d, list]) => {
        const n = daysUntil(d, t)
        return (
          <div key={d} className="agenda-day">
            <div className={`agenda-date${d === t ? ' today' : ''}`}>
              <b>{format(fromISO(d), 'd')}</b>
              <span className="small muted">{format(fromISO(d), 'EEE, MMM')}</span>
              <div className="tiny" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{countdownLabel(n)}</div>
            </div>
            <div>{list.map((e) => <EntryRow key={e.key} e={e} />)}</div>
          </div>
        )
      })}
    </div>
  )
}
