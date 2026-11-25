import { differenceInCalendarMonths } from 'date-fns'
import type { Contribution, ISODate, MoneyAccount, SavingsGoal } from '../store/types'
import { fromISO, todayISO } from './dates'

/** Pure money helpers for the Budget → Savings tab (unit-tested). */
export const signedBalance = (a: MoneyAccount) => (a.type === 'credit' ? -Math.abs(a.balance) : a.balance)

export function totals(accounts: MoneyAccount[]) {
  let netWorth = 0, cash = 0, owed = 0, invested = 0
  for (const a of accounts) {
    netWorth += signedBalance(a)
    if (a.type === 'chequing' || a.type === 'savings' || a.type === 'cash') cash += a.balance
    if (a.type === 'credit') owed += Math.abs(a.balance)
    if (a.type === 'investment') invested += a.balance
  }
  return { netWorth: round(netWorth), cash: round(cash), owed: round(owed), invested: round(invested) }
}

export function goalSaved(g: SavingsGoal, accounts: MoneyAccount[]): number {
  if (g.accountId) {
    const a = accounts.find((x) => x.id === g.accountId)
    if (a) return round(Math.max(0, signedBalance(a)))
  }
  return round(g.contributions.reduce((n, c) => n + c.amount, 0))
}

export interface GoalStatus { saved: number; remaining: number; pct: number; monthsLeft?: number; perMonth?: number; overdue: boolean; reached: boolean }

/** Progress, plus how much per month is needed to hit the target date (counting the current month). */
export function goalStatus(g: SavingsGoal, accounts: MoneyAccount[], today: ISODate = todayISO()): GoalStatus {
  const saved = goalSaved(g, accounts)
  const remaining = round(Math.max(0, g.target - saved))
  const pct = g.target > 0 ? Math.min(1, Math.max(0, saved / g.target)) : 0
  const reached = g.target > 0 && saved >= g.target
  if (!g.targetDate) return { saved, remaining, pct, overdue: false, reached }
  const overdue = !reached && g.targetDate < today
  const monthsLeft = Math.max(0, differenceInCalendarMonths(fromISO(g.targetDate), fromISO(today))) + 1
  const perMonth = reached ? 0 : round(remaining / monthsLeft)
  return { saved, remaining, pct, monthsLeft, perMonth, overdue, reached }
}

/** Saved toward goals in a given month (contributions only; account-linked goals move with the balance). */
export function contributedInMonth(goals: SavingsGoal[], month: string): number {
  return round(goals.flatMap((g) => (g.accountId ? [] : g.contributions)).filter((c) => c.date.startsWith(month)).reduce((n, c) => n + c.amount, 0))
}

/** Record a new balance; keeps one history point per day (last write that day wins), newest last, max 120. */
export function withBalance(a: MoneyAccount, balance: number, date: ISODate = todayISO()): MoneyAccount {
  const history = a.history.filter((h) => h.date !== date).concat({ date, balance }).sort((x, y) => (x.date < y.date ? -1 : 1)).slice(-120)
  return { ...a, balance, history }
}

const round = (n: number) => Math.round(n * 100) / 100

export interface SplitSegment { id: string; name: string; emoji: string; saved: number; target: number }
export interface SavingsSplit {
  /** Money in savings-type accounts (0 if the user hasn't added any). */
  pool: number
  totalSaved: number
  totalTarget: number
  /** pool − saved toward goals; negative = more assigned to goals than the savings accounts hold. */
  unassigned: number
  pct: number
  segments: SplitSegment[]
}

/** How savings are split across named goals ("$300 travel, $700 emergency…") plus the total. */
export function savingsSplit(goals: SavingsGoal[], accounts: MoneyAccount[]): SavingsSplit {
  const active = goals.filter((g) => !g.done)
  const segments = active.map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, saved: goalSaved(g, accounts), target: g.target }))
  const totalSaved = round(segments.reduce((n, s) => n + Math.max(0, s.saved), 0))
  const totalTarget = round(segments.reduce((n, s) => n + s.target, 0))
  const pool = round(accounts.filter((a) => a.type === 'savings').reduce((n, a) => n + a.balance, 0))
  return { pool, totalSaved, totalTarget, unassigned: round(pool - totalSaved), pct: totalTarget > 0 ? Math.min(1, totalSaved / totalTarget) : 0, segments }
}

/** Contribution that moves a manual goal to exactly `amount` (keeps the history honest). */
export function setToAmount(g: SavingsGoal, amount: number, date: ISODate, id: string): Contribution | undefined {
  const diff = round(amount - g.contributions.reduce((n, c) => n + c.amount, 0))
  return diff === 0 ? undefined : { id, date, amount: diff, note: 'Adjusted total' }
}
