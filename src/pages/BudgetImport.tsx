import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Modal, Seg, toast } from '../components/ui'
import { detectMapping, merchantKey, parseCsv, rowsToTxns, toImportRows, type ImportRow, type Mapping } from '../lib/bankcsv'
import { fromISO } from '../lib/dates'
import { uid } from '../lib/id'
import { useStore } from '../store/store'
import { useMoney } from './Savings'

const MAX_SHOWN = 300

/** Bank CSV import: pick a file → check the detected columns → untick/categorize rows → add. All in-browser. */
export function CsvImport({ onClose, onDone }: { onClose: () => void; onDone: (latestMonth?: string) => void }) {
  const [raw, setRaw] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [over, setOver] = useState(false)

  async function load(f?: File) {
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { toast('That file is too big for a bank export (over 5 MB)'); return }
    const rows = parseCsv(await f.text())
    if (rows.length < 1) { toast('That file is empty'); return }
    setFileName(f.name)
    setRaw(rows)
  }

  if (raw) return <Review raw={raw} fileName={fileName} onBack={() => setRaw(null)} onClose={onClose} onDone={onDone} />
  return (
    <Modal open onClose={onClose} wide title="Import from your bank" footer={<><span className="tiny muted">The file stays on this device; nothing is uploaded.</span><button className="btn" onClick={onClose}>Cancel</button></>}>
      <div className="stack" style={{ gap: 14 }}>
        <label className={`drop${over ? ' over' : ''}`} style={{ padding: 28 }}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]) }}>
          <b>Choose a .csv file</b> or drop it here
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => { load(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        <details>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>How do I get a CSV from my bank?</summary>
          <div className="small muted stack" style={{ gap: 6, marginTop: 8 }}>
            <div>Sign in to online banking on a computer → open the account → <b>Download transactions</b> (sometimes under “Statements” or “Export”) → choose <b>CSV</b> or “Spreadsheet”, pick a date range, download.</div>
            <div><b>TD</b>: Account activity → Download → Spreadsheet (.csv). <b>RBC</b>: Account Services → Download Transactions → Comma Delimited. <b>Scotiabank / CIBC / BMO / Tangerine</b>: the account page has a Download or Export option.</div>
            <div>Do one file per account (chequing, credit card…). Importing the same file twice won’t create duplicates.</div>
          </div>
        </details>
      </div>
    </Modal>
  )
}

function Review({ raw, fileName, onBack, onClose, onDone }: { raw: string[][]; fileName: string; onBack: () => void; onClose: () => void; onDone: (m?: string) => void }) {
  const categories = useStore((s) => s.categories)
  const txns = useStore((s) => s.txns)
  const learned = useStore((s) => s.settings.merchantRules)
  const money = useMoney()
  const [m, setM] = useState<Mapping>(() => detectMapping(raw))
  const [edits, setEdits] = useState<Record<string, Partial<ImportRow>>>({})
  const [filter, setFilter] = useState<'new' | 'all'>('new')
  const { rows: detected, skipped } = useMemo(() => toImportRows(raw, m, categories, txns, learned ?? {}), [raw, m, categories, txns, learned])
  // Row identity across re-detection: key + occurrence index (identical purchases are separate rows).
  const rows = useMemo(() => {
    const seen = new Map<string, number>()
    return detected.map((r) => { const n = seen.get(r.key) ?? 0; seen.set(r.key, n + 1); const id = `${r.key}#${n}`; return { ...r, ...edits[id], id } })
  }, [detected, edits])
  const header = m.hasHeader ? raw[0] : undefined
  const width = Math.max(...raw.slice(0, 20).map((r) => r.length))
  const colName = (i: number) => (header?.[i] ? `${header[i]}` : `Column ${i + 1}`) + (raw[m.hasHeader ? 1 : 0]?.[i] ? ` — e.g. “${raw[m.hasHeader ? 1 : 0][i].slice(0, 24)}”` : '')
  const included = rows.filter((r) => r.include)
  const spent = included.filter((r) => !r.income).reduce((n, r) => n + r.amount, 0)
  const earned = included.filter((r) => r.income).reduce((n, r) => n + r.amount, 0)
  const shown = (filter === 'new' ? rows.filter((r) => !r.duplicate) : rows).slice(0, MAX_SHOWN)
  const set = (id: string, p: Partial<ImportRow>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...p } }))
  const colSelect = (value: number | undefined, onChange: (v: number | undefined) => void, allowNone = false) => (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
      {allowNone && <option value="">—</option>}
      {Array.from({ length: width }, (_, i) => <option key={i} value={i}>{colName(i)}</option>)}
    </select>
  )

  function commit() {
    if (!included.length) { toast('Nothing selected to import'); return }
    const st = useStore.getState()
    const added = rowsToTxns(included, uid)
    st.addTxns(added)
    // Remember categories the user changed by hand, per merchant.
    const learnedNow = { ...(st.settings.merchantRules ?? {}) }
    for (const [id, e] of Object.entries(edits)) {
      const r = rows.find((x) => x.id === id)
      if (r && e.categoryId !== undefined && !r.income) { if (e.categoryId) learnedNow[merchantKey(r.description)] = e.categoryId; else delete learnedNow[merchantKey(r.description)] }
    }
    st.setSettings({ merchantRules: learnedNow })
    const latest = added.map((t) => t.date).sort().pop()
    toast(`Imported ${added.length} transaction${added.length === 1 ? '' : 's'}`, { label: 'Undo', run: () => useStore.getState().removeTxns(added.map((t) => t.id)) })
    onDone(latest?.slice(0, 7))
  }

  const dupes = rows.filter((r) => r.duplicate).length
  const transfers = rows.filter((r) => r.transfer && !r.duplicate).length
  return (
    <Modal open onClose={onClose} wide title={`Review ${fileName || 'import'}`} footer={<>
      <button className="btn ghost" onClick={onBack}>← Different file</button>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={commit} disabled={!included.length}>Add {included.length} transaction{included.length === 1 ? '' : 's'}</button></div>
    </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="stat" style={{ padding: 12 }}>
          <div className="small"><b>{included.length}</b> to add · {money(spent)} spent · {money(earned)} in
            {dupes > 0 && <> · <span className="muted">{dupes} already imported</span></>}
            {transfers > 0 && <> · <span className="muted">{transfers} transfers/card payments unticked</span></>}
            {skipped > 0 && <> · <span className="muted">{skipped} rows ignored (no date/amount)</span></>}
          </div>
        </div>

        <details open={!rows.length}>
          <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>Columns {rows.length ? '(detected automatically — open to fix)' : '— nothing recognized, set them here'}</summary>
          <div className="stack" style={{ gap: 12, marginTop: 10 }}>
            <label className="row small"><input type="checkbox" className="check" checked={m.hasHeader} onChange={(e) => setM({ ...m, hasHeader: e.target.checked })} /> First row is column names</label>
            <div className="grid cols-2">
              <label className="field"><span>Date</span>{colSelect(m.date, (v) => setM({ ...m, date: v ?? 0 }))}</label>
              <label className="field"><span>Description</span>{colSelect(m.description, (v) => setM({ ...m, description: v ?? 0 }))}</label>
            </div>
            <Seg value={m.amount !== undefined ? 'one' : 'two'} onChange={(v) => setM(v === 'one' ? { ...m, amount: m.amount ?? m.debit ?? 0, debit: undefined, credit: undefined } : { ...m, amount: undefined, debit: m.debit ?? m.amount ?? 0, credit: m.credit })}
              options={[{ value: 'one', label: 'One amount column' }, { value: 'two', label: 'Separate money out / money in' }]} />
            {m.amount !== undefined ? (
              <div className="grid cols-2">
                <label className="field"><span>Amount</span>{colSelect(m.amount, (v) => setM({ ...m, amount: v ?? 0 }))}</label>
                <label className="field"><span>Purchases appear as</span>
                  <select className="select" value={m.expensesNegative ? 'neg' : 'pos'} onChange={(e) => setM({ ...m, expensesNegative: e.target.value === 'neg' })}>
                    <option value="neg">Negative (−4.25) — most bank accounts</option><option value="pos">Positive (4.25) — most credit cards</option>
                  </select></label>
              </div>
            ) : (
              <div className="grid cols-2">
                <label className="field"><span>Money out (debit)</span>{colSelect(m.debit, (v) => setM({ ...m, debit: v }), true)}</label>
                <label className="field"><span>Money in (credit)</span>{colSelect(m.credit, (v) => setM({ ...m, credit: v }), true)}</label>
              </div>
            )}
            <label className="field" style={{ maxWidth: 320 }}><span>Date format</span>
              <select className="select" value={m.dateOrder} onChange={(e) => setM({ ...m, dateOrder: e.target.value as Mapping['dateOrder'] })}>
                <option value="mdy">Month/Day/Year (11/20/2026)</option><option value="dmy">Day/Month/Year (20/11/2026)</option>
              </select></label>
          </div>
        </details>

        {rows.length > 0 && <Seg value={filter} onChange={setFilter} options={[{ value: 'new', label: `New (${rows.length - dupes})` }, { value: 'all', label: `All rows (${rows.length})` }]} />}
        <div className="stack" style={{ gap: 2 }}>
          {shown.map((r) => (
            <div key={r.id} className={`lrow${r.include ? '' : ' done'}`} style={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 6 }}>
              <input type="checkbox" className="check" checked={r.include} disabled={r.duplicate} onChange={(e) => set(r.id, { include: e.target.checked })} aria-label={`Import ${r.description}`} />
              <span className="small muted" style={{ width: 52, flex: 'none' }}>{format(fromISO(r.date), 'MMM d')}</span>
              <span className="grow" style={{ minWidth: 140 }}>
                <span className="lrow-title ellipsis" style={{ display: 'block' }}>{r.description}</span>
                <span className="tiny muted">{r.duplicate ? 'Already imported' : r.transfer ? 'Looks like a transfer or card payment' : ''}</span>
              </span>
              {r.income
                ? <span className="chip" style={{ flex: 'none' }}>Income</span>
                : <select className="select" style={{ width: 150, flex: 'none' }} value={r.categoryId ?? ''} onChange={(e) => set(r.id, { categoryId: e.target.value || undefined })} aria-label={`Category for ${r.description}`}>
                    <option value="">Uncategorized</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
                  </select>}
              <b style={{ width: 86, textAlign: 'right', flex: 'none', color: r.income ? 'var(--accent-ink)' : undefined }}>{r.income ? '+' : '−'}{money(r.amount)}</b>
            </div>
          ))}
          {rows.length > MAX_SHOWN && <div className="tiny muted" style={{ padding: 8 }}>Showing the first {MAX_SHOWN} rows; all {included.length} ticked rows will be imported.</div>}
          {!rows.length && <div className="small muted" style={{ padding: 8 }}>No transactions recognized with these columns.</div>}
        </div>
      </div>
    </Modal>
  )
}
