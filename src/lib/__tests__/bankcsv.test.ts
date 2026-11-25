import { describe, expect, it } from 'vitest'
import { categorize, detectMapping, importKey, merchantKey, parseAmount, parseCsv, parseDate, rowsToTxns, toImportRows } from '../bankcsv'
import type { BudgetCategory, Txn } from '../../store/types'

const cats: BudgetCategory[] = [
  { id: 'rent', name: 'Rent', emoji: '🏠', planned: 800 }, { id: 'groc', name: 'Groceries', emoji: '🥕', planned: 250 },
  { id: 'out', name: 'Eating out', emoji: '🧋', planned: 80 }, { id: 'tr', name: 'Transport', emoji: '🚌', planned: 60 },
  { id: 'sch', name: 'School', emoji: '📚', planned: 50 }, { id: 'fun', name: 'Fun', emoji: '🎟️', planned: 70 },
]
const run = (csv: string, existing: Txn[] = []) => { const rows = parseCsv(csv); const m = detectMapping(rows); return { m, ...toImportRows(rows, m, cats, existing) } }

describe('parseCsv', () => {
  it('quotes, escaped quotes, commas in fields, CRLF, BOM, blank lines', () => {
    expect(parseCsv('﻿a,"b, c","say ""hi"""\r\n\r\n1,2,3\r\n')).toEqual([['a', 'b, c', 'say "hi"'], ['1', '2', '3']])
  })
  it('semicolon and tab delimited', () => {
    expect(parseCsv('a;b;c\n1;2;3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('values', () => {
  it('dates', () => {
    expect(parseDate('11/20/2026')).toBe('2026-11-20')
    expect(parseDate('20/11/2026')).toBe('2026-11-20') // day > 12 → D/M
    expect(parseDate('03/04/2026', 'dmy')).toBe('2026-04-03')
    expect(parseDate('2026-11-20')).toBe('2026-11-20')
    expect(parseDate('20261120')).toBe('2026-11-20')
    expect(parseDate('Nov 20, 2026')).toBe('2026-11-20')
    expect(parseDate('20-Nov-2026')).toBe('2026-11-20')
    expect(parseDate('11/20/26')).toBe('2026-11-20')
    expect(parseDate('TIM HORTONS')).toBeUndefined()
    expect(parseDate('13/13/2026')).toBeUndefined()
  })
  it('amounts', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56)
    expect(parseAmount('-4.25')).toBe(-4.25)
    expect(parseAmount('(12.00)')).toBe(-12)
    expect(parseAmount('12.50 DR')).toBe(-12.5)
    expect(parseAmount('12.50 CR')).toBe(12.5)
    expect(parseAmount('1 234,56')).toBe(1234.56)
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('4.25-')).toBe(-4.25)
    expect(parseAmount('')).toBeUndefined()
    expect(parseAmount('4500********1234')).toBeUndefined()
  })
})

// Representative layouts (from memory of each bank's export, not official samples)
describe('bank layouts', () => {
  it('RBC-style: header, signed CAD$ column, two description columns', () => {
    const { m, rows } = run([
      '"Account Type","Account Number","Transaction Date","Cheque Number","Description 1","Description 2","CAD$","USD$"',
      'Chequing,01234-5678901,11/20/2026,,"TIM HORTONS #1234","",-4.25,',
      'Chequing,01234-5678901,11/18/2026,,"PAYROLL DEP","CAMPUS CAFE",612.40,',
      'Chequing,01234-5678901,11/17/2026,,"LOBLAWS 1023","",-58.10,',
    ].join('\n'))
    expect(m).toMatchObject({ hasHeader: true, date: 2, description: 4, amount: 6, expensesNegative: true })
    expect(rows.map((r) => [r.date, r.description, r.amount, r.income, r.categoryId])).toEqual([
      ['2026-11-20', 'TIM HORTONS #1234', 4.25, false, 'out'],
      ['2026-11-18', 'PAYROLL DEP', 612.4, true, undefined],
      ['2026-11-17', 'LOBLAWS 1023', 58.1, false, 'groc'],
    ])
  })
  it('TD-style: no header, debit / credit / balance columns', () => {
    const { m, rows } = run([
      '11/20/2026,TIM HORTONS #1234,4.25,,1236.30',
      '11/19/2026,E-TRANSFER RECEIVED,,50.00,1240.55',
      '11/18/2026,PRESTO FARE,3.30,,1190.55',
    ].join('\n'))
    expect(m).toMatchObject({ hasHeader: false, date: 0, description: 1, debit: 2, credit: 3 })
    expect(rows.map((r) => [r.amount, r.income, r.categoryId])).toEqual([[4.25, false, 'out'], [50, true, undefined], [3.3, false, 'tr']])
  })
  it('TD-style with only purchases (empty credit column) still works', () => {
    const { rows } = run('11/20/2026,TIM HORTONS,4.25,,100.00\n11/19/2026,NETFLIX.COM,16.99,,104.25')
    expect(rows.map((r) => [r.amount, r.income, r.categoryId])).toEqual([[4.25, false, 'out'], [16.99, false, 'fun']])
  })
  it('CIBC-style: ISO dates, masked card number column is not the description', () => {
    const { m, rows } = run('2026-11-20,"UBER CANADA/UBERTRIP",14.80,,4500********1234\n2026-11-19,"PAYMENT THANK YOU",,200.00,4500********1234')
    expect(m.description).toBe(1)
    expect(rows[0]).toMatchObject({ description: 'UBER CANADA/UBERTRIP', amount: 14.8, categoryId: 'tr', include: true })
    expect(rows[1]).toMatchObject({ income: true, transfer: true, include: false }) // card payment skipped by default
  })
  it('Tangerine-style: picks Name over the DEBIT/CREDIT Transaction column', () => {
    const { m, rows } = run('Date,Transaction,Name,Memo,Amount\n11/20/2026,DEBIT,CINEPLEX ODEON,Point of sale,-14.50\n11/19/2026,CREDIT,INTEREST PAID,,0.42')
    expect(m.description).toBe(2)
    expect(rows.map((r) => [r.description, r.income, r.categoryId])).toEqual([['CINEPLEX ODEON', false, 'fun'], ['INTEREST PAID', true, undefined]])
  })
  it('credit-card style: purchases positive, payments negative; transaction date beats posting date', () => {
    const { m, rows } = run([
      'Item #,Card #,Transaction Date,Posting Date,Transaction Amount,Description',
      '1,5191********1234,20261120,20261121,23.45,DOORDASH*SUSHI',
      '2,5191********1234,20261118,20261119,-150.00,PAYMENT RECEIVED - THANK YOU',
      '3,5191********1234,20261117,20261118,89.99,PEARSON EDUCATION',
    ].join('\n'))
    expect(m).toMatchObject({ date: 2, amount: 4, description: 5, expensesNegative: false })
    expect(rows.map((r) => [r.date, r.amount, r.income, r.categoryId, r.include])).toEqual([
      ['2026-11-20', 23.45, false, 'out', true], ['2026-11-18', 150, true, undefined, false], ['2026-11-17', 89.99, false, 'sch', true],
    ])
  })
  it('skips junk rows and zero amounts', () => {
    const { rows, skipped } = run('Date,Description,Amount\n11/20/2026,COFFEE,-3.00\nTotal,,-3.00\n11/19/2026,ADJUSTMENT,0.00')
    expect(rows).toHaveLength(1)
    expect(skipped).toBe(2)
  })
})

describe('transfers', () => {
  it('own-account transfers and card payments are skipped by default; Interac e-transfers are kept', () => {
    const { rows } = run('Date,Description,Amount\n11/20/2026,TRANSFER TO SAVINGS,-100\n11/19/2026,E-TRANSFER RECEIVED SAM,40\n11/18/2026,INTERAC E-TRANSFER SENT RENT,-800\n11/17/2026,TFR-TO 1234,-50')
    expect(rows.map((r) => [r.description, r.include])).toEqual([
      ['TRANSFER TO SAVINGS', false], ['E-TRANSFER RECEIVED SAM', true], ['INTERAC E-TRANSFER SENT RENT', true], ['TFR-TO 1234', false],
    ])
  })
})

describe('de-duplication', () => {
  const csv = 'Date,Description,Amount\n11/20/2026,STARBUCKS,-5.25\n11/20/2026,STARBUCKS,-5.25\n11/19/2026,METRO,-20.00'
  it('re-importing the same file adds nothing', () => {
    const first = run(csv)
    const txns = rowsToTxns(first.rows, (() => { let i = 0; return () => String(i++) })())
    expect(txns).toHaveLength(3)
    const again = run(csv, txns)
    expect(again.rows.every((r) => r.duplicate && !r.include)).toBe(true)
  })
  it('two identical purchases are both kept; only already-imported copies are duplicates', () => {
    const existing: Txn[] = [{ id: 'x', date: '2026-11-20', amount: 5.25, note: 'STARBUCKS', importKey: importKey('2026-11-20', 5.25, 'STARBUCKS') }]
    const { rows } = run(csv, existing)
    expect(rows.filter((r) => r.description === 'STARBUCKS').map((r) => r.duplicate)).toEqual([true, false])
  })
})

describe('categorize', () => {
  it('learned merchant rules win; unknown merchants stay uncategorized; missing category names are skipped', () => {
    expect(categorize('SQ *ZEN PRINT SHOP 4421', cats)).toBeUndefined()
    expect(categorize('SQ *ZEN PRINT SHOP 4421', cats, { [merchantKey('SQ *ZEN PRINT 9999')]: 'sch' })).toBe('sch')
    expect(categorize('ROGERS WIRELESS', cats)).toBeUndefined() // no "phone/bills" category in this budget
    expect(categorize('UBER EATS', cats)).toBe('out')
    expect(categorize('UBER TRIP', cats)).toBe('tr')
  })
})
