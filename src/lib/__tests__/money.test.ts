import { describe, expect, it, vi } from 'vitest'
vi.mock('idb-keyval', () => ({ createStore: () => ({}), get: async () => undefined, set: async () => {}, del: async () => {} }))
import { contributedInMonth, goalSaved, goalStatus, totals, withBalance } from '../money'
import type { MoneyAccount, SavingsGoal } from '../../store/types'

const acct = (p: Partial<MoneyAccount>): MoneyAccount => ({ id: 'a', name: 'A', emoji: '🏦', type: 'chequing', balance: 0, history: [], ...p })
const goal = (p: Partial<SavingsGoal>): SavingsGoal => ({ id: 'g', name: 'G', emoji: '🎯', target: 1000, contributions: [], ...p })
const T = '2026-11-25'

describe('totals', () => {
  it('credit counts as owed and reduces net worth', () => {
    const r = totals([acct({ balance: 1200.5 }), acct({ id: 's', type: 'savings', balance: 3000 }), acct({ id: 'c', type: 'credit', balance: 450.25 }), acct({ id: 'i', type: 'investment', balance: 500 })])
    expect(r).toEqual({ netWorth: 4250.25, cash: 4200.5, owed: 450.25, invested: 500 })
  })
  it('credit entered as negative is still owed', () => { expect(totals([acct({ type: 'credit', balance: -100 })]).netWorth).toBe(-100) })
  it('empty', () => { expect(totals([])).toEqual({ netWorth: 0, cash: 0, owed: 0, invested: 0 }) })
})

describe('goals', () => {
  it('contribution-based progress incl. withdrawals', () => {
    const g = goal({ contributions: [{ id: '1', date: '2026-10-01', amount: 300 }, { id: '2', date: '2026-11-03', amount: 250 }, { id: '3', date: '2026-11-20', amount: -50 }] })
    expect(goalSaved(g, [])).toBe(500)
    expect(contributedInMonth([g], '2026-11')).toBe(200)
  })
  it('account-linked goal follows the balance (never negative); missing account falls back to contributions', () => {
    const s = acct({ id: 's', type: 'savings', balance: 750 })
    expect(goalSaved(goal({ accountId: 's' }), [s])).toBe(750)
    expect(goalSaved(goal({ accountId: 'c' }), [acct({ id: 'c', type: 'credit', balance: 200 })])).toBe(0)
    expect(goalSaved(goal({ accountId: 'gone', contributions: [{ id: '1', date: T, amount: 40 }] }), [])).toBe(40)
    expect(contributedInMonth([goal({ accountId: 's', contributions: [{ id: '1', date: T, amount: 99 }] })], '2026-11')).toBe(0)
  })
  it('monthly amount needed counts the current month', () => {
    const st = goalStatus(goal({ target: 1200, targetDate: '2027-02-15', contributions: [{ id: '1', date: T, amount: 200 }] }), [], T)
    expect(st).toMatchObject({ saved: 200, remaining: 1000, monthsLeft: 4, perMonth: 250, overdue: false, reached: false })
    expect(st.pct).toBeCloseTo(1 / 6)
  })
  it('reached, overdue, no date, zero target', () => {
    expect(goalStatus(goal({ target: 100, contributions: [{ id: '1', date: T, amount: 150 }] }), [], T)).toMatchObject({ reached: true, pct: 1, remaining: 0 })
    expect(goalStatus(goal({ targetDate: '2026-10-01' }), [], T)).toMatchObject({ overdue: true, monthsLeft: 1, perMonth: 1000 })
    expect(goalStatus(goal({}), [], T).perMonth).toBeUndefined()
    expect(goalStatus(goal({ target: 0 }), [], T)).toMatchObject({ pct: 0, reached: false })
  })
})

describe('withBalance', () => {
  it('one history point per day, sorted, capped', () => {
    let a = acct({ balance: 10, history: [{ date: '2026-11-01', balance: 10 }] })
    a = withBalance(a, 20, '2026-11-25'); a = withBalance(a, 25, '2026-11-25'); a = withBalance(a, 5, '2026-11-10')
    expect(a.balance).toBe(5)
    expect(a.history).toEqual([{ date: '2026-11-01', balance: 10 }, { date: '2026-11-10', balance: 5 }, { date: '2026-11-25', balance: 25 }])
    for (let i = 0; i < 200; i++) a = withBalance(a, i, `2027-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`)
    expect(a.history.length).toBeLessThanOrEqual(120)
  })
})

describe('loading saved data from before accounts existed', async () => {
  const { mergePersisted, demoState } = await import('../../store/store')
  it('existing users get empty accounts/goals, not demo balances', () => {
    const demo = demoState()
    const saved = { items: [], settings: { name: 'Tim' } }
    const merged = mergePersisted(saved, demo)
    expect(merged.accounts).toEqual([])
    expect(merged.goals).toEqual([])
    expect(merged.settings.name).toBe('Tim')
  })
  it('first visit (nothing saved) keeps the demo', () => {
    const demo = demoState()
    expect(mergePersisted(undefined, demo).accounts.length).toBeGreaterThan(0)
  })
  it('saved accounts are kept', () => {
    const demo = demoState()
    const accounts = [{ id: 'x', name: 'Mine', emoji: '🏦', type: 'chequing' as const, balance: 5, history: [] }]
    expect(mergePersisted({ accounts }, demo).accounts).toEqual(accounts)
  })
})

describe('savingsSplit', async () => {
  const { savingsSplit, setToAmount } = await import('../money')
  const sav = acct({ id: 's', type: 'savings', balance: 1500 })
  const chq = acct({ id: 'c', type: 'chequing', balance: 900 })
  const travel = goal({ id: 't', name: 'Travel', target: 300, contributions: [{ id: '1', date: T, amount: 300 }] })
  const emerg = goal({ id: 'e', name: 'Emergency', target: 1000, contributions: [{ id: '1', date: T, amount: 700 }] })
  it('splits savings into named goals with totals and unassigned money', () => {
    const s = savingsSplit([travel, emerg, goal({ id: 'd', done: true, contributions: [{ id: '1', date: T, amount: 50 }] })], [sav, chq])
    expect(s).toMatchObject({ pool: 1500, totalSaved: 1000, totalTarget: 1300, unassigned: 500 })
    expect(s.segments.map((x) => [x.name, x.saved])).toEqual([['Travel', 300], ['Emergency', 700]]) // completed goals excluded
    expect(s.pct).toBeCloseTo(1000 / 1300)
  })
  it('flags over-assignment; no savings accounts → pool 0', () => {
    expect(savingsSplit([travel, emerg], [acct({ id: 's', type: 'savings', balance: 600 })]).unassigned).toBe(-400)
    expect(savingsSplit([travel], []).pool).toBe(0)
    expect(savingsSplit([], []).pct).toBe(0)
  })
  it('setToAmount adds the difference, or nothing', () => {
    expect(setToAmount(emerg, 900, T, 'x')).toEqual({ id: 'x', date: T, amount: 200, note: 'Adjusted total' })
    expect(setToAmount(emerg, 650.5, T, 'x')!.amount).toBe(-49.5)
    expect(setToAmount(emerg, 700, T, 'x')).toBeUndefined()
  })
})
