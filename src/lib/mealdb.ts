import type { Recipe } from '../store/types'

/**
 * TheMealDB (https://www.themealdb.com/api.php): free recipe database, CORS-enabled, no OAuth.
 * Key "1" is the public test key for development/education; a production release needs a supporter key
 * via VITE_MEALDB_KEY. Queries go straight from the browser to TheMealDB.
 */
const KEY = (import.meta.env?.VITE_MEALDB_KEY as string | undefined) || '1'
const BASE = `https://www.themealdb.com/api/json/v1/${KEY}`

/** Raw meal record (only the fields we use). Ingredient/measure pairs are strIngredient1..20 / strMeasure1..20. */
export interface MealDbMeal {
  idMeal: string
  strMeal: string
  strMealThumb?: string | null
  strCategory?: string | null
  strArea?: string | null
  strInstructions?: string | null
  strTags?: string | null
  strYoutube?: string | null
  strSource?: string | null
  [k: string]: string | null | undefined
}

/** Lightweight search hit; `full` is present when the endpoint returned complete records (name search, random). */
export interface MealIdea { id: string; name: string; thumb?: string; category?: string; area?: string; full?: MealDbMeal }

export class MealDbError extends Error {}

const cache = new Map<string, unknown>()

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (cache.has(path)) return cache.get(path) as T
  let res: Response
  try { res = await fetch(`${BASE}/${path}`, { signal }) }
  catch (e: any) {
    if (e?.name === 'AbortError') throw e
    throw new MealDbError('Couldn’t reach the recipe database — check your connection')
  }
  if (!res.ok) throw new MealDbError(res.status === 429 ? 'Too many searches — try again in a minute' : `Recipe database error (${res.status})`)
  let data: T
  try { data = await res.json() } catch { throw new MealDbError('Recipe database sent an unexpected response') }
  if (!path.startsWith('random')) cache.set(path, data)
  return data
}

const clean = (s?: string | null) => (s ?? '').trim() || undefined
const toIdea = (m: MealDbMeal): MealIdea => ({
  id: m.idMeal, name: m.strMeal.trim(), thumb: clean(m.strMealThumb), category: clean(m.strCategory), area: clean(m.strArea),
  full: m.strInstructions !== undefined ? m : undefined,
})
const meals = (d: { meals: MealDbMeal[] | null | string } | null | undefined): MealDbMeal[] =>
  Array.isArray(d?.meals) ? d!.meals : [] // API returns {meals: null} or {meals: "no data found"} for no hits

export async function searchByName(q: string, signal?: AbortSignal): Promise<MealIdea[]> {
  if (!q.trim()) return []
  return meals(await get(`search.php?s=${encodeURIComponent(q.trim())}`, signal)).map(toIdea)
}

export async function searchByIngredient(ing: string, signal?: AbortSignal): Promise<MealIdea[]> {
  if (!ing.trim()) return []
  return meals(await get(`filter.php?i=${encodeURIComponent(ing.trim().toLowerCase().replace(/\s+/g, '_'))}`, signal)).map(toIdea)
}

export async function byCategory(cat: string, signal?: AbortSignal): Promise<MealIdea[]> {
  return meals(await get(`filter.php?c=${encodeURIComponent(cat)}`, signal)).map(toIdea)
}

export async function categories(): Promise<string[]> {
  const d = await get<{ meals: { strCategory: string }[] | null }>('list.php?c=list')
  return (d.meals ?? []).map((c) => c.strCategory).filter(Boolean)
}

export async function lookup(id: string, signal?: AbortSignal): Promise<MealDbMeal | undefined> {
  return meals(await get(`lookup.php?i=${encodeURIComponent(id)}`, signal))[0]
}

/** `n` distinct random ideas (the API returns one per call). Failed calls are skipped. */
export async function randomIdeas(n = 8): Promise<MealIdea[]> {
  const settled = await Promise.allSettled(Array.from({ length: n + 3 }, () => get<{ meals: MealDbMeal[] | null }>('random.php')))
  const seen = new Set<string>()
  const out: MealIdea[] = []
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const m of meals(r.value)) if (!seen.has(m.idMeal) && out.length < n) { seen.add(m.idMeal); out.push(toIdea(m)) }
  }
  if (!out.length && settled.every((r) => r.status === 'rejected')) throw (settled[0] as PromiseRejectedResult).reason
  return out
}

const CATEGORY_EMOJI: Record<string, string> = {
  Beef: '🥩', Breakfast: '🍳', Chicken: '🍗', Dessert: '🍰', Goat: '🍖', Lamb: '🍖', Miscellaneous: '🍽️', Pasta: '🍝',
  Pork: '🥓', Seafood: '🦐', Side: '🥗', Starter: '🥟', Vegan: '🥦', Vegetarian: '🥕',
}

/** Convert a full TheMealDB record into a planner Recipe. */
export function toRecipe(m: MealDbMeal, id: string): Recipe {
  const ingredients: string[] = []
  for (let i = 1; i <= 20; i++) {
    const ing = clean(m[`strIngredient${i}`])
    if (!ing) continue
    const measure = clean(m[`strMeasure${i}`])
    ingredients.push(measure ? `${measure} ${ing}` : ing)
  }
  const tags = [m.strCategory, ...(m.strTags ?? '').split(',')].map((t) => clean(t)?.toLowerCase()).filter((t): t is string => !!t)
  const steps = (m.strInstructions ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return {
    id,
    name: m.strMeal.trim(),
    emoji: CATEGORY_EMOJI[m.strCategory ?? ''] ?? '🍽️',
    imageUrl: clean(m.strMealThumb),
    sourceUrl: safeUrl(m.strSource),
    videoUrl: safeUrl(m.strYoutube),
    ingredients,
    steps,
    tags: [...new Set(tags)],
    cuisine: clean(m.strArea),
    external: { provider: 'themealdb', id: m.idMeal },
    addedAt: Date.now(),
  }
}

/** Only http(s) links are stored/rendered as hrefs. */
export function safeUrl(u?: string | null): string | undefined {
  const s = clean(u)
  if (!s) return undefined
  try { const url = new URL(s); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined } catch { return undefined }
}

/** Small thumbnail variant TheMealDB serves for every image (much lighter for grids). */
export const thumbSmall = (url?: string) => (url && url.includes('themealdb.com/images/') ? `${url}/small` : url)

export const _clearCache = () => cache.clear()
