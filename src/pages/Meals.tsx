import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { PageShell } from '../components/PageShell'
import { Empty, Modal, Seg, toast, useBannerCss } from '../components/ui'
import { compressImage, putBlob } from '../lib/blobs'
import { addDaysISO, fromISO, todayISO, weekDays } from '../lib/dates'
import { uid } from '../lib/id'
import { useStore } from '../store/store'
import type { MealSlot, Recipe } from '../store/types'

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
type Tab = 'plan' | 'recipes' | 'grocery'

export default function Meals() {
  const [tab, setTab] = useState<Tab>('plan')
  const [editing, setEditing] = useState<Recipe | null>(null)
  const newRecipe = () => setEditing({ id: uid(), name: '', emoji: '🍽️', ingredients: [], steps: '', tags: [] })
  return (
    <PageShell section="meals" actions={<button className="btn primary" onClick={newRecipe}>+ Recipe</button>}>
      <div style={{ marginBottom: 16 }}>
        <Seg<Tab> value={tab} onChange={setTab} options={[{ value: 'plan', label: 'Week plan' }, { value: 'recipes', label: 'Recipe book' }, { value: 'grocery', label: 'Grocery list' }]} />
      </div>
      {tab === 'plan' && <WeekPlan />}
      {tab === 'recipes' && <RecipeBook onOpen={setEditing} onNew={newRecipe} />}
      {tab === 'grocery' && <Grocery />}
      {editing && <RecipeEditor recipe={editing} onClose={() => setEditing(null)} />}
    </PageShell>
  )
}

function WeekPlan() {
  const ws = useStore((s) => s.settings.weekStartsOn)
  const [anchor, setAnchor] = useState(todayISO())
  const days = weekDays(anchor, ws)
  const plan = useStore((s) => s.mealPlan)
  const recipes = useStore((s) => s.recipes)
  const { setMeal, copyWeek, setGrocery } = useStore.getState()
  const [slot, setSlot] = useState<{ date: string; slot: MealSlot } | null>(null)
  const byId = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes])
  const t = todayISO()

  function weekToGrocery() {
    const g = useStore.getState().grocery
    const have = new Set(g.map((x) => x.text.toLowerCase()))
    const add: typeof g = []
    for (const d of days) for (const s of SLOTS) {
      const r = plan[d]?.[s]?.recipeId ? byId.get(plan[d]![s]!.recipeId!) : undefined
      r?.ingredients.forEach((ing) => { if (!have.has(ing.toLowerCase())) { have.add(ing.toLowerCase()); add.push({ id: uid(), text: ing, done: false, fromRecipe: r.id }) } })
    }
    setGrocery([...g, ...add])
    toast(add.length ? `Added ${add.length} ingredients to the grocery list` : 'Grocery list already has everything')
  }

  return (
    <div className="card">
      <div className="cal-toolbar">
        <button className="btn icon" onClick={() => setAnchor(addDaysISO(anchor, -7))} aria-label="Previous week">‹</button>
        <button className="btn sm" onClick={() => setAnchor(t)}>This week</button>
        <button className="btn icon" onClick={() => setAnchor(addDaysISO(anchor, 7))} aria-label="Next week">›</button>
        <div className="cal-title">{format(fromISO(days[0]), 'MMM d')} – {format(fromISO(days[6]), 'MMM d')}</div>
        <div className="grow" />
        <button className="btn sm" onClick={() => { copyWeek(addDaysISO(days[0], -7), days[0]); toast('Copied last week’s meals') }}>Copy last week</button>
        <button className="btn sm primary" onClick={weekToGrocery}>🛒 Add week to grocery list</button>
      </div>
      <div className="mealweek">
        <div />
        {days.map((d) => <div key={d} className="mh" style={d === t ? { color: 'var(--accent-ink)' } : undefined}>{format(fromISO(d), 'EEE d')}</div>)}
        {SLOTS.map((s) => (
          <Row key={s} label={s}>
            {days.map((d) => {
              const e = plan[d]?.[s]
              const r = e?.recipeId ? byId.get(e.recipeId) : undefined
              const text = r ? `${r.emoji} ${r.name}` : e?.text
              return <button key={d} className={`mslot${text ? ' filled' : ''}`} onClick={() => setSlot({ date: d, slot: s })}>{text ?? <span className="muted">+</span>}</button>
            })}
          </Row>
        ))}
      </div>
      {slot && <SlotPicker {...slot} onClose={() => setSlot(null)} onPick={(e) => { setMeal(slot.date, slot.slot, e); setSlot(null) }} />}
    </div>
  )
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <><div className="mh" style={{ textTransform: 'capitalize', alignSelf: 'center' }}>{label}</div>{children}</>
)

function SlotPicker({ date, slot, onClose, onPick }: { date: string; slot: MealSlot; onClose: () => void; onPick: (e?: { recipeId?: string; text?: string }) => void }) {
  const recipes = useStore((s) => s.recipes)
  const cur = useStore((s) => s.mealPlan[date]?.[slot])
  const [text, setText] = useState(cur?.text ?? '')
  const [q, setQ] = useState('')
  const list = recipes.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.tags.some((t) => t.includes(q.toLowerCase())))
  return (
    <Modal open onClose={onClose} title={`${slot[0].toUpperCase()}${slot.slice(1)} · ${format(fromISO(date), 'EEE, MMM d')}`}
      footer={<><button className="btn ghost danger" onClick={() => onPick(undefined)}>Clear</button><button className="btn" onClick={onClose}>Cancel</button></>}>
      <div className="stack">
        <div className="row">
          <input className="input" placeholder="Type anything (e.g. “Dining hall”)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && onPick({ text: text.trim() })} />
          <button className="btn primary" disabled={!text.trim()} onClick={() => onPick({ text: text.trim() })}>Set</button>
        </div>
        {recipes.length > 0 && <>
          <div className="nav-label" style={{ padding: '6px 0 0' }}>Or pick a recipe</div>
          {recipes.length > 6 && <input className="input" placeholder="Search recipes or tags" value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="stack" style={{ gap: 2, maxHeight: 300, overflowY: 'auto' }}>
            {list.map((r) => (
              <button key={r.id} className="lrow" style={{ border: 0, background: cur?.recipeId === r.id ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', textAlign: 'left' }} onClick={() => onPick({ recipeId: r.id })}>
                <span style={{ fontSize: 20 }}>{r.emoji}</span><span className="grow lrow-title">{r.name}</span><span className="tiny muted">{r.tags.join(', ')}</span>
              </button>
            ))}
          </div>
        </>}
      </div>
    </Modal>
  )
}

function RecipeBook({ onOpen, onNew }: { onOpen: (r: Recipe) => void; onNew: () => void }) {
  const recipes = useStore((s) => s.recipes)
  const [tag, setTag] = useState('')
  const tags = useMemo(() => [...new Set(recipes.flatMap((r) => r.tags))].sort(), [recipes])
  const list = recipes.filter((r) => !tag || (tag === '★' ? r.favorite : r.tags.includes(tag)))
  if (!recipes.length) return <div className="card"><Empty emoji="📖">Your recipe book is empty. <button className="btn sm" onClick={onNew}>Add a recipe</button></Empty></div>
  return (
    <>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {['', '★', ...tags].map((t) => <button key={t} className={`chip${tag === t ? '' : ' outline'}`} onClick={() => setTag(t)}>{t === '' ? 'All' : t === '★' ? '★ Favourites' : t}</button>)}
      </div>
      <div className="grid cols-3">{list.map((r) => <RecipeCard key={r.id} r={r} onOpen={() => onOpen(r)} />)}</div>
    </>
  )
}

function RecipeCard({ r, onOpen }: { r: Recipe; onOpen: () => void }) {
  const img = useBannerCss(r.imageId)
  return (
    <button className="recipe-card" onClick={onOpen}>
      <div className="rc-img" style={img ? { background: img } : undefined}>{!r.imageId && r.emoji}</div>
      <div style={{ padding: 12 }}>
        <div className="row between"><h3 className="ellipsis">{r.name}</h3>{r.favorite && <span>★</span>}</div>
        <div className="tiny muted">{[r.prepMins && `${r.prepMins} min`, r.servings && `serves ${r.servings}`, `${r.ingredients.length} ingredients`].filter(Boolean).join(' · ')}</div>
      </div>
    </button>
  )
}

function RecipeEditor({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const exists = useStore((s) => s.recipes.some((r) => r.id === recipe.id))
  const { upsertRecipe, deleteRecipe, setGrocery } = useStore.getState()
  const [r, setR] = useState(recipe)
  const [ing, setIng] = useState(recipe.ingredients.join('\n'))
  const [tags, setTags] = useState(recipe.tags.join(', '))
  const set = (p: Partial<Recipe>) => setR({ ...r, ...p })
  const final = (): Recipe => ({ ...r, name: r.name.trim() || 'Untitled recipe', ingredients: ing.split('\n').map((x) => x.trim()).filter(Boolean), tags: tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) })
  async function photo(f?: File) { if (!f) return; const id = await putBlob(await compressImage(f, 1000)); set({ imageId: id }) }
  function toGrocery() {
    const fr = final()
    const g = useStore.getState().grocery
    const have = new Set(g.map((x) => x.text.toLowerCase()))
    const add = fr.ingredients.filter((i) => !have.has(i.toLowerCase())).map((text) => ({ id: uid(), text, done: false, fromRecipe: fr.id }))
    setGrocery([...g, ...add])
    toast(`Added ${add.length} to grocery list`)
  }
  return (
    <Modal open onClose={onClose} wide title={exists ? 'Recipe' : 'New recipe'} footer={<>
      <div className="row">{exists && <button className="btn ghost danger" onClick={() => { deleteRecipe(r.id); onClose() }}>Delete</button>}<button className="btn ghost" onClick={toGrocery}>🛒 Ingredients → grocery list</button></div>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => { upsertRecipe(final()); onClose() }}>Save</button></div>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row">
          <input className="input" style={{ width: 56, textAlign: 'center', fontSize: 22, height: 44 }} value={r.emoji} maxLength={4} onChange={(e) => set({ emoji: e.target.value })} aria-label="Emoji" />
          <input className="input" style={{ height: 44, fontSize: 18, fontWeight: 600 }} autoFocus placeholder="Recipe name" value={r.name} onChange={(e) => set({ name: e.target.value })} />
          <button className={`btn icon${r.favorite ? ' primary' : ''}`} aria-pressed={!!r.favorite} aria-label="Favourite" onClick={() => set({ favorite: !r.favorite })}>★</button>
        </div>
        <div className="grid cols-3">
          <label className="field"><span>Prep (min)</span><input type="number" className="input" value={r.prepMins ?? ''} onChange={(e) => set({ prepMins: e.target.value ? Number(e.target.value) : undefined })} /></label>
          <label className="field"><span>Servings</span><input type="number" className="input" value={r.servings ?? ''} onChange={(e) => set({ servings: e.target.value ? Number(e.target.value) : undefined })} /></label>
          <label className="field"><span>Tags</span><input className="input" placeholder="dinner, meal prep" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        </div>
        <div className="grid cols-2">
          <label className="field"><span>Ingredients (one per line)</span><textarea className="textarea" rows={8} value={ing} onChange={(e) => setIng(e.target.value)} /></label>
          <label className="field"><span>Method</span><textarea className="textarea" rows={8} value={r.steps} onChange={(e) => set({ steps: e.target.value })} /></label>
        </div>
        <label className="btn" style={{ alignSelf: 'flex-start' }}>{r.imageId ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => photo(e.target.files?.[0])} /></label>
      </div>
    </Modal>
  )
}

function Grocery() {
  const grocery = useStore((s) => s.grocery)
  const recipes = useStore((s) => s.recipes)
  const setGrocery = useStore((s) => s.setGrocery)
  const [text, setText] = useState('')
  const add = () => { const v = text.trim(); if (!v) return; setGrocery([...grocery, { id: uid(), text: v, done: false }]); setText('') }
  const open = grocery.filter((g) => !g.done), done = grocery.filter((g) => g.done)
  const rname = (id?: string) => recipes.find((r) => r.id === id)?.name
  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <input className="input" placeholder="Add an item and press Enter" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn" onClick={add}>Add</button>
      </div>
      {!grocery.length && <Empty emoji="🛒">List is empty. Send ingredients here from a recipe or the week plan.</Empty>}
      {[...open, ...done].map((g) => (
        <div key={g.id} className={`lrow${g.done ? ' done' : ''}`}>
          <input type="checkbox" className="check round" checked={g.done} onChange={() => setGrocery(grocery.map((x) => x.id === g.id ? { ...x, done: !x.done } : x))} aria-label={g.text} />
          <span className="grow lrow-title">{g.text}</span>
          {g.fromRecipe && <span className="tiny muted ellipsis" style={{ maxWidth: 160 }}>{rname(g.fromRecipe)}</span>}
          <button className="btn ghost icon sm" aria-label={`Remove ${g.text}`} onClick={() => setGrocery(grocery.filter((x) => x.id !== g.id))}>✕</button>
        </div>
      ))}
      {done.length > 0 && <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setGrocery(open)}>Clear {done.length} checked</button>}
    </div>
  )
}
