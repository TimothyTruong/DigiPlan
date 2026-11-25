import type { BudgetCategory, ISODate, Txn } from '../store/types'

/**
 * Bank CSV import, entirely in the browser (the file never leaves the device).
 * Banks disagree on layout (header or not, one signed amount vs. debit/credit columns, M/D/Y vs. ISO dates,
 * credit cards with purchases positive), so columns are *detected* and the UI lets the user correct the mapping.
 */

// ---------- CSV ----------
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '')
  const delim = guessDelimiter(s)
  const rows: string[][] = []
  let row: string[] = [], field = '', q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else q = false }
      else field += c
    } else if (c === '"' && field.trim() === '') { q = true; field = '' }
    else if (c === delim) { row.push(field.trim()); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field.trim()); field = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field.trim())
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

function guessDelimiter(s: string): string {
  const first = s.split(/\r?\n/).slice(0, 5).join('\n')
  const count = (d: string) => first.split(d).length
  return count(';') > count(',') && count(';') > count('\t') ? ';' : count('\t') > count(',') ? '\t' : ','
}

// ---------- values ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export type DateOrder = 'mdy' | 'dmy'
const pad = (n: number) => String(n).padStart(2, '0')
const valid = (y: number, m: number, d: number) => y > 1990 && y < 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31

export function parseDate(v: string, order: DateOrder = 'mdy'): ISODate | undefined {
  const s = v.trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    const [a, b] = [+m[1], +m[2]]
    const [mo, d] = order === 'dmy' || a > 12 ? [b, a] : [a, b]
    if (valid(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]+(\d{4})$/) // 20 Nov 2026 / 20-Nov-2026
  if (m && MONTHS.includes(m[2].toLowerCase())) { const mo = MONTHS.indexOf(m[2].toLowerCase()) + 1; if (valid(+m[3], mo, +m[1])) return `${m[3]}-${pad(mo)}-${pad(+m[1])}` }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/) // Nov 20, 2026
  if (m && MONTHS.includes(m[1].toLowerCase())) { const mo = MONTHS.indexOf(m[1].toLowerCase()) + 1; if (valid(+m[3], mo, +m[2])) return `${m[3]}-${pad(mo)}-${pad(+m[2])}` }
  return undefined
}

/** "$1,234.56", "-12.00", "(12.00)", "12.00 CR", "1 234,56" → number. Empty → undefined. */
export function parseAmount(v: string): number | undefined {
  let s = v.trim()
  if (!s || s === '-') return undefined
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (/\bDR\b/i.test(s)) neg = true
  s = s.replace(/\b(CR|DR|CAD|USD)\b/gi, '').replace(/[$€£\s ]/g, '')
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1) }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1) }
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,56
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.')                             // 12,50
  else s = s.replace(/,/g, '')
  if (!/^\d*\.?\d+$/.test(s)) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? (neg ? -n : n) : undefined
}

// ---------- column detection ----------
export interface Mapping {
  hasHeader: boolean
  date: number
  description: number
  /** One signed amount column, or separate debit (money out) / credit (money in) columns. */
  amount?: number
  debit?: number
  credit?: number
  dateOrder: DateOrder
  /** For signed amounts: are purchases negative (chequing) or positive (most credit cards)? */
  expensesNegative: boolean
}

const HEAD = {
  date: /date|posted|transaction date|date posted/i,
  description: /desc|merchant|payee|name|details/i,
  amount: /amount|cad\$|cad|montant/i,
  debit: /debit|withdraw|money out|paid out/i,
  credit: /credit|deposit|money in|paid in/i,
}

export function detectMapping(rows: string[][]): Mapping {
  const width = Math.max(...rows.slice(0, 20).map((r) => r.length))
  const first = rows[0] ?? []
  const dateLike = (v?: string) => !!v && !!parseDate(v)
  const hasHeader = first.length > 0 && !first.some((v) => dateLike(v)) && rows.slice(1, 6).some((r) => r.some((v) => dateLike(v)))
  const body = rows.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 50)
  const col = (i: number) => body.map((r) => r[i] ?? '')
  const share = (i: number, f: (v: string) => boolean) => { const vs = col(i).filter((v) => v !== ''); return vs.length ? vs.filter(f).length / vs.length : 0 }
  const fill = (i: number) => col(i).filter((v) => v !== '').length / Math.max(1, body.length)
  const head = (i: number) => (hasHeader ? first[i] ?? '' : '')

  const cols = Array.from({ length: width }, (_, i) => i)
  const pick = (cands: number[], score: (i: number) => number) => cands.map((i) => [i, score(i)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0]?.[0]
  const date = pick(cols, (i) => share(i, dateLike) * fill(i) + (HEAD.date.test(head(i)) ? 0.5 : 0) - (/post/i.test(head(i)) ? 0.1 : 0)) ?? 0
  const numeric = cols.filter((i) => i !== date && share(i, (v) => parseAmount(v) !== undefined) > 0.9)
  const byHead = (re: RegExp) => numeric.find((i) => re.test(head(i)))
  let debit = byHead(HEAD.debit), credit = byHead(HEAD.credit)
  let amount = debit === undefined && credit === undefined ? byHead(HEAD.amount) : undefined
  if (amount === undefined && debit === undefined) {
    // No helpful headers. Two sparse complementary columns = debit/credit (TD/CIBC style); else the first numeric.
    const sparse = numeric.filter((i) => fill(i) < 0.95)
    if (sparse.length >= 2) [debit, credit] = sparse
    else amount = numeric.find((i) => !/balance|solde/i.test(head(i)))
  }
  const used = new Set([date, amount, debit, credit].filter((x): x is number => x !== undefined))
  // Description = the column with the most letters (masked card numbers and DEBIT/CREDIT type columns lose).
  const letters = (v: string) => (v.match(/[a-z]/gi) ?? []).length
  const description = pick(cols.filter((i) => !used.has(i) && !/balance|account|card|number|cheque|type|status|filter|^transaction$/i.test(head(i).trim())),
    (i) => col(i).reduce((n, v) => n + (parseAmount(v) === undefined && !dateLike(v) && letters(v) >= 3 ? letters(v) : 0), 0) + (HEAD.description.test(head(i)) ? 1e6 : /memo/i.test(head(i)) ? 1 : 0)) ?? 1
  const dateOrder: DateOrder = col(date).some((v) => { const m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}$/); return !!m && +m[1] > 12 }) ? 'dmy' : 'mdy'
  // Signed column: chequing exports show purchases negative; most credit-card exports show them positive and
  // payments negative. Payment/transfer rows are the best tell; otherwise go with the majority sign.
  let expensesNegative = true
  if (amount !== undefined) {
    const signed = body.map((r) => ({ v: parseAmount(r[amount!] ?? ''), d: r[description] ?? '' })).filter((x): x is { v: number; d: string } => x.v !== undefined && x.v !== 0)
    const payments = signed.filter((x) => TRANSFER_RE.test(x.d) || /payment/i.test(x.d))
    if (payments.length) expensesNegative = !payments.every((x) => x.v < 0)
    else expensesNegative = signed.filter((x) => x.v < 0).length >= signed.filter((x) => x.v > 0).length
  }
  return { hasHeader, date, description, amount, debit, credit, dateOrder, expensesNegative }
}

// ---------- rows → transactions ----------
export interface ImportRow {
  key: string
  date: ISODate
  description: string
  amount: number // positive
  income: boolean
  categoryId?: string
  /** transfers / card payments — skipped by default */
  transfer: boolean
  duplicate: boolean
  include: boolean
}

// Moves between the user's own accounts and card payments (double-counting if imported). Interac e-transfers are
// real money to/from other people, so they are NOT matched.
const TRANSFER_RE = /(?<![-\w])(transfer|tfr|xfer|payment.{0,25}thank you|thank you.*payment|credit card payment|pymt|bill payment.*(visa|mastercard|card)|internet transfer|online transfer)\b/i

export const importKey = (date: string, amount: number, description: string) =>
  `${date}|${amount.toFixed(2)}|${description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`

export function toImportRows(rows: string[][], m: Mapping, categories: BudgetCategory[], existing: Txn[], learned: Record<string, string> = {}): { rows: ImportRow[]; skipped: number } {
  const out: ImportRow[] = []
  let skipped = 0
  // Count-aware de-duplication: two identical coffees on the same day are both real, so compare counts.
  const have = new Map<string, number>()
  for (const t of existing) if (t.importKey) have.set(t.importKey, (have.get(t.importKey) ?? 0) + 1)
  for (const r of rows.slice(m.hasHeader ? 1 : 0)) {
    const date = parseDate(r[m.date] ?? '', m.dateOrder)
    const description = (r[m.description] ?? '').replace(/\s+/g, ' ').trim()
    let signed: number | undefined
    if (m.amount !== undefined) {
      const a = parseAmount(r[m.amount] ?? '')
      signed = a === undefined ? undefined : m.expensesNegative ? a : -a // signed: negative = money out
    } else {
      const d = parseAmount(r[m.debit ?? -1] ?? ''), c = parseAmount(r[m.credit ?? -1] ?? '')
      signed = d ? -Math.abs(d) : c ? Math.abs(c) : d === 0 || c === 0 ? 0 : undefined
    }
    if (!date || signed === undefined || signed === 0 || !description) { skipped++; continue }
    const amount = Math.round(Math.abs(signed) * 100) / 100
    const income = signed > 0
    const key = importKey(date, amount, description)
    const left = have.get(key) ?? 0
    const duplicate = left > 0
    if (duplicate) have.set(key, left - 1)
    const transfer = TRANSFER_RE.test(description)
    out.push({ key, date, description, amount, income, transfer, duplicate, include: !duplicate && !transfer, categoryId: income ? undefined : categorize(description, categories, learned) })
  }
  return { rows: out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1)), skipped }
}

// ---------- categorizing ----------
/** Keyword hints per kind of category; matched against the user's own category names. */
const HINTS: { names: RegExp; merchants: RegExp }[] = [
  { names: /grocer|food(?!.*out)|supermarket/i, merchants: /loblaw|no ?frills|metro|sobeys|food basics|freshco|superstore|walmart|costco|farm boy|t ?& ?t|whole foods|safeway|save[- ]on|independent|zehrs|fortinos|iga|maxi|provigo|giant tiger|grocery|market/i },
  { names: /eat|dining|restaurant|take ?out|coffee|food out/i, merchants: /tim hortons|starbucks|mcdonald|uber ?eats|doordash|skip ?the ?dishes|subway|a ?& ?w|wendy|chipotle|pizza|cafe|coffee|restaurant|sushi|pho|bubble|chatime|shawarma|burger|kfc|popeyes|freshii|harvey|second cup|bar |pub /i },
  { names: /transport|transit|travel|gas|car/i, merchants: /presto|oc ?transpo|ttc|stm|translink|go transit|uber(?! ?eats)|lyft|petro|esso|shell|ultramar|pioneer|husky|gas|parking|via rail|flair|westjet|air canada/i },
  { names: /rent|housing|home/i, merchants: /rent|landlord|property|residence|housing/i },
  { names: /school|tuition|books|education|study/i, merchants: /bookstore|university|college|tuition|chegg|pearson|mcgraw|coursera|campus|indigo|chapters/i },
  { names: /fun|entertain|leisure|subscri|going out/i, merchants: /cineplex|netflix|spotify|disney|crave|apple\.com|steam|playstation|xbox|ticketmaster|eventbrite|landmark|prime video|youtube/i },
  { names: /phone|bill|utilit|internet/i, merchants: /rogers|bell|telus|fido|koodo|virgin|freedom|public mobile|chatr|hydro|enbridge|internet/i },
  { names: /health|pharm|fitness|gym/i, merchants: /shoppers|rexall|pharm|goodlife|fit4less|planet fitness|ymca|dental|clinic|physio/i },
  { names: /shop|cloth|personal/i, merchants: /amazon|winners|h ?& ?m|zara|uniqlo|aritzia|sephora|lululemon|dollarama|canadian tire|ikea|best buy|old navy/i },
]

export const merchantKey = (description: string) => description.toLowerCase().replace(/[0-9#*]+/g, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ')

export function categorize(description: string, categories: BudgetCategory[], learned: Record<string, string> = {}): string | undefined {
  const k = merchantKey(description)
  if (learned[k] && categories.some((c) => c.id === learned[k])) return learned[k]
  for (const h of HINTS) {
    if (!h.merchants.test(description)) continue
    const cat = categories.find((c) => h.names.test(c.name))
    if (cat) return cat.id
  }
  return undefined
}

export function rowsToTxns(rows: ImportRow[], mkId: () => string): Txn[] {
  return rows.filter((r) => r.include).map((r) => ({
    id: mkId(), date: r.date, amount: r.amount, note: r.description, income: r.income || undefined,
    categoryId: r.income ? undefined : r.categoryId, importKey: r.key,
  }))
}
