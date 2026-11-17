import { useMemo, useState, type CSSProperties } from 'react'
import { Link, useLocation } from 'wouter'
import { format } from 'date-fns'
import { EntryRow } from '../components/EntryRow'
import { openEditor } from '../components/ItemEditor'
import { StylePicker } from '../components/StylePicker'
import { Empty, IconView, Modal, Seg, toast, useBannerCss } from '../components/ui'
import { useAgenda } from '../lib/agenda'
import { blobUrl, deleteBlob, putBlob } from '../lib/blobs'
import { addDaysISO, fromISO, todayISO } from '../lib/dates'
import { letter, summarize } from '../lib/grades'
import { uid } from '../lib/id'
import { renderMarkdown, toggleTaskLine } from '../lib/markdown'
import { useStore } from '../store/store'
import type { Course, Note } from '../store/types'

type Tab = 'notes' | 'resources' | 'grades' | 'schedule'
const MAX_FILE = 50 * 1024 * 1024

export default function ClassDetail({ id }: { id: string }) {
  const c = useStore((s) => s.courses.find((x) => x.id === id))
  const [tab, setTab] = useState<Tab>('notes')
  const [picker, setPicker] = useState<null | 'color' | 'banner' | 'icon'>(null)
  const [editing, setEditing] = useState(false)
  const upsert = useStore((s) => s.upsertCourse)
  const bg = useBannerCss(c?.bannerId ?? 'preset:cotton')
  if (!c) return <div className="page" style={{ paddingTop: 80 }}><h1>Class not found</h1><Link href="/classes">Back to classes</Link></div>
  const update = (p: Partial<Course>) => upsert({ ...c, ...p })

  return (
    <div style={{ '--accent': c.accent } as CSSProperties}>
      <div className={`cover${bg ? '' : ' none'}`} style={bg ? { background: bg } : undefined}>
        <div className="cover-actions">
          <button className="btn sm glass" onClick={() => setPicker('banner')}>Change cover</button>
          <button className="btn sm glass" onClick={() => setPicker('color')}>Colour</button>
        </div>
      </div>
      <div className="page">
        <header className="page-head">
          <button className="page-icon" onClick={() => setPicker('icon')} aria-label="Change class icon"><IconView icon={c.emoji} /></button>
          <div className="page-title-row">
            <div>
              <div className="small"><Link href="/classes">← Classes</Link></div>
              <h1>{c.name}</h1>
              <div className="page-sub">{[c.code, c.instructor, c.room].filter(Boolean).join(' · ') || 'Add details in Edit'}</div>
            </div>
            <div className="row"><button className="btn" onClick={() => setEditing(true)}>Edit</button></div>
          </div>
        </header>
        <div style={{ marginBottom: 16 }}>
          <Seg<Tab> value={tab} onChange={setTab} label="Section" options={[
            { value: 'notes', label: `Notes (${c.notes.length})` }, { value: 'resources', label: `Links & files (${c.links.length + c.files.length})` },
            { value: 'grades', label: 'Grades' }, { value: 'schedule', label: 'Schedule' },
          ]} />
        </div>
        {tab === 'notes' && <Notes c={c} update={update} />}
        {tab === 'resources' && <Resources c={c} update={update} />}
        {tab === 'grades' && <Grades c={c} update={update} />}
        {tab === 'schedule' && <Schedule c={c} />}
      </div>
      {picker && <StylePicker open initialTab={picker} onClose={() => setPicker(null)} title={`Customize ${c.name}`}
        value={{ accent: c.accent, banner: c.bannerId, icon: c.emoji }}
        onChange={(v) => update({ ...(v.accent && { accent: v.accent }), ...(v.banner && { bannerId: v.banner }), ...(v.icon && { emoji: v.icon }) })} />}
      <EditCourse key={String(editing)} c={c} open={editing} onClose={() => setEditing(false)} />
    </div>
  )
}

function Notes({ c, update }: { c: Course; update: (p: Partial<Course>) => void }) {
  const [sel, setSel] = useState<string | undefined>(c.notes[0]?.id)
  const [mode, setMode] = useState<'edit' | 'view'>('view')
  const note = c.notes.find((n) => n.id === sel) ?? c.notes[0]
  const setNote = (p: Partial<Note>) => note && update({ notes: c.notes.map((n) => (n.id === note.id ? { ...n, ...p, updatedAt: Date.now() } : n)) })
  function add() {
    const n: Note = { id: uid(), title: `Lecture ${c.notes.length + 1}`, body: '', updatedAt: Date.now() }
    update({ notes: [n, ...c.notes] })
    setSel(n.id); setMode('edit')
  }
  function remove() {
    if (!note || !confirm(`Delete “${note.title}”?`)) return
    update({ notes: c.notes.filter((n) => n.id !== note.id) })
    setSel(undefined)
  }
  return (
    <div className="card">
      <div className="notes-layout">
        <div className="stack" style={{ gap: 2 }}>
          <button className="btn sm" style={{ marginBottom: 8 }} onClick={add}>+ New note</button>
          {c.notes.map((n) => (
            <button key={n.id} className={`note-tab${note?.id === n.id ? ' on' : ''}`} onClick={() => { setSel(n.id); setMode(n.body ? 'view' : 'edit') }}>
              <div className="ellipsis">{n.title || 'Untitled'}</div>
              <div className="tiny muted">{format(n.updatedAt, 'MMM d')}</div>
            </button>
          ))}
        </div>
        <div style={{ minWidth: 0 }}>
          {!note ? <Empty emoji="📝">No notes yet. Markdown works: # headings, - lists, - [ ] checkboxes, **bold**.</Empty> : (
            <>
              <div className="row" style={{ marginBottom: 10 }}>
                <input className="input bare grow" style={{ fontFamily: 'var(--font-display)', fontSize: 22, height: 40 }} value={note.title} onChange={(e) => setNote({ title: e.target.value })} aria-label="Note title" />
                <Seg value={mode} onChange={setMode} options={[{ value: 'view', label: 'Read' }, { value: 'edit', label: 'Edit' }]} />
                <button className="btn ghost icon" onClick={remove} aria-label="Delete note">🗑</button>
              </div>
              {mode === 'edit'
                ? <textarea className="textarea" style={{ minHeight: 360, fontSize: 14.5 }} autoFocus value={note.body} placeholder="Start typing… (markdown supported)" onChange={(e) => setNote({ body: e.target.value })} />
                : <div className="md" style={{ minHeight: 200, cursor: 'text' }}
                    onDoubleClick={() => setMode('edit')}
                    onClick={(e) => {
                      const el = e.target as HTMLInputElement
                      if (el.tagName === 'INPUT' && el.dataset.line) setNote({ body: toggleTaskLine(note.body, Number(el.dataset.line)) })
                    }}
                    dangerouslySetInnerHTML={{ __html: note.body ? renderMarkdown(note.body) : '<p class="muted">Empty — double-click or press Edit to write.</p>' }} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Resources({ c, update }: { c: Course; update: (p: Partial<Course>) => void }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [over, setOver] = useState(false)
  function addLink() {
    let u = url.trim()
    if (!u) return
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`
    try { new URL(u) } catch { toast('That doesn’t look like a link'); return }
    update({ links: [...c.links, { id: uid(), title: title.trim() || new URL(u).hostname.replace(/^www\./, ''), url: u }] })
    setTitle(''); setUrl('')
  }
  async function addFiles(files: FileList | null) {
    if (!files?.length) return
    const added = []
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE) { toast(`${f.name} is over 50 MB`); continue }
      const id = await putBlob(f)
      added.push({ id, name: f.name, size: f.size, type: f.type, addedAt: Date.now() })
    }
    const fresh = useStore.getState().courses.find((x) => x.id === c.id)
    if (fresh) useStore.getState().upsertCourse({ ...fresh, files: [...fresh.files, ...added] })
    if (added.length) toast(`${added.length} file${added.length > 1 ? 's' : ''} saved on this device`)
  }
  async function open(id: string) { const u = await blobUrl(id); if (u) window.open(u, '_blank', 'noopener') }
  async function removeFile(id: string) { await deleteBlob(id); update({ files: c.files.filter((f) => f.id !== id) }) }
  const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`)

  return (
    <div className="grid cols-2">
      <section className="card">
        <div className="card-head"><h3>🔗 Links</h3></div>
        {c.links.map((l) => (
          <div key={l.id} className="lrow">
            <span>🔗</span>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="grow ellipsis" style={{ fontWeight: 550 }}>{l.title}</a>
            <span className="tiny muted ellipsis" style={{ maxWidth: 140 }}>{new URL(l.url).hostname}</span>
            <button className="btn ghost icon sm" aria-label={`Remove ${l.title}`} onClick={() => update({ links: c.links.filter((x) => x.id !== l.id) })}>✕</button>
          </div>
        ))}
        {!c.links.length && <Empty emoji="🔗">Course page, Zoom, readings, the shared doc…</Empty>}
        <div className="stack" style={{ marginTop: 10, gap: 6 }}>
          <input className="input" placeholder="Paste a link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLink()} />
          <div className="row"><input className="input" placeholder="Label (optional)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLink()} /><button className="btn" onClick={addLink}>Add</button></div>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h3>📎 Files</h3></div>
        {c.files.map((f) => (
          <div key={f.id} className="lrow">
            <span>{f.type.includes('pdf') ? '📕' : f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
            <button className="linkish ellipsis" style={{ fontWeight: 550 }} onClick={() => open(f.id)}>{f.name}</button>
            <span className="tiny muted">{size(f.size)}</span>
            <button className="btn ghost icon sm" aria-label={`Delete ${f.name}`} onClick={() => removeFile(f.id)}>✕</button>
          </div>
        ))}
        <label className={`drop${over ? ' over' : ''}`} style={{ marginTop: 10, display: 'block' }}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files) }}>
          Drop slides, PDFs or images here, or click to choose
          <input type="file" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
        </label>
        <div className="tiny muted" style={{ marginTop: 6 }}>Files are stored privately in this browser (up to 50 MB each).</div>
      </section>
    </div>
  )
}

function Grades({ c, update }: { c: Course; update: (p: Partial<Course>) => void }) {
  const items = useStore((s) => s.items)
  const upsertItem = useStore((s) => s.upsertItem)
  const graded = useMemo(() => items.filter((i) => i.courseId === c.id && (i.kind === 'assignment' || i.kind === 'exam')).sort((a, b) => (a.date < b.date ? -1 : 1)), [items, c.id])
  const s = summarize(graded, c.targetGrade)
  return (
    <div className="grid dash">
      <section className="card">
        <div className="card-head"><h3>Assessments</h3><button className="btn sm" onClick={() => openEditor({ kind: 'assignment', courseId: c.id, weight: 10 })}>+ Add</button></div>
        {!graded.length && <Empty emoji="🧮">Add assignments and exams with a weight to track your grade.</Empty>}
        {graded.map((i) => (
          <div key={i.id} className="lrow">
            <span>{i.kind === 'exam' ? '🎯' : '📝'}</span>
            <button className="linkish" onClick={() => openEditor({ id: i.id })}>
              <div className="lrow-title ellipsis">{i.title}</div>
              <div className="tiny muted">{format(fromISO(i.date), 'MMM d')} · {i.weight ?? 0}% of grade</div>
            </button>
            <input type="number" className="input" style={{ width: 84 }} placeholder="Score %" aria-label={`Score for ${i.title}`} value={i.score ?? ''}
              onChange={(e) => upsertItem({ ...i, score: e.target.value === '' ? undefined : Number(e.target.value), done: e.target.value === '' ? i.done : true })} />
          </div>
        ))}
        {s.totalWeight > 0 && s.totalWeight !== 100 && <div className="tiny muted" style={{ marginTop: 8 }}>Weights add up to {s.totalWeight}%{s.totalWeight < 100 ? ' — add the rest so the projection is accurate.' : '.'}</div>}
      </section>
      <section className="card stack" style={{ gap: 14 }}>
        <div className="grid cols-2">
          <div className="stat"><div className="l">Current average</div><div className="v">{s.current !== undefined ? `${s.current.toFixed(1)}%` : '—'}</div><div className="small muted">{letter(s.current)}</div></div>
          <div className="stat"><div className="l">Banked so far</div><div className="v">{s.earned.toFixed(1)}</div><div className="small muted">of {s.gradedWeight}% marked</div></div>
        </div>
        <label className="field"><span>Target grade (%)</span>
          <input type="number" className="input" value={c.targetGrade ?? ''} placeholder="e.g. 80" onChange={(e) => update({ targetGrade: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        {s.needed !== undefined && (
          <div className="stat" style={{ background: 'var(--accent-soft)' }}>
            <div className="l">You need on the remaining {(Math.max(s.totalWeight, 100) - s.gradedWeight).toFixed(0)}%</div>
            <div className="v">{s.needed <= 0 ? 'Already there 🎉' : s.needed > 100 ? `${s.needed.toFixed(0)}% 😬` : `${s.needed.toFixed(1)}%`}</div>
            <div className="small muted">{s.needed > 100 ? 'Not reachable on paper — talk to your prof about options.' : 'average across everything not marked yet'}</div>
          </div>
        )}
      </section>
    </div>
  )
}

function Schedule({ c }: { c: Course }) {
  const t = todayISO()
  const entries = useAgenda(t, addDaysISO(t, 30)).filter((e) => e.course?.id === c.id)
  return (
    <section className="card">
      <div className="card-head"><h3>Next 30 days</h3>
        <div className="row">
          <button className="btn sm" onClick={() => openEditor({ kind: 'class', courseId: c.id, title: `${c.code || c.name} lecture`, start: '10:00', end: '11:00', recurrence: { freq: 'weekly' }, location: c.room })}>+ Class time</button>
          <button className="btn sm" onClick={() => openEditor({ kind: 'exam', courseId: c.id, countdown: true })}>+ Exam</button>
        </div>
      </div>
      {entries.length ? entries.map((e) => <EntryRow key={e.key} e={e} showDate={format(fromISO(e.date), 'EEE d')} />) : <Empty emoji="🗓️">Nothing scheduled for this class.</Empty>}
    </section>
  )
}

function EditCourse({ c, open, onClose }: { c: Course; open: boolean; onClose: () => void }) {
  const { upsertCourse, deleteCourse } = useStore.getState()
  const [, nav] = useLocation()
  const [d, setD] = useState(c)
  if (!open) return null
  const f = (k: keyof Course) => ({ value: (d[k] as string) ?? '', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value || undefined }) })
  return (
    <Modal open onClose={onClose} title="Class details" footer={<>
      <div className="row">
        <button className="btn ghost danger" onClick={() => { if (confirm(`Delete ${c.name}? Its notes and files go too; calendar items stay.`)) { c.files.forEach((x) => deleteBlob(x.id)); deleteCourse(c.id); nav('/classes') } }}>Delete</button>
        <button className="btn ghost" onClick={() => { upsertCourse({ ...c, archived: !c.archived }); onClose(); toast(c.archived ? 'Restored' : 'Archived') }}>{c.archived ? 'Unarchive' : 'Archive'}</button>
      </div>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { upsertCourse({ ...c, ...d, name: d.name.trim() || c.name, notes: c.notes, files: c.files, links: c.links }); onClose() }}>Save</button></div>
    </>}>
      <div className="grid cols-2">
        <label className="field"><span>Name</span><input className="input" {...f('name')} /></label>
        <label className="field"><span>Code</span><input className="input" {...f('code')} /></label>
        <label className="field"><span>Instructor</span><input className="input" {...f('instructor')} /></label>
        <label className="field"><span>Room</span><input className="input" {...f('room')} /></label>
      </div>
    </Modal>
  )
}
