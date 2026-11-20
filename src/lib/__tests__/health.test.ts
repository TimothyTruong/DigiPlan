import { describe, expect, it, vi } from 'vitest'
import { healthFromHash, HealthPayloadError, parseHealthPayload } from '../health'

vi.mock('idb-keyval', () => ({ createStore: () => ({}), get: async () => undefined, set: async () => {}, del: async () => {} }))
const T = '2026-11-20'

describe('parseHealthPayload', () => {
  it('days array', () => {
    expect(parseHealthPayload('{"days":[{"date":"2026-11-19","steps":8432,"sleep":7.44},{"date":"2026-11-18","steps":"12,005"}]}', T))
      .toEqual([{ date: '2026-11-18', steps: 12005 }, { date: '2026-11-19', steps: 8432, sleep: 7.4 }])
  })
  it('single object, missing date = today', () => { expect(parseHealthPayload('{"steps":5000}', T)).toEqual([{ date: T, steps: 5000 }]) })
  it('query string', () => { expect(parseHealthPayload('date=2026-11-19&steps=9001&sleep=6,5', T)).toEqual([{ date: '2026-11-19', steps: 9001, sleep: 6.5 }]) })
  it('locale numbers and units', () => {
    expect(parseHealthPayload('{"steps":"8.432","sleep":"7,5 hr"}', T)).toEqual([{ date: T, steps: 8432, sleep: 7.5 }])
    expect(parseHealthPayload('{"steps":"3 412 steps"}', T)[0].steps).toBe(3412)
  })
  it('sleep in minutes', () => {
    expect(parseHealthPayload('{"sleepMinutes":450}', T)[0].sleep).toBe(7.5)
    expect(parseHealthPayload('{"sleep":465}', T)[0].sleep).toBe(7.8)
  })
  it('ISO datetime and Shortcuts-style dates', () => {
    expect(parseHealthPayload('{"date":"2026-11-19T23:00:00-05:00","steps":1}', T)[0].date).toBe('2026-11-19')
    expect(parseHealthPayload('{"date":"Nov 18, 2026","steps":1}', T)[0].date).toBe('2026-11-18')
  })
  it('rejects junk, out-of-range and future values', () => {
    expect(() => parseHealthPayload('', T)).toThrow(HealthPayloadError)
    expect(() => parseHealthPayload('hello', T)).toThrow(/doesn’t look/)
    expect(() => parseHealthPayload('{bad json', T)).toThrow(/doesn’t look/)
    expect(() => parseHealthPayload('{"steps":-5,"sleep":3000}', T)).toThrow(/No valid/)
    expect(() => parseHealthPayload('{"date":"2027-01-01","steps":100}', T)).toThrow(/No valid/)
    expect(parseHealthPayload('{"days":[{"steps":999999},{"date":"2026-11-19","steps":10}]}', T)).toEqual([{ date: '2026-11-19', steps: 10 }])
  })
  it('merges duplicate dates and caps payload size', () => {
    expect(parseHealthPayload('[{"date":"2026-11-19","steps":10},{"date":"2026-11-19","sleep":8}]', T)).toEqual([{ date: '2026-11-19', steps: 10, sleep: 8 }])
    const many = JSON.stringify({ days: Array.from({ length: 100 }, (_, i) => ({ date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, steps: i })) })
    expect(parseHealthPayload(many, T).length).toBeLessThanOrEqual(28)
  })
})

describe('healthFromHash', () => {
  it('decodes', () => {
    expect(healthFromHash('#health=' + encodeURIComponent('{"steps":5}'))).toBe('{"steps":5}')
    expect(healthFromHash('#other')).toBeUndefined()
    expect(healthFromHash('#health=%E0%A4%A')).toBe('%E0%A4%A')
  })
})

describe('store: importHealth + auto habits', async () => {
  const { useStore, autoTick } = await import('../../store/store')
  it('imports, marks source, auto-ticks habits, never unticks', () => {
    useStore.setState({ wellness: { [T]: { mood: 4, sleep: 6 } }, habits: [
      { id: 'h1', name: '8k steps', emoji: '👟', perWeek: 7, log: {}, auto: { metric: 'steps', min: 8000 } },
      { id: 'h2', name: 'Sleep 8h', emoji: '😴', perWeek: 7, log: { '2026-11-19': true }, auto: { metric: 'sleep', min: 8 } },
      { id: 'h3', name: 'Read', emoji: '📖', perWeek: 7, log: {} },
    ] })
    const n = useStore.getState().importHealth([{ date: T, steps: 9100, sleep: 7.2 }, { date: '2026-11-19', steps: 3000, sleep: 6 }])
    const s = useStore.getState()
    expect(n).toBe(2)
    expect(s.wellness[T]).toMatchObject({ mood: 4, steps: 9100, sleep: 7.2, fromHealth: expect.arrayContaining(['steps', 'sleep']) })
    expect(s.habits[0].log).toEqual({ [T]: true })
    expect(s.habits[1].log).toEqual({ '2026-11-19': true }) // below goal: manual tick kept, nothing added
    expect(s.habits[2].log).toEqual({})
    expect(s.settings.healthLastSync).toBeGreaterThan(0)
  })
  it('typing water triggers water habit', () => {
    useStore.setState({ habits: [{ id: 'w', name: 'Water', emoji: '💧', perWeek: 7, log: {}, auto: { metric: 'water', min: 8 } }] })
    useStore.getState().setWellness(T, { water: 8 })
    expect(useStore.getState().habits[0].log[T]).toBe(true)
  })
  it('autoTick returns same array when nothing changes', () => {
    const hs = [{ id: 'a', name: 'x', emoji: 'x', perWeek: 7, log: {} }]
    expect(autoTick(hs, {}, [T])).toBe(hs)
  })
})
