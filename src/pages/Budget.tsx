import { useMemo, useState } from 'react'
import { addMonths, format } from 'date-fns'
import { PageShell } from '../components/PageShell'
import { Empty, Modal, Seg, toast } from '../components/ui'
import { SavingsView, useMoney } from './Savings'
import { CsvImport } from './BudgetImport'
import { fromISO, toISO, todayISO } from '../lib/dates'
import { uid } from '../lib/id'
import { useStore } from '../store/store'
import { contributedInMonth } from '../lib/money'
import type { BudgetCategory, Txn } from '../store/types'

export default function Budget() {
  const [tab, setTab] = useState<'month' | 'savings'>('month')
  const [editCats, setEditCats] = useState(false)
  return (
    <PageShell section="budget" actions={tab === 'month' ? <button className="btn" onClick={() => setEditCats(true)}>Edit categories</button> : undefined}>
      <div style={{ marginBottom: 16 }}>
        <Seg value={tab} onChange={setTab} label="Budget view" options={[{ value: 'month', label: '📅 This month' }, { value: 'savings', label: '🐷 Savings & accounts' }]} />
      </div>
      {tab === 'month' ? <MonthBudget /> : <SavingsView />}
      {editCats && <CategoryEditor onClose={() => setEditCats(false)} />}
    </PageShell>
  )
}

function MonthBudget() {
  const t = todayISO()
  const [month, setMonth] = useState(t.slice(0, 7))
  const txns = useStore((s) => s.txns)
  const cats = useStore((s) => s.categories)
  const cur = useStore((s) => s.settings.currency)
  const { upsertTxn, deleteTxn } = useStore.getState()
  const goals = useStore((s) => s.goals)
  const [importing, setImporting] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [cat, setCat] = useState<string>(cats[0]?.id ?? '')
  const [income, setIncome] = useState(false)
  const money = useMoney()
  const toGoals = contributedInMonth(goals, month)

  const mt = useMemo(() => txns.filter((x) => x.date.startsWith(month)).sort((a, b) => (a.date > b.date ? -1 : 1)), [txns, month])
  const inc = mt.filter((x) => x.income).reduce((n, x) => n + x.amount, 0)
  const spent = mt.filter((x) => !x.income).reduce((n, x) => n + x.amount, 0)
  const planned = cats.reduce((n, c) => n + c.planned, 0)
  const byCat = useMemo(() => { const m: Record<string, number> = {}; for (const x of mt) if (!x.income && x.categoryId) m[x.categoryId] = (m[x.categoryId] ?? 0) + x.amount; return m }, [mt])

  function add() {
    const a = Number(amount)
    if (!a || a <= 0) { toast('Enter an amount'); return }
    const date = month === t.slice(0, 7) ? t : `${month}-01`
    upsertTxn({ id: uid(), date, amount: a, note: note.trim() || undefined, income, categoryId: income ? undefined : cat || undefined })
    setAmount(''); setNote('')
  }
  const step = (n: number) => setMonth(toISO(addMonths(fromISO(`${month}-01`), n)).slice(0, 7))

  return (
    <>
      <div className="cal-toolbar">
        <button className="btn icon" onClick={() => step(-1)} aria-label="Previous month">‹</button>
        <button className="btn icon" onClick={() => step(1)} aria-label="Next month">›</button>
        <div className="cal-title">{format(fromISO(`${month}-01`), 'MMMM yyyy')}</div>
      </div>
      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="l">Income</div><div className="v">{money(inc)}</div></div>
        <div className="stat"><div className="l">Spent</div><div className="v">{money(spent)}</div><div className="small muted">of {money(planned)} planned</div></div>
        <div className="stat" style={{ background: 'var(--accent-soft)' }}><div className="l">Left</div><div className="v">{money(inc - spent)}</div>{toGoals !== 0 && <div className="small muted">{money(toGoals)} put toward goals</div>}</div>
      </div>
      <div className="grid dash">
        <section className="card">
          <div className="card-head"><h3>Planned vs actual</h3></div>
          <div className="stack" style={{ gap: 12 }}>
            {cats.map((c) => {
              const a = byCat[c.id] ?? 0
              const over = a > c.planned
              return (
                <div key={c.id}>
                  <div className="row between small"><span>{c.emoji} <b>{c.name}</b></span><span className={over ? '' : 'muted'} style={over ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{money(a)} / {money(c.planned)}</span></div>
                  <div className={`pa${over ? ' over' : ''}`} style={{ marginTop: 4 }}><i style={{ width: `${c.planned ? Math.min(100, (a / c.planned) * 100) : a ? 100 : 0}%` }} /></div>
                </div>
              )
            })}
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h3>Log money</h3><button className="btn sm" onClick={() => setImporting(true)}>⬆ Import bank CSV</button></div>
          <div className="stack" style={{ gap: 8 }}>
            <div className="seg" style={{ alignSelf: 'flex-start' }}>
              <button className={!income ? 'on' : ''} onClick={() => setIncome(false)}>Expense</button>
              <button className={income ? 'on' : ''} onClick={() => setIncome(true)}>Income</button>
            </div>
            <div className="row">
              <input type="number" inputMode="decimal" className="input" style={{ width: 110 }} placeholder={`${cur}0.00`} value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="Amount" />
              {!income && <select className="select" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category">{cats.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select>}
            </div>
            <div className="row"><input className="input" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /><button className="btn primary" onClick={add}>Add</button></div>
          </div>
          <div style={{ marginTop: 14 }}>
            {!mt.length && <Empty emoji="🪙">No entries this month.</Empty>}
            {mt.map((x) => <TxnRow key={x.id} x={x} cats={cats} money={money} onDelete={() => { deleteTxn(x.id); toast('Removed', { label: 'Undo', run: () => upsertTxn(x) }) }} />)}
          </div>
        </section>
      </div>
      {importing && <CsvImport onClose={() => setImporting(false)} onDone={(latest) => { setImporting(false); if (latest) setMonth(latest) }} />}
    </>
  )
}

function TxnRow({ x, cats, money, onDelete }: { x: Txn; cats: BudgetCategory[]; money: (n: number) => string; onDelete: () => void }) {
  const c = cats.find((c) => c.id === x.categoryId)
  return (
    <div className="lrow">
      <span style={{ width: 22 }}>{x.income ? '💰' : c?.emoji ?? '•'}</span>
      <div className="grow"><div className="lrow-title ellipsis">{x.note || (x.income ? 'Income' : c?.name ?? 'Expense')}</div><div className="tiny muted">{format(fromISO(x.date), 'MMM d')}</div></div>
      <b style={{ color: x.income ? 'var(--accent-ink)' : undefined }}>{x.income ? '+' : ''}{money(x.amount)}</b>
      <button className="btn ghost icon sm" aria-label="Delete entry" onClick={onDelete}>✕</button>
    </div>
  )
}

function CategoryEditor({ onClose }: { onClose: () => void }) {
  const cats = useStore((s) => s.categories)
  const setCats = useStore((s) => s.setCategories)
  const cur = useStore((s) => s.settings.currency)
  const [list, setList] = useState(cats)
  const upd = (id: string, p: Partial<BudgetCategory>) => setList(list.map((c) => (c.id === id ? { ...c, ...p } : c)))
  return (
    <Modal open onClose={onClose} title="Categories" footer={<><button className="btn" onClick={() => setList([...list, { id: uid(), name: '', emoji: '🏷️', planned: 0 }])}>+ Category</button><button className="btn primary" onClick={() => { setCats(list.filter((c) => c.name.trim())); onClose() }}>Save</button></>}>
      <div className="stack" style={{ gap: 6 }}>
        {list.map((c) => (
          <div key={c.id} className="row">
            <input className="input" style={{ width: 50, textAlign: 'center' }} value={c.emoji} maxLength={4} onChange={(e) => upd(c.id, { emoji: e.target.value })} aria-label="Emoji" />
            <input className="input grow" value={c.name} placeholder="Name" onChange={(e) => upd(c.id, { name: e.target.value })} aria-label="Name" />
            <span className="muted">{cur}</span><input type="number" className="input" style={{ width: 90 }} value={c.planned} onChange={(e) => upd(c.id, { planned: Number(e.target.value) || 0 })} aria-label="Planned per month" />
            <button className="btn ghost icon sm" aria-label="Remove" onClick={() => setList(list.filter((x) => x.id !== c.id))}>✕</button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
