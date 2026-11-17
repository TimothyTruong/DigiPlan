import { describe, expect, it } from 'vitest'
import { expand, occursOn, nextOccurrence, fmtTime } from '../dates'
import { parseIcs, icsToItems } from '../ics'
import { summarize } from '../grades'
import { renderMarkdown, toggleTaskLine } from '../markdown'
import type { Item } from '../../store/types'

const base = (p: Partial<Item>): Item => ({ id: 'x', kind: 'event', title: 't', date: '2026-01-05', createdAt: 0, ...p })

describe('recurrence', () => {
  it('weekly byDay', () => {
    const r = { freq: 'weekly' as const, byDay: [1, 3] } // Mon, Wed; 2026-01-05 is a Monday
    expect(occursOn('2026-01-05', r, '2026-01-07')).toBe(true)
    expect(occursOn('2026-01-05', r, '2026-01-08')).toBe(false)
    expect(occursOn('2026-01-05', r, '2026-01-04')).toBe(false)
  })
  it('biweekly skips odd weeks', () => {
    const r = { freq: 'biweekly' as const }
    expect(occursOn('2026-01-05', r, '2026-01-12')).toBe(false)
    expect(occursOn('2026-01-05', r, '2026-01-19')).toBe(true)
  })
  it('until + exceptions', () => {
    const it = base({ recurrence: { freq: 'daily', until: '2026-01-09', exceptions: ['2026-01-07'] } })
    expect(expand([it], '2026-01-01', '2026-01-31').map((o) => o.date)).toEqual(['2026-01-05', '2026-01-06', '2026-01-08', '2026-01-09'])
  })
  it('monthly / yearly', () => {
    expect(occursOn('2026-01-31', { freq: 'monthly' }, '2026-03-31')).toBe(true)
    expect(occursOn('2026-02-14', { freq: 'yearly' }, '2027-02-14')).toBe(true)
    expect(occursOn('2026-02-14', { freq: 'yearly' }, '2027-03-14')).toBe(false)
  })
  it('sorts all-day first then by time', () => {
    const a = base({ id: 'a', start: '10:00' }), b = base({ id: 'b' }), c = base({ id: 'c', start: '08:00' })
    expect(expand([a, b, c], '2026-01-05', '2026-01-05').map((o) => o.item.id)).toEqual(['b', 'c', 'a'])
  })
  it('nextOccurrence', () => {
    expect(nextOccurrence(base({ recurrence: { freq: 'weekly' } }), '2026-01-06')).toBe('2026-01-12')
    expect(nextOccurrence(base({}), '2026-01-06')).toBeUndefined()
  })
  it('fmtTime', () => { expect(fmtTime('13:30')).toBe('1:30pm'); expect(fmtTime('09:00')).toBe('9am') })
})

describe('ics', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', 'SUMMARY:COMP 2402 Lecture', 'LOCATION:Tory 342',
    'DTSTART;TZID=America/Toronto:20260105T130000', 'DTEND;TZID=America/Toronto:20260105T143000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20260410T235959Z', 'EXDATE;TZID=America/Toronto:20260216T130000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:BIOL Midterm Exam', 'DTSTART;VALUE=DATE:20260220', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Long description', 'DESCRIPTION:line one\\nline', ' two', 'DTSTART:20260301T120000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  it('parses events, rrules, exdates, folding', () => {
    const ev = parseIcs(ics)
    expect(ev).toHaveLength(3)
    expect(ev[0]).toMatchObject({ summary: 'COMP 2402 Lecture', date: '2026-01-05', start: '13:00', end: '14:30', location: 'Tory 342' })
    expect(ev[0].recurrence).toMatchObject({ freq: 'weekly', byDay: [1, 3], exceptions: ['2026-02-16'] })
    expect(ev[1]).toMatchObject({ date: '2026-02-20', start: undefined })
    expect(ev[2].description).toBe('line one\nlinetwo')
  })
  it('classifies kinds', () => {
    let n = 0
    const items = icsToItems(parseIcs(ics), () => String(n++))
    expect(items.map((i) => i.kind)).toEqual(['class', 'exam', 'event'])
  })
})

describe('grades', () => {
  it('current + needed', () => {
    const s = summarize([{ weight: 20, score: 80 }, { weight: 30, score: 90 }, { weight: 50 }], 85)
    expect(s.current).toBeCloseTo(86)
    expect(s.earned).toBeCloseTo(43)
    expect(s.needed).toBeCloseTo(84) // (85 - 43) / 50
  })
  it('nothing graded', () => { expect(summarize([{ weight: 40 }]).current).toBeUndefined() })
})

describe('markdown', () => {
  it('escapes html', () => { expect(renderMarkdown('<script>x</script>')).not.toContain('<script>') })
  it('blocks javascript: links', () => { expect(renderMarkdown('[a](javascript:alert(1))')).not.toContain('href') })
  it('renders tasks and toggles', () => {
    expect(renderMarkdown('- [ ] a')).toContain('type="checkbox"')
    expect(toggleTaskLine('x\n- [ ] a', 1)).toBe('x\n- [x] a')
  })
})
