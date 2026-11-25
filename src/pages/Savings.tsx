import { useMemo, useState, type CSSProperties } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { Empty, Modal, Progress, Seg, toast, useMediaQuery } from '../components/ui'
import { fromISO, todayISO } from '../lib/dates'
import { uid } from '../lib/id'
import { goalStatus, savingsSplit, setToAmount, signedBalance, totals, withBalance } from '../lib/money'
import { useStore } from '../store/store'
import type { AccountType, Contribution, MoneyAccount, SavingsGoal } from '../store/types'

export function useMoney() {
  const cur = useStore((s) => s.settings.currency)
  return (n: number) => `${n < 0 ? '−' : ''}${cur}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}

const TYPES: { value: AccountType; label: string; emoji: string }[] = [
  { value: 'chequing', label: 'Chequing', emoji: '🏦' }, { value: 'savings', label: 'Savings', emoji: '🐷' },
  { value: 'credit', label: 'Credit card', emoji: '💳' }, { value: 'investment', label: 'Investments / TFSA', emoji: '📈' },
  { value: 'cash', label: 'Cash', emoji: '💵' },
]
const typeLabel = (t: AccountType) => TYPES.find((x) => x.value === t)!.label

export function SavingsView() {
  const accounts = useStore((s) => s.accounts)
  const goals = useStore((s) => s.goals)
  const money = useMoney()
  const tot = useMemo(() => totals(accounts), [accounts])
  const [editAccount, setEditAccount] = useState<MoneyAccount | null>(null)
  const [editGoal, setEditGoal] = useState<SavingsGoal | null>(null)
  const [contribute, setContribute] = useState<SavingsGoal | null>(null)
  const active = goals.filter((g) => !g.done)
  const finished = goals.filter((g) => g.done)
  const towardGoals = active.reduce((n, g) => n + goalStatus(g, accounts).saved, 0)
  const narrow = useMediaQuery('(max-width: 600px)')

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: narrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))' }}>
        <div className="stat" style={{ background: 'var(--accent-soft)', gridColumn: narrow ? '1 / -1' : undefined }}><div className="l">Net worth</div><div className="v">{money(tot.netWorth)}</div><div className="small muted">everything you have minus what you owe</div></div>
        <div className="stat"><div className="l">Cash on hand</div><div className="v">{money(tot.cash)}</div><div className="small muted">chequing + savings + cash</div></div>
        <div className="stat"><div className="l">{tot.owed ? 'Owed on cards' : 'Toward goals'}</div><div className="v">{money(tot.owed ? -tot.owed : towardGoals)}</div><div className="small muted">{tot.owed ? `${money(towardGoals)} saved toward goals` : `${active.length} active goal${active.length === 1 ? '' : 's'}`}</div></div>
      </div>

      <SplitCard onNew={(p) => setEditGoal({ id: uid(), name: '', emoji: '🎯', target: 0, contributions: [], ...p })}
        onOpen={(g) => (g.accountId ? setEditGoal(g) : setContribute(g))} />

      <section className="card">
        <div className="card-head"><h3>🏦 Accounts</h3><button className="btn sm" onClick={() => setEditAccount({ id: uid(), name: '', emoji: '🏦', type: 'chequing', balance: 0, history: [] })}>+ Account</button></div>
        {!accounts.length && <Empty emoji="🏦">Add your chequing, savings or credit card and update the balance whenever you check your bank app. Nothing connects to your bank.</Empty>}
        {accounts.map((a) => <AccountRow key={a.id} a={a} compact={narrow} onOpen={() => setEditAccount(a)} />)}
      </section>

      <section className="card">
        <div className="card-head"><h3>🎯 Goal details</h3><button className="btn sm" onClick={() => setEditGoal({ id: uid(), name: '', emoji: '🎯', target: 0, contributions: [] })}>+ Goal</button></div>
        {!active.length && <Empty emoji="🌱">Set a goal (emergency fund, trip, laptop) and track it by hand or let it follow a savings account.</Empty>}
        <div className="grid cols-2">
          {active.map((g) => <GoalCard key={g.id} g={g} onEdit={() => setEditGoal(g)} onAdd={() => setContribute(g)} />)}
        </div>
        {finished.length > 0 && <div className="small muted" style={{ marginTop: 12 }}>Completed: {finished.map((g) => `${g.emoji} ${g.name}`).join(' · ')}</div>}
      </section>

      {editAccount && <AccountEditor a={editAccount} onClose={() => setEditAccount(null)} />}
      {editGoal && <GoalEditor g={editGoal} onClose={() => setEditGoal(null)} />}
      {contribute && <ContributeModal g={contribute} onClose={() => setContribute(null)} />}
    </div>
  )
}

const SPLIT_COLORS = ['#E9A3B4', '#9CC3E8', '#9CC19F', '#E8C872', '#BCA7E4', '#F2B48C', '#8ED3C2', '#CFA3C0']
export const GOAL_PRESETS: { name: string; emoji: string }[] = [
  { name: 'Emergency', emoji: '🛟' }, { name: 'Travel', emoji: '✈️' }, { name: 'Laptop', emoji: '💻' }, { name: 'Tuition', emoji: '📚' },
  { name: 'Car', emoji: '🚗' }, { name: 'Gifts', emoji: '🎁' }, { name: 'Moving out', emoji: '📦' }, { name: 'Concerts', emoji: '🎟️' },
]

/** Overview: savings split into named pots (one bar), total saved vs total targets, and money not assigned to any goal. */
function SplitCard({ onNew, onOpen }: { onNew: (p: Partial<SavingsGoal>) => void; onOpen: (g: SavingsGoal) => void }) {
  const goals = useStore((s) => s.goals)
  const accounts = useStore((s) => s.accounts)
  const money = useMoney()
  const split = useMemo(() => savingsSplit(goals, accounts), [goals, accounts])
  const scale = Math.max(split.pool, split.totalSaved, 1)
  const free = split.pool > 0 ? Math.max(0, split.unassigned) : 0
  const used = goals.filter((g) => !g.done).map((g) => g.name.toLowerCase())
  const presets = GOAL_PRESETS.filter((p) => !used.some((u) => u.includes(p.name.toLowerCase())))
  return (
    <section className="card">
      <div className="card-head"><h3>🐷 Savings split</h3><button className="btn sm" onClick={() => onNew({})}>+ Goal</button></div>
      {!split.segments.length ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="small muted">Split your savings into named pots, like $300 for travel and $700 for emergencies. Pick one to start:</div>
          <div className="row wrap">{GOAL_PRESETS.map((p) => <button key={p.name} className="chip outline" onClick={() => onNew(p)}>{p.emoji} {p.name}</button>)}</div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row between wrap" style={{ alignItems: 'baseline' }}>
            <div><span className="v" style={{ font: '560 1.6rem var(--font-display)' }}>{money(split.totalSaved)}</span> <span className="small muted">saved of {money(split.totalTarget)} across {split.segments.length} goal{split.segments.length === 1 ? '' : 's'}</span></div>
            <span className="small muted">{Math.round(split.pct * 100)}% of all targets</span>
          </div>
          <div style={{ display: 'flex', height: 18, borderRadius: 99, overflow: 'hidden', background: 'var(--surface-2)' }} role="img"
            aria-label={`Savings split: ${split.segments.map((s) => `${s.name} ${money(s.saved)}`).join(', ')}${free ? `, unassigned ${money(free)}` : ''}`}>
            {split.segments.map((s, i) => s.saved > 0 && <div key={s.id} title={`${s.name}: ${money(s.saved)}`} style={{ width: `${(s.saved / scale) * 100}%`, background: SPLIT_COLORS[i % SPLIT_COLORS.length], borderRight: '2px solid var(--surface)' }} />)}
            {free > 0 && <div title={`Unassigned: ${money(free)}`} style={{ width: `${(free / scale) * 100}%`, background: 'repeating-linear-gradient(135deg, var(--border) 0 6px, transparent 6px 12px)' }} />}
          </div>
          <div className="stack" style={{ gap: 2 }}>
            {split.segments.map((s, i) => {
              const g = goals.find((x) => x.id === s.id)!
              return (
                <button key={s.id} className="lrow" style={{ border: 0, background: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => onOpen(g)} aria-label={`${s.name}: ${money(s.saved)} of ${money(s.target)}`}>
                  <span style={{ width: 12, height: 12, borderRadius: 4, background: SPLIT_COLORS[i % SPLIT_COLORS.length], flex: 'none' }} />
                  <span className="grow lrow-title ellipsis">{s.emoji} {s.name}</span>
                  <span className="small" style={{ flex: 'none' }}><b>{money(s.saved)}</b> <span className="muted">/ {money(s.target)}</span></span>
                  <span className="small muted" style={{ width: 40, textAlign: 'right', flex: 'none' }}>{s.target > 0 ? `${Math.min(100, Math.round((s.saved / s.target) * 100))}%` : ''}</span>
                </button>
              )
            })}
            {free > 0 && (
              <div className="lrow">
                <span style={{ width: 12, height: 12, borderRadius: 4, flex: 'none', background: 'repeating-linear-gradient(135deg, var(--border-strong) 0 3px, transparent 3px 6px)' }} />
                <span className="grow muted">Not assigned to a goal</span>
                <span className="small" style={{ flex: 'none' }}><b>{money(free)}</b></span>
                <span style={{ width: 40, flex: 'none' }} />
              </div>
            )}
          </div>
          {split.pool > 0
            ? split.unassigned < 0
              ? <div className="small" style={{ color: 'var(--danger)' }}>Your goals add up to {money(-split.unassigned)} more than your savings accounts hold ({money(split.pool)}). Update a balance or lower a goal.</div>
              : <div className="small muted">Your savings accounts hold {money(split.pool)}{free > 0 ? ` — ${money(free)} isn’t assigned yet` : ' — all of it is assigned'}.</div>
            : <div className="small muted">Add a savings account below to see how much of it is still unassigned.</div>}
          {presets.length > 0 && <div className="row wrap"><span className="tiny muted">Add:</span>{presets.slice(0, 5).map((p) => <button key={p.name} className="chip outline" onClick={() => onNew(p)}>{p.emoji} {p.name}</button>)}</div>}
        </div>
      )}
    </section>
  )
}

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1
  const d = points.map((v, i) => `${(i / (points.length - 1)) * 76 + 2},${22 - ((v - min) / span) * 18}`).join(' ')
  return <svg width="80" height="24" viewBox="0 0 80 24" aria-hidden><polyline points={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function AccountRow({ a, onOpen, compact }: { a: MoneyAccount; onOpen: () => void; compact?: boolean }) {
  const money = useMoney()
  const last = a.history[a.history.length - 1]?.date
  const prev = a.history.length > 1 ? a.history[a.history.length - 2].balance : undefined
  const delta = prev !== undefined ? a.balance - prev : undefined
  return (
    <button className="lrow" style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={onOpen}>
      <span style={{ fontSize: 22 }}>{a.emoji}</span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="lrow-title ellipsis" style={{ display: 'block' }}>{a.name}</span>
        <span className="tiny muted">{a.name.toLowerCase().includes(typeLabel(a.type).toLowerCase()) ? '' : `${typeLabel(a.type)} · `}{last ? `updated ${last === todayISO() ? 'today' : `${formatDistanceToNowStrict(fromISO(last))} ago`}` : ''}</span>
      </span>
      {!compact && <Spark points={a.history.slice(-12).map((h) => h.balance)} />}
      <span style={{ textAlign: 'right', minWidth: 90 }}>
        <b style={{ color: a.type === 'credit' ? 'var(--danger)' : undefined }}>{money(signedBalance(a))}</b>
        {delta !== undefined && delta !== 0 && <span className="tiny muted" style={{ display: 'block' }}>{delta > 0 ? '▲' : '▼'} {money(Math.abs(delta))}</span>}
      </span>
    </button>
  )
}

function GoalCard({ g, onEdit, onAdd }: { g: SavingsGoal; onEdit: () => void; onAdd: () => void }) {
  const accounts = useStore((s) => s.accounts)
  const money = useMoney()
  const st = goalStatus(g, accounts)
  const linked = g.accountId ? accounts.find((a) => a.id === g.accountId) : undefined
  const line = st.reached ? 'Goal reached 🎉'
    : st.overdue ? `Target date passed · ${money(st.remaining)} to go`
    : st.perMonth !== undefined ? `${money(st.perMonth)}/month to reach it by ${format(fromISO(g.targetDate!), 'MMM d, yyyy')}`
    : `${money(st.remaining)} to go`
  return (
    <div className="stat" style={{ '--accent': st.reached ? '#7CC48B' : undefined } as CSSProperties}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <button className="linkish" style={{ all: 'unset', cursor: 'pointer', fontWeight: 650 }} onClick={onEdit} aria-label={`Edit goal ${g.name}`}>{g.emoji} {g.name}</button>
        <span className="small muted">{Math.round(st.pct * 100)}%</span>
      </div>
      <div className="v" style={{ marginTop: 6 }}>{money(st.saved)} <span className="small muted" style={{ fontFamily: 'var(--font-body)', fontWeight: 500 }}>of {money(g.target)}</span></div>
      <div style={{ margin: '8px 0' }}><Progress value={st.pct} /></div>
      <div className="small" style={{ color: st.overdue ? 'var(--danger)' : 'var(--muted)' }}>{line}</div>
      <div className="row" style={{ marginTop: 10 }}>
        {linked
          ? <span className="tiny muted">Follows your {linked.emoji} {linked.name} balance</span>
          : <button className="btn sm primary" onClick={onAdd}>+ Add money</button>}
        <button className="btn sm ghost" onClick={onEdit}>Edit</button>
      </div>
    </div>
  )
}

function AccountEditor({ a: init, onClose }: { a: MoneyAccount; onClose: () => void }) {
  const exists = useStore((s) => s.accounts.some((x) => x.id === init.id))
  const { upsertAccount, deleteAccount } = useStore.getState()
  const money = useMoney()
  const [a, setA] = useState(init)
  const [bal, setBal] = useState(exists ? '' : String(init.balance || ''))
  function save() {
    if (!a.name.trim()) { toast('Give the account a name'); return }
    let next: MoneyAccount = { ...a, name: a.name.trim() }
    const n = bal.trim() === '' ? undefined : Number(bal)
    if (n !== undefined && Number.isNaN(n)) { toast('Balance must be a number'); return }
    if (n !== undefined) next = withBalance(next, n)
    else if (!exists) next = withBalance(next, 0)
    upsertAccount(next)
    onClose()
    if (exists && n !== undefined) toast(`${next.name} updated to ${money(n)}`)
  }
  return (
    <Modal open onClose={onClose} title={exists ? a.name || 'Account' : 'New account'} footer={<>
      <div className="row">{exists && <button className="btn ghost danger" onClick={() => { if (confirm(`Delete ${a.name}? Its history goes too.`)) { deleteAccount(a.id); onClose() } }}>Delete</button>}</div>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row">
          <input className="input" style={{ width: 56, textAlign: 'center', fontSize: 22 }} value={a.emoji} maxLength={4} onChange={(e) => setA({ ...a, emoji: e.target.value })} aria-label="Emoji" />
          <input className="input grow" autoFocus={!exists} placeholder="e.g. RBC Chequing" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} aria-label="Account name" />
        </div>
        <label className="field"><span>Type</span>
          <select className="select" value={a.type} onChange={(e) => { const type = e.target.value as AccountType; setA({ ...a, type, emoji: a.emoji === TYPES.find((x) => x.value === a.type)!.emoji ? TYPES.find((x) => x.value === type)!.emoji : a.emoji }) }}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.emoji} {t.label}</option>)}
          </select>
        </label>
        <label className="field"><span>{exists ? `Update balance (now ${money(a.balance)})` : 'Current balance'}{a.type === 'credit' ? ' — amount owed' : ''}</span>
          <input className="input" type="number" inputMode="decimal" step="0.01" autoFocus={exists} placeholder={exists ? 'New balance from your bank app' : '0.00'} value={bal} onChange={(e) => setBal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </label>
        {exists && a.history.length > 0 && (
          <div className="field"><span>History</span>
            <div className="stack" style={{ gap: 2 }}>
              {[...a.history].reverse().slice(0, 6).map((h) => <div key={h.date} className="row between small"><span className="muted">{format(fromISO(h.date), 'MMM d, yyyy')}</span><span>{money(h.balance)}</span></div>)}
            </div>
          </div>
        )}
        <div className="tiny muted">Balances are typed in by you; nothing is connected to your bank.</div>
      </div>
    </Modal>
  )
}

function GoalEditor({ g: init, onClose }: { g: SavingsGoal; onClose: () => void }) {
  const exists = useStore((s) => s.goals.some((x) => x.id === init.id))
  const accounts = useStore((s) => s.accounts)
  const { upsertGoal, deleteGoal } = useStore.getState()
  const [g, setG] = useState(init)
  const [mode, setMode] = useState<'manual' | 'account'>(init.accountId ? 'account' : 'manual')
  const [already, setAlready] = useState('')
  const savingsAccounts = accounts.filter((a) => a.type !== 'credit')
  function save() {
    if (!g.name.trim()) { toast('Give the goal a name'); return }
    if (!(g.target > 0)) { toast('Set a target amount'); return }
    if (mode === 'account' && !g.accountId) { toast('Pick the account this goal follows'); return }
    const start = !exists && mode === 'manual' && Number(already) > 0 ? [{ id: uid(), date: todayISO(), amount: Number(already), note: 'Starting amount' }] : []
    upsertGoal({ ...g, name: g.name.trim(), accountId: mode === 'account' ? g.accountId : undefined, contributions: [...g.contributions, ...start] })
    onClose()
  }
  return (
    <Modal open onClose={onClose} title={exists ? 'Edit goal' : 'New savings goal'} footer={<>
      <div className="row">
        {exists && <button className="btn ghost danger" onClick={() => { if (confirm(`Delete “${g.name}”?`)) { deleteGoal(g.id); onClose() } }}>Delete</button>}
        {exists && <button className="btn ghost" onClick={() => { upsertGoal({ ...g, done: !g.done }); onClose(); toast(g.done ? 'Goal reopened' : 'Goal marked complete 🎉') }}>{g.done ? 'Reopen' : 'Mark complete'}</button>}
      </div>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></div>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row">
          <input className="input" style={{ width: 56, textAlign: 'center', fontSize: 22 }} value={g.emoji} maxLength={4} onChange={(e) => setG({ ...g, emoji: e.target.value })} aria-label="Emoji" />
          <input className="input grow" autoFocus={!g.name} placeholder="e.g. Emergency fund, Summer trip" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} aria-label="Goal name" />
        </div>
        {!exists && !g.name && <div className="row wrap">{GOAL_PRESETS.map((p) => <button key={p.name} className="chip outline" onClick={() => setG({ ...g, ...p })}>{p.emoji} {p.name}</button>)}</div>}
        <div className="grid cols-2">
          <label className="field"><span>Target amount</span><input className="input" type="number" inputMode="decimal" min={0} autoFocus={!!g.name && !exists} placeholder="e.g. 300" value={g.target || ''} onChange={(e) => setG({ ...g, target: Number(e.target.value) || 0 })} /></label>
          <label className="field"><span>Target date (optional)</span><input className="input" type="date" value={g.targetDate ?? ''} onChange={(e) => setG({ ...g, targetDate: e.target.value || undefined })} /></label>
        </div>
        <div className="field"><span>Track progress</span>
          <Seg value={mode} onChange={setMode} options={[{ value: 'manual', label: 'Add money by hand' }, { value: 'account', label: 'Follow an account' }]} />
        </div>
        {mode === 'account' && (savingsAccounts.length
          ? <select className="select" value={g.accountId ?? ''} onChange={(e) => setG({ ...g, accountId: e.target.value || undefined })} aria-label="Account">
              <option value="">Choose an account…</option>
              {savingsAccounts.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
            </select>
          : <div className="small muted">Add a savings account first (Accounts → + Account).</div>)}
        {mode === 'account' && <div className="tiny muted">Progress = that account’s balance, so updating the balance updates the goal.</div>}
        {mode === 'manual' && !exists && <label className="field"><span>Already saved for this (optional)</span><input className="input" type="number" inputMode="decimal" min={0} placeholder="0" value={already} onChange={(e) => setAlready(e.target.value)} /></label>}
      </div>
    </Modal>
  )
}

function ContributeModal({ g: init, onClose }: { g: SavingsGoal; onClose: () => void }) {
  const g = useStore((s) => s.goals.find((x) => x.id === init.id)) ?? init
  const upsertGoal = useStore((s) => s.upsertGoal)
  const money = useMoney()
  const [dir, setDir] = useState<'in' | 'out' | 'set'>('in')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  function add() {
    const n = Number(amount)
    if (dir === 'set') {
      if (amount.trim() === '' || !(n >= 0)) { toast('Enter the total you have for this goal'); return }
      const c = setToAmount(g, n, date, uid())
      if (c) upsertGoal({ ...g, contributions: [...g.contributions, { ...c, note: note.trim() || c.note }] })
      setAmount(''); setNote('')
      toast(`${g.name} is now ${money(n)}`)
      return
    }
    if (!(n > 0)) { toast('Enter an amount'); return }
    const c: Contribution = { id: uid(), date, amount: dir === 'in' ? n : -n, note: note.trim() || undefined }
    upsertGoal({ ...g, contributions: [...g.contributions, c] })
    setAmount(''); setNote('')
    toast(`${dir === 'in' ? 'Added' : 'Took out'} ${money(n)} ${dir === 'in' ? 'to' : 'from'} ${g.name}`)
  }
  const recent = [...g.contributions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8)
  return (
    <Modal open onClose={onClose} title={`${g.emoji} ${g.name}`} footer={<><span /><button className="btn primary" onClick={onClose}>Done</button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="small muted">Saved so far: <b>{money(g.contributions.reduce((n, c) => n + c.amount, 0))}</b> of {money(g.target)}</div>
        <Seg value={dir} onChange={setDir} options={[{ value: 'in', label: '＋ Put in' }, { value: 'out', label: '− Take out' }, { value: 'set', label: '= Set total' }]} />
        <div className="grid cols-2">
          <label className="field"><span>{dir === 'set' ? 'Total saved for this goal' : 'Amount'}</span><input className="input" type="number" inputMode="decimal" min={0} step="0.01" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
          <label className="field"><span>Date</span><input className="input" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        </div>
        <div className="row"><input className="input grow" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="Note" /><button className="btn primary" onClick={add}>Add</button></div>
        {recent.length > 0 && (
          <div className="field"><span>Recent</span>
            {recent.map((c) => (
              <div key={c.id} className="row between small">
                <span className="muted">{format(fromISO(c.date), 'MMM d')}{c.note ? ` · ${c.note}` : ''}</span>
                <span className="row"><b style={{ color: c.amount < 0 ? 'var(--danger)' : undefined }}>{c.amount > 0 ? '+' : ''}{money(c.amount)}</b>
                  <button className="btn ghost icon sm" aria-label="Remove entry" onClick={() => upsertGoal({ ...g, contributions: g.contributions.filter((x) => x.id !== c.id) })}>✕</button></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
