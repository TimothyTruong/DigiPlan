import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { PageShell } from '../components/PageShell'
import { Empty, Modal, Seg, toast } from '../components/ui'
import { compressImage, putBlob, useBlobUrl } from '../lib/blobs'
import { addDaysISO, fromISO, todayISO, weekDays } from '../lib/dates'
import { uid } from '../lib/id'
import {
  byCategory, categories, lookup, randomIdeas, safeUrl, searchByIngredient, searchByName, thumbSmall, toRecipe,
  type MealDbMeal, type MealIdea,
} from '../lib/mealdb'
import { useStore } from '../store/store'
import type { MealSlot, Recipe } from '../store/types'

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
type Tab = 'recipes' | 'discover' | 'plan' | 'grocery'
type Sort = 'recent' | 'az' | 'rating' | 'quick'

const host = (u?: string) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : '' } catch { return '' } }
const blankRecipe = (): Recipe => ({ id: uid(), name: '', emoji: '🍽️', ingredients: [], steps: '', tags: [], addedAt: Date.now() })

export default function Meals() {
  const [tab, setTab] = useState<Tab>('recipes')
  const [viewing, setViewing] = useState<string | null>(null)
  const [editing, setEditing] = useState<Recipe | null>(null)
  return (
    <PageShell section="meals" actions={<button className="btn primary" onClick={() => setEditing(blankRecipe())}>+ Add recipe</button>}>
      <div style={{ marginBottom: 16 }}>
        <Seg<Tab> value={tab} onChange={setTab} options={[
          { value: 'recipes', label: '📖 My recipes' }, { value: 'discover', label: '✨ Discover ideas' },
          { value: 'plan', label: 'Week plan' }, { value: 'grocery', label: 'Grocery list' },
        ]} />
      </div>
      {tab === 'recipes' && <RecipeBook onOpen={setViewing} onNew={() => setEditing(blankRecipe())} onDiscover={() => setTab('discover')} />}
      {tab === 'discover' && <Discover onOpenSaved={setViewing} />}
      {tab === 'plan' && <WeekPlan onOpen={setViewing} />}
      {tab === 'grocery' && <Grocery />}
      {viewing && <RecipeView id={viewing} onClose={() => setViewing(null)} onEdit={(r) => { setViewing(null); setEditing(r) }} />}
      {editing && <RecipeEditor recipe={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); setViewing(id) }} />}
    </PageShell>
  )
}

/* ---------------- shared bits ---------------- */

function RecipeImage({ r, small, height = 120 }: { r: Pick<Recipe, 'imageId' | 'imageUrl' | 'emoji' | 'name'>; small?: boolean; height?: number }) {
  const blob = useBlobUrl(r.imageId)
  const [broken, setBroken] = useState(false)
  const src = blob ?? (r.imageUrl ? (small ? thumbSmall(r.imageUrl) : r.imageUrl) : undefined)
  return (
    <div className="rc-img" style={{ height }}>
      {src && !broken
        ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <span>{r.emoji}</span>}
    </div>
  )
}

function Stars({ value, onChange, size = 16 }: { value?: number; onChange?: (n?: number) => void; size?: number }) {
  return (
    <span className="row" style={{ gap: 1 }} aria-label={value ? `${value} of 5 stars` : 'Not rated'}>
      {[1, 2, 3, 4, 5].map((n) => onChange
        ? <button key={n} className="btn ghost" style={{ height: size + 10, padding: '0 2px', fontSize: size, color: n <= (value ?? 0) ? '#E8B04B' : 'var(--faint)' }}
            aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(value === n ? undefined : n)}>★</button>
        : <span key={n} style={{ fontSize: size, color: n <= (value ?? 0) ? '#E8B04B' : 'var(--border-strong)' }}>★</span>)}
    </span>
  )
}

function addToGrocery(r: Recipe) {
  const { grocery, setGrocery } = useStore.getState()
  const have = new Set(grocery.filter((g) => !g.done).map((x) => x.text.toLowerCase()))
  const add = r.ingredients.filter((i) => !have.has(i.toLowerCase())).map((text) => ({ id: uid(), text, done: false, fromRecipe: r.id }))
  setGrocery([...grocery, ...add])
  toast(add.length ? `Added ${add.length} ingredient${add.length > 1 ? 's' : ''} to the grocery list` : 'Already on your grocery list')
}

/* ---------------- My recipes ---------------- */

function RecipeBook({ onOpen, onNew, onDiscover }: { onOpen: (id: string) => void; onNew: () => void; onDiscover: () => void }) {
  const recipes = useStore((s) => s.recipes)
  const upsert = useStore((s) => s.upsertRecipe)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const tags = useMemo(() => {
    const count = new Map<string, number>()
    for (const r of recipes) for (const t of r.tags) count.set(t, (count.get(t) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t)
  }, [recipes])
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    const out = recipes.filter((r) =>
      (!tag || (tag === '★' ? r.favorite : r.tags.includes(tag))) &&
      (!ql || r.name.toLowerCase().includes(ql) || r.tags.some((t) => t.includes(ql)) || r.ingredients.some((i) => i.toLowerCase().includes(ql)) || r.cuisine?.toLowerCase().includes(ql)))
    const by: Record<Sort, (a: Recipe, b: Recipe) => number> = {
      recent: (a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0),
      az: (a, b) => a.name.localeCompare(b.name),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || Number(!!b.favorite) - Number(!!a.favorite),
      quick: (a, b) => (a.prepMins ?? 999) - (b.prepMins ?? 999),
    }
    return out.sort(by[sort])
  }, [recipes, q, tag, sort])

  if (!recipes.length) return (
    <div className="card"><Empty emoji="📖">Your recipe base is empty.
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="btn" onClick={onNew}>Add your own</button><button className="btn primary" onClick={onDiscover}>✨ Find ideas</button></div>
    </Empty></div>
  )
  return (
    <>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search name, ingredient, tag…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search recipes" />
        <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="recent">Recently added</option><option value="az">A–Z</option><option value="rating">Top rated</option><option value="quick">Quickest</option>
        </select>
        <span className="small muted" style={{ marginLeft: 'auto' }}>{list.length} of {recipes.length}</span>
      </div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        {['', '★', ...tags].map((t) => <button key={t} className={`chip${tag === t ? '' : ' outline'}`} aria-pressed={tag === t} onClick={() => setTag(t)}>{t === '' ? 'All' : t === '★' ? '♥ Favourites' : t}</button>)}
      </div>
      {!list.length && <div className="card"><Empty emoji="🔍">No recipes match.</Empty></div>}
      <div className="grid cols-3">
        {list.map((r) => (
          <div key={r.id} className="recipe-card" role="button" tabIndex={0} onClick={() => onOpen(r.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}>
            <div style={{ position: 'relative' }}>
              <RecipeImage r={r} small />
              <button className="btn icon glass fav" aria-pressed={!!r.favorite} aria-label={r.favorite ? 'Unfavourite' : 'Favourite'}
                onClick={(e) => { e.stopPropagation(); upsert({ ...r, favorite: !r.favorite }) }}>{r.favorite ? '♥' : '♡'}</button>
            </div>
            <div style={{ padding: 12 }}>
              <h3 className="ellipsis">{r.name}</h3>
              <div className="row between" style={{ marginTop: 4 }}>
                <span className="tiny muted ellipsis">{[r.prepMins && `${r.prepMins} min`, r.cuisine, host(r.sourceUrl)].filter(Boolean).join(' · ') || `${r.ingredients.length} ingredients`}</span>
                {r.rating ? <Stars value={r.rating} size={12} /> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function RecipeView({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (r: Recipe) => void }) {
  const r = useStore((s) => s.recipes.find((x) => x.id === id))
  const { upsertRecipe, deleteRecipe, setMeal } = useStore.getState()
  const [date, setDate] = useState(todayISO())
  const [slot, setSlot] = useState<MealSlot>('dinner')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  if (!r) return null
  const remove = () => {
    deleteRecipe(r.id); onClose()
    toast('Recipe deleted', { label: 'Undo', run: () => upsertRecipe(r) })
  }
  return (
    <Modal open onClose={onClose} wide title={<span className="row" style={{ gap: 10 }}>{r.name}<button className="btn ghost icon" aria-label="Favourite" aria-pressed={!!r.favorite} onClick={() => upsertRecipe({ ...r, favorite: !r.favorite })} style={{ color: 'var(--accent-ink)' }}>{r.favorite ? '♥' : '♡'}</button></span>}
      footer={<>
        <button className="btn ghost danger" onClick={remove}>Delete</button>
        <div className="row"><button className="btn" onClick={() => addToGrocery(r)}>🛒 To grocery list</button><button className="btn primary" onClick={() => onEdit(r)}>Edit</button></div>
      </>}>
      <div className="stack" style={{ gap: 16 }}>
        {(r.imageId || r.imageUrl) && <div style={{ borderRadius: 'var(--r-lg)', overflow: 'hidden' }}><RecipeImage r={r} height={240} /></div>}
        <div className="row wrap" style={{ gap: 12 }}>
          <Stars value={r.rating} onChange={(rating) => upsertRecipe({ ...r, rating })} />
          {r.prepMins && <span className="chip outline">⏱ {r.prepMins} min</span>}
          {r.servings && <span className="chip outline">🍽 serves {r.servings}</span>}
          {r.cuisine && <span className="chip outline">{r.cuisine}</span>}
          {r.tags.map((t) => <span key={t} className="chip">{t}</span>)}
        </div>
        {(r.sourceUrl || r.videoUrl) && (
          <div className="row wrap">
            {r.sourceUrl && <a className="btn sm" href={r.sourceUrl} target="_blank" rel="noopener noreferrer">🔗 {host(r.sourceUrl) || 'Original recipe'}</a>}
            {r.videoUrl && <a className="btn sm" href={r.videoUrl} target="_blank" rel="noopener noreferrer">▶ Watch video</a>}
          </div>
        )}
        <div className="grid cols-2" style={{ alignItems: 'start' }}>
          <div>
            <h3 style={{ marginBottom: 8 }}>Ingredients</h3>
            {r.ingredients.length ? r.ingredients.map((ing, i) => (
              <label key={i} className={`lrow${checked.has(i) ? ' done' : ''}`} style={{ padding: '4px 6px' }}>
                <input type="checkbox" className="check round" checked={checked.has(i)} onChange={() => { const n = new Set(checked); n.has(i) ? n.delete(i) : n.add(i); setChecked(n) }} />
                <span className="lrow-title" style={{ fontWeight: 500 }}>{ing}</span>
              </label>
            )) : <div className="muted small">No ingredients listed.</div>}
          </div>
          <div>
            <h3 style={{ marginBottom: 8 }}>Method</h3>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65 }}>{r.steps || <span className="muted small">No method yet.</span>}</div>
          </div>
        </div>
        {r.notes && <div className="md"><blockquote style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</blockquote></div>}
        <div className="card" style={{ padding: 12, boxShadow: 'none', background: 'var(--accent-softer)' }}>
          <div className="row wrap">
            <b className="small">Plan it:</b>
            <input type="date" className="input" style={{ width: 160 }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
            <select className="select" style={{ width: 130 }} value={slot} onChange={(e) => setSlot(e.target.value as MealSlot)} aria-label="Meal">{SLOTS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select>
            <button className="btn sm primary" onClick={() => { setMeal(date, slot, { recipeId: r.id }); toast(`Planned for ${slot}, ${format(fromISO(date), 'EEE MMM d')}`) }}>Add to week plan</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function RecipeEditor({ recipe, onClose, onSaved }: { recipe: Recipe; onClose: () => void; onSaved: (id: string) => void }) {
  const exists = useStore((s) => s.recipes.some((r) => r.id === recipe.id))
  const upsertRecipe = useStore((s) => s.upsertRecipe)
  const [r, setR] = useState(recipe)
  const [ing, setIng] = useState(recipe.ingredients.join('\n'))
  const [tags, setTags] = useState(recipe.tags.join(', '))
  const set = (p: Partial<Recipe>) => setR({ ...r, ...p })
  async function photo(f?: File) {
    if (!f) return
    if (!f.type.startsWith('image/')) { toast('Please choose an image'); return }
    set({ imageId: await putBlob(await compressImage(f, 1200)) })
  }
  function save() {
    if (!r.name.trim()) { toast('Give it a name'); return }
    const sourceUrl = r.sourceUrl?.trim() ? safeUrl(/^https?:\/\//i.test(r.sourceUrl.trim()) ? r.sourceUrl : `https://${r.sourceUrl.trim()}`) : undefined
    if (r.sourceUrl?.trim() && !sourceUrl) { toast('That link doesn’t look right'); return }
    const imageUrl = r.imageUrl?.trim() ? safeUrl(r.imageUrl) : undefined
    if (r.imageUrl?.trim() && !imageUrl) { toast('Image link must start with https://'); return }
    upsertRecipe({
      ...r, name: r.name.trim(), sourceUrl, imageUrl, videoUrl: safeUrl(r.videoUrl),
      ingredients: ing.split('\n').map((x) => x.trim()).filter(Boolean),
      tags: [...new Set(tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))],
      addedAt: r.addedAt ?? Date.now(),
    })
    onSaved(r.id)
  }
  return (
    <Modal open onClose={onClose} wide title={exists ? 'Edit recipe' : 'New recipe'} footer={<>
      <span className="tiny muted">Tip: paste the link to the original recipe so it’s one tap away.</span>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row">
          <input className="input" style={{ width: 56, textAlign: 'center', fontSize: 22, height: 44 }} value={r.emoji} maxLength={4} onChange={(e) => set({ emoji: e.target.value })} aria-label="Emoji" />
          <input className="input" style={{ height: 44, fontSize: 18, fontWeight: 600 }} autoFocus placeholder="Recipe name" value={r.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <label className="field"><span>Link to recipe</span><input className="input" inputMode="url" placeholder="https://… (blog, TikTok, YouTube, Instagram)" value={r.sourceUrl ?? ''} onChange={(e) => set({ sourceUrl: e.target.value })} /></label>
        <div className="grid cols-2">
          <div className="field"><span>Photo</span>
            <div className="row">
              <label className="btn">{r.imageId ? 'Change photo' : 'Upload photo'}<input type="file" accept="image/*" className="sr-only" onChange={(e) => photo(e.target.files?.[0])} /></label>
              {r.imageId && <button className="btn ghost sm" onClick={() => set({ imageId: undefined })}>Remove</button>}
            </div>
          </div>
          <label className="field"><span>…or image link</span><input className="input" placeholder="https://…jpg" value={r.imageUrl ?? ''} onChange={(e) => set({ imageUrl: e.target.value })} disabled={!!r.imageId} /></label>
        </div>
        <div className="grid cols-3">
          <label className="field"><span>Time (min)</span><input type="number" min={0} className="input" value={r.prepMins ?? ''} onChange={(e) => set({ prepMins: e.target.value ? Number(e.target.value) : undefined })} /></label>
          <label className="field"><span>Servings</span><input type="number" min={0} className="input" value={r.servings ?? ''} onChange={(e) => set({ servings: e.target.value ? Number(e.target.value) : undefined })} /></label>
          <label className="field"><span>Cuisine</span><input className="input" placeholder="Korean" value={r.cuisine ?? ''} onChange={(e) => set({ cuisine: e.target.value || undefined })} /></label>
        </div>
        <label className="field"><span>Tags</span><input className="input" placeholder="dinner, meal prep, high protein" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <div className="grid cols-2">
          <label className="field"><span>Ingredients (one per line)</span><textarea className="textarea" rows={8} value={ing} onChange={(e) => setIng(e.target.value)} /></label>
          <label className="field"><span>Method</span><textarea className="textarea" rows={8} value={r.steps} onChange={(e) => set({ steps: e.target.value })} /></label>
        </div>
        <label className="field"><span>My notes</span><textarea className="textarea" rows={2} placeholder="Swaps, what worked, double the garlic…" value={r.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} /></label>
        <div className="row"><span className="small muted">Rating</span><Stars value={r.rating} onChange={(rating) => set({ rating })} />
          <label className="row small" style={{ marginLeft: 'auto' }}><input type="checkbox" className="check" checked={!!r.favorite} onChange={(e) => set({ favorite: e.target.checked })} /> Favourite</label></div>
      </div>
    </Modal>
  )
}

/* ---------------- Discover (TheMealDB) ---------------- */

function Discover({ onOpenSaved }: { onOpenSaved: (id: string) => void }) {
  const recipes = useStore((s) => s.recipes)
  const savedByExt = useMemo(() => new Map(recipes.filter((r) => r.external).map((r) => [r.external!.id, r.id])), [recipes])
  const [mode, setMode] = useState<'name' | 'ingredient'>('name')
  const [q, setQ] = useState('')
  const [cats, setCats] = useState<string[]>([])
  const [cat, setCat] = useState('')
  const [results, setResults] = useState<MealIdea[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<MealIdea | null>(null)
  const ctrl = useRef<AbortController | null>(null)

  async function run(fn: (s: AbortSignal) => Promise<MealIdea[]>, what: string) {
    ctrl.current?.abort()
    const c = new AbortController(); ctrl.current = c
    setBusy(true); setError(''); setLabel(what)
    try { const r = await fn(c.signal); if (!c.signal.aborted) setResults(r) }
    catch (e: any) { if (e?.name !== 'AbortError') { setError(e.message); setResults(null) } }
    finally { if (ctrl.current === c) setBusy(false) }
  }
  const search = () => { if (q.trim()) { setCat(''); run((s) => (mode === 'name' ? searchByName(q, s) : searchByIngredient(q, s)), mode === 'name' ? `“${q.trim()}”` : `with ${q.trim()}`) } }
  const surprise = () => { setCat(''); run(() => randomIdeas(9), 'Random ideas') }

  useEffect(() => {
    categories().then(setCats).catch(() => {})
    surprise()
    return () => ctrl.current?.abort()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function save(m: MealDbMeal) {
    const existing = savedByExt.get(m.idMeal)
    if (existing) return existing
    const r = toRecipe(m, uid())
    useStore.getState().upsertRecipe(r)
    toast(`Saved “${r.name}” to your recipes`, { label: 'View', run: () => onOpenSaved(r.id) })
    return r.id
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row wrap">
          <Seg value={mode} onChange={setMode} options={[{ value: 'name', label: 'By name' }, { value: 'ingredient', label: 'What I have' }]} />
          <input className="input grow" style={{ minWidth: 200 }} placeholder={mode === 'name' ? 'e.g. curry, pancakes, salmon' : 'One ingredient, e.g. chicken, eggs, tofu'} value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} aria-label="Search recipe ideas" />
          <button className="btn primary" onClick={search} disabled={!q.trim()}>Search</button>
          <button className="btn" onClick={surprise}>🎲 Surprise me</button>
        </div>
        {cats.length > 0 && (
          <div className="row wrap" style={{ marginTop: 12 }}>
            {cats.map((c) => <button key={c} className={`chip${cat === c ? '' : ' outline'}`} aria-pressed={cat === c} onClick={() => { setCat(c); run((s) => byCategory(c, s), c) }}>{c}</button>)}
          </div>
        )}
        <div className="tiny muted" style={{ marginTop: 10 }}>Ideas from TheMealDB, a free recipe database. Your searches go straight to them.</div>
      </div>

      <div className="row between" style={{ marginBottom: 10 }}>
        <h3>{busy ? 'Looking…' : results ? `${label} · ${results.length} idea${results.length === 1 ? '' : 's'}` : ''}</h3>
        {results && results.length > 0 && !busy && label === 'Random ideas' && <button className="btn sm ghost" onClick={surprise}>Shuffle</button>}
      </div>
      {error && <div className="card"><Empty emoji="🌧️">{error}<div style={{ marginTop: 10 }}><button className="btn sm" onClick={surprise}>Try again</button></div></Empty></div>}
      {!error && results && !results.length && !busy && <div className="card"><Empty emoji="🔍">No ideas for that. {mode === 'ingredient' ? 'Try a single, simple ingredient.' : 'Try a broader word.'}</Empty></div>}
      <div className="grid cols-3" style={{ opacity: busy ? 0.55 : 1, transition: 'opacity .15s' }}>
        {(results ?? []).slice(0, 60).map((m) => {
          const savedId = savedByExt.get(m.id)
          return (
            <div key={m.id} className="recipe-card" role="button" tabIndex={0} onClick={() => setPreview(m)} onKeyDown={(e) => e.key === 'Enter' && setPreview(m)}>
              <RecipeImage r={{ imageUrl: m.thumb, emoji: '🍽️', name: m.name }} small />
              <div style={{ padding: 12 }}>
                <h3 className="ellipsis">{m.name}</h3>
                <div className="row between" style={{ marginTop: 6 }}>
                  <span className="tiny muted ellipsis">{[m.area, m.category].filter(Boolean).join(' · ') || ' '}</span>
                  {savedId
                    ? <button className="chip" onClick={(e) => { e.stopPropagation(); onOpenSaved(savedId) }}>✓ Saved</button>
                    : <button className="chip outline" onClick={async (e) => {
                        e.stopPropagation()
                        try { const full = m.full ?? await lookup(m.id); if (full) save(full); else toast('That recipe is no longer available') } catch (err: any) { toast(err.message) }
                      }}>♡ Save</button>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {preview && <IdeaPreview idea={preview} savedId={savedByExt.get(preview.id)} onClose={() => setPreview(null)}
        onSave={(m) => { const id = save(m); setPreview(null); onOpenSaved(id) }} />}
    </>
  )
}

function IdeaPreview({ idea, savedId, onClose, onSave }: { idea: MealIdea; savedId?: string; onClose: () => void; onSave: (m: MealDbMeal) => void }) {
  const [meal, setMeal] = useState<MealDbMeal | undefined>(idea.full)
  const [error, setError] = useState('')
  useEffect(() => {
    if (idea.full) return
    const c = new AbortController()
    lookup(idea.id, c.signal).then((m) => (m ? setMeal(m) : setError('That recipe is no longer available'))).catch((e) => e?.name !== 'AbortError' && setError(e.message))
    return () => c.abort()
  }, [idea])
  const r = meal ? toRecipe(meal, 'preview') : undefined
  return (
    <Modal open onClose={onClose} wide title={idea.name} footer={<>
      {r?.sourceUrl ? <a className="btn ghost sm" href={r.sourceUrl} target="_blank" rel="noopener noreferrer">🔗 {host(r.sourceUrl)}</a> : <span />}
      <div className="row"><button className="btn" onClick={onClose}>Close</button>
        <button className="btn primary" disabled={!meal} onClick={() => meal && onSave(meal)}>{savedId ? 'Open in my recipes' : '♡ Save to my recipes'}</button></div>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div style={{ borderRadius: 'var(--r-lg)', overflow: 'hidden' }}><RecipeImage r={{ imageUrl: idea.thumb, emoji: '🍽️', name: idea.name }} height={220} /></div>
        {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}
        {!r && !error && <div className="muted small">Loading recipe…</div>}
        {r && <>
          <div className="row wrap">{r.cuisine && <span className="chip outline">{r.cuisine}</span>}{r.tags.map((t) => <span key={t} className="chip">{t}</span>)}{r.videoUrl && <a className="chip outline" href={r.videoUrl} target="_blank" rel="noopener noreferrer">▶ Video</a>}</div>
          <div className="grid cols-2" style={{ alignItems: 'start' }}>
            <div><h3 style={{ marginBottom: 8 }}>Ingredients</h3><ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>{r.ingredients.map((i, k) => <li key={k}>{i}</li>)}</ul></div>
            <div><h3 style={{ marginBottom: 8 }}>Method</h3><div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, maxHeight: 360, overflowY: 'auto' }}>{r.steps}</div></div>
          </div>
        </>}
      </div>
    </Modal>
  )
}

/* ---------------- Week plan ---------------- */

function WeekPlan({ onOpen }: { onOpen: (id: string) => void }) {
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
    const have = new Set(g.filter((x) => !x.done).map((x) => x.text.toLowerCase()))
    const add: typeof g = []
    for (const d of days) for (const s of SLOTS) {
      const id = plan[d]?.[s]?.recipeId
      const r = id ? byId.get(id) : undefined
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
        <button className="btn sm primary" onClick={weekToGrocery}>🛒 Week → grocery list</button>
      </div>
      <div className="mealweek">
        <div />
        {days.map((d) => <div key={d} className="mh" style={d === t ? { color: 'var(--accent-ink)' } : undefined}>{format(fromISO(d), 'EEE d')}</div>)}
        {SLOTS.map((s) => (
          <PlanRow key={s} label={s}>
            {days.map((d) => {
              const e = plan[d]?.[s]
              const r = e?.recipeId ? byId.get(e.recipeId) : undefined
              const text = r ? `${r.emoji} ${r.name}` : e?.text
              return <button key={d} className={`mslot${text ? ' filled' : ''}`} onClick={() => setSlot({ date: d, slot: s })} onDoubleClick={() => r && onOpen(r.id)} title={r ? 'Double-click to open recipe' : undefined}>{text ?? <span className="muted">+</span>}</button>
            })}
          </PlanRow>
        ))}
      </div>
      {slot && <SlotPicker {...slot} onClose={() => setSlot(null)} onPick={(e) => { setMeal(slot.date, slot.slot, e); setSlot(null) }} />}
    </div>
  )
}

const PlanRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <><div className="mh" style={{ textTransform: 'capitalize', alignSelf: 'center' }}>{label}</div>{children}</>
)

function SlotPicker({ date, slot, onClose, onPick }: { date: string; slot: MealSlot; onClose: () => void; onPick: (e?: { recipeId?: string; text?: string }) => void }) {
  const recipes = useStore((s) => s.recipes)
  const cur = useStore((s) => s.mealPlan[date]?.[slot])
  const [text, setText] = useState(cur?.text ?? '')
  const [q, setQ] = useState('')
  const list = recipes
    .filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.tags.some((t) => t.includes(q.toLowerCase())))
    .sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || a.name.localeCompare(b.name))
  return (
    <Modal open onClose={onClose} title={`${slot[0].toUpperCase()}${slot.slice(1)} · ${format(fromISO(date), 'EEE, MMM d')}`}
      footer={<><button className="btn ghost danger" onClick={() => onPick(undefined)}>Clear</button><button className="btn" onClick={onClose}>Cancel</button></>}>
      <div className="stack">
        <div className="row">
          <input className="input" placeholder="Type anything (e.g. “Dining hall”)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && text.trim() && onPick({ text: text.trim() })} />
          <button className="btn primary" disabled={!text.trim()} onClick={() => onPick({ text: text.trim() })}>Set</button>
        </div>
        {recipes.length > 0 && <>
          <div className="nav-label" style={{ padding: '6px 0 0' }}>Or pick from your recipes</div>
          {recipes.length > 6 && <input className="input" placeholder="Search recipes or tags" value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="stack" style={{ gap: 2, maxHeight: 300, overflowY: 'auto' }}>
            {list.map((r) => (
              <button key={r.id} className="lrow" style={{ border: 0, background: cur?.recipeId === r.id ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', textAlign: 'left' }} onClick={() => onPick({ recipeId: r.id })}>
                <span style={{ fontSize: 20 }}>{r.emoji}</span><span className="grow lrow-title">{r.name}</span>{r.favorite && <span style={{ color: 'var(--accent-ink)' }}>♥</span>}
              </button>
            ))}
          </div>
        </>}
      </div>
    </Modal>
  )
}

/* ---------------- Grocery ---------------- */

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
