import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/mealdb-lookup-52772.json'
import { _clearCache, categories, lookup, MealDbError, randomIdeas, safeUrl, searchByIngredient, searchByName, thumbSmall, toRecipe, type MealDbMeal } from '../mealdb'

const meal = fixture.meals[0] as unknown as MealDbMeal
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => { _clearCache(); fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => vi.unstubAllGlobals())

describe('toRecipe (real TheMealDB record)', () => {
  const r = toRecipe(meal, 'r1')
  it('maps core fields', () => {
    expect(r).toMatchObject({ id: 'r1', name: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', emoji: '🍗', external: { provider: 'themealdb', id: '52772' } })
    expect(r.imageUrl).toMatch(/^https:\/\/www\.themealdb\.com\/images\//)
    expect(r.videoUrl).toMatch(/youtube\.com/)
  })
  it('pairs measures with ingredients and skips blanks', () => {
    expect(r.ingredients[0]).toBe('3/4 cup soy sauce')
    expect(r.ingredients.every((i) => i.trim().length > 0)).toBe(true)
    expect(r.ingredients.length).toBe(9)
  })
  it('tags = category + strTags, lowercased, deduped', () => { expect(r.tags).toEqual(['chicken', 'meat', 'casserole']) })
  it('normalizes CRLF instructions', () => { expect(r.steps).not.toContain('\r') })
  it('handles sparse records', () => {
    const s = toRecipe({ idMeal: '1', strMeal: ' Toast ', strIngredient1: 'bread', strMeasure1: ' ', strIngredient2: '', strTags: null }, 'x')
    expect(s).toMatchObject({ name: 'Toast', ingredients: ['bread'], tags: [], emoji: '🍽️', steps: '' })
    expect(s.imageUrl).toBeUndefined()
  })
})

describe('safeUrl / thumbSmall', () => {
  it('rejects non-http links', () => {
    expect(safeUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeUrl('not a url')).toBeUndefined()
    expect(safeUrl(' https://a.com/x ')).toBe('https://a.com/x')
    expect(safeUrl(null)).toBeUndefined()
  })
  it('only rewrites TheMealDB images', () => {
    expect(thumbSmall('https://www.themealdb.com/images/media/meals/a.jpg')).toMatch(/\/small$/)
    expect(thumbSmall('https://example.com/a.jpg')).toBe('https://example.com/a.jpg')
  })
})

describe('API calls', () => {
  it('search by name returns full records; encodes query', async () => {
    fetchMock.mockResolvedValue(ok(fixture))
    const res = await searchByName('teriyaki & rice')
    expect(fetchMock.mock.calls[0][0]).toContain('search.php?s=teriyaki%20%26%20rice')
    expect(res[0]).toMatchObject({ id: '52772', name: 'Teriyaki Chicken Casserole', category: 'Chicken' })
    expect(res[0].full).toBeDefined()
  })
  it('empty query → no request', async () => {
    expect(await searchByName('  ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('no hits: {meals:null} and {meals:"no data found"} both → []', async () => {
    fetchMock.mockResolvedValueOnce(ok({ meals: null })).mockResolvedValueOnce(ok({ meals: 'no data found' }))
    expect(await searchByName('zzz')).toEqual([])
    expect(await searchByIngredient('zzz')).toEqual([])
  })
  it('ingredient search uses underscores; partial records have no `full`', async () => {
    fetchMock.mockResolvedValue(ok({ meals: [{ idMeal: '9', strMeal: 'X', strMealThumb: 'https://t' }] }))
    const res = await searchByIngredient('Chicken Breast')
    expect(fetchMock.mock.calls[0][0]).toContain('filter.php?i=chicken_breast')
    expect(res[0].full).toBeUndefined()
  })
  it('caches identical queries', async () => {
    fetchMock.mockResolvedValue(ok(fixture))
    await lookup('52772'); await lookup('52772')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('network failure → friendly MealDbError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(searchByName('a')).rejects.toBeInstanceOf(MealDbError)
    await expect(searchByName('a')).rejects.toThrow(/connection/)
  })
  it('429 and 500 → MealDbError; errors are not cached', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429 } as Response)
    await expect(categories()).rejects.toThrow(/Too many/)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response)
    await expect(categories()).rejects.toThrow(/500/)
    fetchMock.mockResolvedValueOnce(ok({ meals: [{ strCategory: 'Pasta' }] }))
    expect(await categories()).toEqual(['Pasta'])
  })
  it('bad JSON → MealDbError', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('x') } } as unknown as Response)
    await expect(lookup('1')).rejects.toThrow(/unexpected/)
  })
  it('aborts propagate as AbortError (not a user-facing error)', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    await expect(searchByName('a')).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('randomIdeas: dedupes, caps at n, tolerates some failures, never cached', async () => {
    let i = 0
    fetchMock.mockImplementation(async () => {
      i++
      if (i === 2) throw new TypeError('flaky')
      return ok({ meals: [{ ...meal, idMeal: String(i % 3) }] }) // only 3 distinct ids
    })
    const res = await randomIdeas(5)
    expect(new Set(res.map((r) => r.id)).size).toBe(res.length)
    expect(res.length).toBeLessThanOrEqual(5)
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })
  it('randomIdeas: all calls fail → throws', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    await expect(randomIdeas(3)).rejects.toBeInstanceOf(MealDbError)
  })
})
