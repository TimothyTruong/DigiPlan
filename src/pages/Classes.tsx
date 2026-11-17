import { useState, type CSSProperties } from 'react'
import { Link, useLocation } from 'wouter'
import { PageShell } from '../components/PageShell'
import { Empty, IconView, Modal, useBannerCss } from '../components/ui'
import { daysUntil, nextOccurrence, todayISO } from '../lib/dates'
import { summarize } from '../lib/grades'
import { uid } from '../lib/id'
import { useStore } from '../store/store'
import type { Course } from '../store/types'
import { ACCENTS, BANNERS, EMOJI_PRESETS } from '../theme/themes'

export default function Classes() {
  const courses = useStore((s) => s.courses)
  const [adding, setAdding] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const list = courses.filter((c) => !!c.archived === showArchived)
  return (
    <PageShell section="classes" actions={<button className="btn primary" onClick={() => setAdding(true)}>+ New class</button>}>
      {!list.length && <div className="card"><Empty emoji="📚">{showArchived ? 'No archived classes.' : 'Add your first class to keep its notes, links, files and grades together.'}</Empty></div>}
      <div className="grid cols-3">
        {list.map((c) => <CourseCard key={c.id} c={c} />)}
      </div>
      {courses.some((c) => c.archived) && (
        <button className="btn ghost sm" style={{ marginTop: 16 }} onClick={() => setShowArchived(!showArchived)}>{showArchived ? '← Current classes' : 'Show archived'}</button>
      )}
      <NewCourse open={adding} onClose={() => setAdding(false)} />
    </PageShell>
  )
}

function CourseCard({ c }: { c: Course }) {
  const bg = useBannerCss(c.bannerId ?? 'preset:cotton')
  const items = useStore((s) => s.items)
  const t = todayISO()
  const mine = items.filter((i) => i.courseId === c.id)
  const next = mine.filter((i) => i.kind === 'exam' || i.kind === 'assignment')
    .map((i) => ({ i, d: nextOccurrence(i, t) })).filter((x) => x.d && !x.i.done).sort((a, b) => (a.d! < b.d! ? -1 : 1))[0]
  const g = summarize(mine)
  return (
    <Link href={`/classes/${c.id}`} className="course-card" style={{ '--accent': c.accent } as CSSProperties}>
      <div className="cc-cover" style={{ background: bg }} />
      <div className="cc-body">
        <div className="cc-icon"><IconView icon={c.emoji} /></div>
        <h3 style={{ marginTop: 8 }}>{c.name}</h3>
        <div className="small muted">{[c.code, c.room].filter(Boolean).join(' · ') || ' '}</div>
        <div className="row wrap" style={{ marginTop: 10 }}>
          {next && <span className="chip">{next.i.kind === 'exam' ? '🎯' : '📝'} {next.i.title} · {daysUntil(next.d!) === 0 ? 'today' : `${daysUntil(next.d!)}d`}</span>}
          {g.current !== undefined && <span className="chip outline">{g.current.toFixed(0)}% avg</span>}
          <span className="chip outline">{c.notes.length} notes · {c.files.length + c.links.length} resources</span>
        </div>
      </div>
    </Link>
  )
}

function NewCourse({ open, onClose }: { open: boolean; onClose: () => void }) {
  const upsert = useStore((s) => s.upsertCourse)
  const count = useStore((s) => s.courses.length)
  const [, nav] = useLocation()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [emoji, setEmoji] = useState('📓')
  const [accent, setAccent] = useState(ACCENTS[count % ACCENTS.length].hex)
  function create() {
    if (!name.trim()) return
    const keys = Object.keys(BANNERS)
    const c: Course = { id: uid(), name: name.trim(), code: code.trim() || undefined, emoji, accent, bannerId: `preset:${keys[count % keys.length]}`, links: [], files: [], notes: [] }
    upsert(c)
    setName(''); setCode('')
    onClose()
    nav(`/classes/${c.id}`)
  }
  return (
    <Modal open={open} onClose={onClose} title="New class" footer={<><span /><div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={create} disabled={!name.trim()}>Create</button></div></>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="grid cols-2">
          <label className="field"><span>Name</span><input className="input" autoFocus placeholder="Organic Chemistry" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} /></label>
          <label className="field"><span>Code</span><input className="input" placeholder="CHEM 2203" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} /></label>
        </div>
        <div className="field"><span>Colour</span><div className="swatches">{ACCENTS.map((a) => <button key={a.key} className={`swatch${accent === a.hex ? ' on' : ''}`} style={{ background: a.hex }} aria-label={a.name} onClick={() => setAccent(a.hex)} />)}</div></div>
        <div className="field"><span>Icon</span><div className="emoji-grid">{EMOJI_PRESETS.slice(12, 24).map((e) => <button key={e} className={emoji === e ? 'on' : ''} onClick={() => setEmoji(e)}>{e}</button>)}</div></div>
      </div>
    </Modal>
  )
}
