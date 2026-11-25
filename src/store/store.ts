import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { createStore, del, get, set } from 'idb-keyval'
import { uid } from '../lib/id'
import { addDaysISO, todayISO } from '../lib/dates'
import { SECTIONS } from '../theme/themes'
import type { HealthDay } from '../lib/health'
import type {
  BudgetCategory, MoneyAccount, SavingsGoal, Course, GroceryItem, Habit, ISODate, Item, MealEntry, MealSlot, PageStyle, Recipe,
  SectionId, Settings, Txn, Wellness, Workout,
} from './types'

const idb = createStore('petal-state', 'kv')
// Debounced writes: rapid edits (typing in notes) collapse into one IndexedDB write.
let pending: { name: string; value: string } | null = null
let timer: ReturnType<typeof setTimeout> | undefined
const flush = () => { if (pending) { set(pending.name, pending.value, idb); pending = null } }
if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)
const idbStorage: StateStorage = {
  getItem: async (name) => (await get<string>(name, idb)) ?? null,
  setItem: (name, value) => { pending = { name, value }; clearTimeout(timer); timer = setTimeout(flush, 250) },
  removeItem: (name) => del(name, idb),
}

export interface State {
  settings: Settings
  pages: Record<SectionId, PageStyle>
  items: Item[]
  courses: Course[]
  recipes: Recipe[]
  mealPlan: Record<ISODate, Partial<Record<MealSlot, MealEntry>>>
  grocery: GroceryItem[]
  workouts: Workout[]
  habits: Habit[]
  wellness: Record<ISODate, Wellness>
  categories: BudgetCategory[]
  txns: Txn[]
  accounts: MoneyAccount[]
  goals: SavingsGoal[]
}

interface Actions {
  setSettings: (p: Partial<Settings>) => void
  setPage: (id: SectionId, p: Partial<PageStyle>) => void
  upsertItem: (it: Item) => void
  deleteItem: (id: string) => void
  toggleItem: (id: string, date: ISODate) => void
  skipOccurrence: (id: string, date: ISODate) => void
  addItems: (its: Item[]) => void
  upsertCourse: (c: Course) => void
  deleteCourse: (id: string) => void
  upsertRecipe: (r: Recipe) => void
  deleteRecipe: (id: string) => void
  setMeal: (date: ISODate, slot: MealSlot, e?: MealEntry) => void
  copyWeek: (fromStart: ISODate, toStart: ISODate) => void
  setGrocery: (g: GroceryItem[]) => void
  upsertWorkout: (w: Workout) => void
  deleteWorkout: (id: string) => void
  upsertHabit: (h: Habit) => void
  deleteHabit: (id: string) => void
  toggleHabit: (id: string, date: ISODate) => void
  setWellness: (date: ISODate, w: Partial<Wellness>) => void
  importHealth: (days: HealthDay[]) => number
  setCategories: (c: BudgetCategory[]) => void
  upsertTxn: (t: Txn) => void
  deleteTxn: (id: string) => void
  upsertAccount: (a: MoneyAccount) => void
  deleteAccount: (id: string) => void
  upsertGoal: (g: SavingsGoal) => void
  deleteGoal: (id: string) => void
  replaceAll: (s: Partial<State>) => void
  clearAll: () => void
}

/** Tick habits whose `auto` rule is met on the given dates. Never unticks (a manual tick wins). */
export function autoTick(habits: Habit[], wellness: Record<ISODate, Wellness>, dates: ISODate[]): Habit[] {
  let changed = false
  const out = habits.map((h) => {
    if (!h.auto) return h
    let log = h.log
    for (const d of dates) {
      const v = wellness[d]?.[h.auto.metric]
      if (typeof v === 'number' && v >= h.auto.min && !log[d]) { log = { ...log, [d]: true }; changed = true }
    }
    return log === h.log ? h : { ...h, log }
  })
  return changed ? out : habits
}

/** Combine saved data with defaults. Collections added after a user's data was first saved start empty, never as demo content. */
export function mergePersisted<T extends State>(persisted: unknown, current: T): T {
  const p = (persisted ?? {}) as Partial<State>
  const added = Object.keys(p).length ? { accounts: p.accounts ?? [], goals: p.goals ?? [] } : {}
  return { ...current, ...p, ...added, settings: { ...current.settings, ...p.settings }, pages: { ...defaultPages(), ...p.pages } }
}

const upsert = <T extends { id: string }>(arr: T[], v: T) => {
  const i = arr.findIndex((x) => x.id === v.id)
  if (i < 0) return [...arr, v]
  const next = arr.slice(); next[i] = v; return next
}

const defaultPages = () => Object.fromEntries(SECTIONS.map((s) => [s.id, { ...s.style }])) as Record<SectionId, PageStyle>

export const emptyState = (): State => ({
  settings: {
    name: '', colorMode: 'system', weekStartsOn: 1, currency: '$', googleCalendars: [], showGoogle: true, stepGoal: 8000, sleepGoal: 8,
    calendarView: 'month', onboarded: false,
  },
  pages: defaultPages(),
  items: [], courses: [], recipes: [], mealPlan: {}, grocery: [], workouts: [], habits: [], wellness: {},
  categories: [
    { id: uid(), name: 'Rent', emoji: '🏠', planned: 800 },
    { id: uid(), name: 'Groceries', emoji: '🥕', planned: 250 },
    { id: uid(), name: 'Eating out', emoji: '🧋', planned: 80 },
    { id: uid(), name: 'Transport', emoji: '🚌', planned: 60 },
    { id: uid(), name: 'School', emoji: '📚', planned: 50 },
    { id: uid(), name: 'Fun', emoji: '🎟️', planned: 70 },
  ],
  txns: [],
  accounts: [],
  goals: [],
})

/** Demo content relative to today so a first visit doesn't look empty. Removable in Settings. */
export function demoState(): State {
  const t = todayISO()
  const d = (n: number) => addDaysISO(t, n)
  const s = emptyState()
  const bio: Course = { id: uid(), name: 'Cell Biology', code: 'BIOL 2201', accent: '#9CC19F', emoji: '🔬', bannerId: 'preset:matcha', room: 'Science Hall 120', instructor: 'Dr. Okafor', links: [{ id: uid(), title: 'Course page', url: 'https://example.edu/biol2201' }], files: [], notes: [{ id: uid(), title: 'Week 1 — Membranes', body: '# Membranes\n\n- Phospholipid **bilayer**\n- Fluid mosaic model\n- [ ] Review diagram on p. 42\n\n> Ask about cholesterol’s role in fluidity.', updatedAt: Date.now() }], targetGrade: 85 }
  const cs: Course = { id: uid(), name: 'Data Structures', code: 'COMP 2402', accent: '#A9B2EC', emoji: '💻', bannerId: 'preset:grid', room: 'Tory 342', links: [{ id: uid(), title: 'Assignment repo', url: 'https://github.com' }], files: [], notes: [], targetGrade: 80 }
  const psy: Course = { id: uid(), name: 'Intro Psychology', code: 'PSYC 1001', accent: '#E9A3B4', emoji: '🧠', bannerId: 'preset:cotton', links: [], files: [], notes: [] }
  s.courses = [bio, cs, psy]
  const now = Date.now()
  s.items = [
    { id: uid(), kind: 'class', title: 'Cell Biology lecture', courseId: bio.id, date: d(-14), start: '10:00', end: '11:30', location: bio.room, recurrence: { freq: 'weekly', byDay: [1, 3] }, createdAt: now },
    { id: uid(), kind: 'class', title: 'Data Structures', courseId: cs.id, date: d(-14), start: '13:00', end: '14:30', location: cs.room, recurrence: { freq: 'weekly', byDay: [2, 4] }, createdAt: now },
    { id: uid(), kind: 'class', title: 'Psych tutorial', courseId: psy.id, date: d(-14), start: '15:00', end: '16:00', recurrence: { freq: 'weekly', byDay: [5] }, createdAt: now },
    { id: uid(), kind: 'assignment', title: 'Lab report 3', courseId: bio.id, date: d(3), start: '23:59', weight: 10, steps: [{ id: uid(), text: 'Analyze data', done: true }, { id: uid(), text: 'Write methods', done: false }, { id: uid(), text: 'Discussion + refs', done: false }], createdAt: now },
    { id: uid(), kind: 'exam', title: 'Midterm', courseId: bio.id, date: d(12), start: '09:00', end: '11:00', location: 'Gym B', weight: 30, countdown: true, createdAt: now },
    { id: uid(), kind: 'exam', title: 'Final exam', courseId: cs.id, date: d(34), start: '14:00', weight: 40, countdown: true, createdAt: now },
    { id: uid(), kind: 'assignment', title: 'A2 — Hash tables', courseId: cs.id, date: d(6), weight: 15, createdAt: now },
    { id: uid(), kind: 'assignment', title: 'A1 — Linked lists', courseId: cs.id, date: d(-10), weight: 15, score: 88, done: true, createdAt: now },
    { id: uid(), kind: 'assignment', title: 'Lab report 2', courseId: bio.id, date: d(-4), weight: 10, score: 92, done: true, createdAt: now },
    { id: uid(), kind: 'task', title: 'Email TA about extension', date: d(-1), createdAt: now },
    { id: uid(), kind: 'task', title: 'Print readings', date: t, createdAt: now },
    { id: uid(), kind: 'event', title: 'Mom’s birthday 🎂', date: d(20), recurrence: { freq: 'yearly' }, countdown: true, createdAt: now },
    { id: uid(), kind: 'event', title: 'Study group', date: t, start: '18:00', end: '19:30', location: 'Library 3F', createdAt: now },
  ]
  const oats: Recipe = { id: uid(), name: 'Overnight oats', emoji: '🥣', servings: 1, prepMins: 5, ingredients: ['1/2 cup oats', '1/2 cup milk', '1 tbsp chia seeds', 'Berries', 'Honey'], steps: 'Mix everything in a jar. Fridge overnight. Top with berries.', tags: ['breakfast', 'meal prep'], favorite: true, rating: 5, notes: 'Peanut butter swirl is elite.', addedAt: now - 3e8 }
  const bowl: Recipe = { id: uid(), name: 'Teriyaki salmon bowl', emoji: '🍣', servings: 2, prepMins: 25, ingredients: ['2 salmon fillets', '1 cup rice', 'Teriyaki sauce', 'Edamame', 'Cucumber', 'Sesame seeds'], steps: '1. Cook rice.\n2. Glaze salmon, bake 12 min at 200°C.\n3. Assemble bowls.', tags: ['dinner', 'high protein'], cuisine: 'Japanese', rating: 4, favorite: true, addedAt: now - 2e8 }
  const pasta: Recipe = { id: uid(), name: 'Pesto pasta', emoji: '🍝', servings: 3, prepMins: 15, ingredients: ['250g pasta', '1/2 jar pesto', 'Cherry tomatoes', 'Parmesan', 'Spinach'], steps: 'Boil pasta. Stir through pesto, spinach and tomatoes.', tags: ['dinner', 'budget'], cuisine: 'Italian', addedAt: now - 1e8 }
  s.recipes = [oats, bowl, pasta]
  s.mealPlan = { [t]: { breakfast: { recipeId: oats.id }, lunch: { text: 'Leftover pasta' }, dinner: { recipeId: bowl.id } }, [d(1)]: { breakfast: { recipeId: oats.id }, dinner: { recipeId: pasta.id } } }
  s.grocery = [{ id: uid(), text: 'Oat milk', done: false }, { id: uid(), text: 'Bananas', done: true }, { id: uid(), text: 'Salmon', done: false, fromRecipe: bowl.id }]
  s.workouts = [
    { id: uid(), date: t, time: '07:30', title: 'Lower body', type: 'strength', durationMin: 45, done: false, exercises: [{ id: uid(), name: 'Squats', sets: 3, reps: 10, weight: 40 }, { id: uid(), name: 'RDLs', sets: 3, reps: 10, weight: 30 }, { id: uid(), name: 'Hip thrusts', sets: 3, reps: 12, weight: 50 }] },
    { id: uid(), date: d(-2), title: 'Easy run', type: 'cardio', durationMin: 30, done: true, exercises: [] },
    { id: uid(), date: d(2), title: 'Pilates', type: 'mobility', durationMin: 40, done: false, exercises: [] },
  ]
  const log = (days: number[]) => Object.fromEntries(days.map((n) => [d(-n), true as const]))
  s.habits = [
    { id: uid(), name: 'Drink 8 glasses', emoji: '💧', perWeek: 7, log: log([1, 2, 3, 5, 6]) },
    { id: uid(), name: 'Gym', emoji: '💪', perWeek: 3, log: log([2, 4, 7, 9]) },
    { id: uid(), name: 'Read 20 pages', emoji: '📖', perWeek: 5, log: log([1, 3, 4]) },
  ]
  for (let i = 1; i < 26; i++) {
    if (i % 6 === 0) continue
    s.wellness[d(-i)] = { mood: 2 + ((i * 7) % 4), energy: 2 + ((i * 5) % 4), sleep: 6 + ((i * 3) % 4) * 0.5, water: 4 + (i % 5), steps: 4200 + ((i * 2731) % 7600) }
  }
  s.wellness[t] = { steps: 5240, sleep: 7.5 }
  s.habits.push({ id: uid(), name: '8k steps', emoji: '👟', perWeek: 5, log: log([1, 3, 4]), auto: { metric: 'steps', min: 8000 } })
  const [rent, groc, out] = s.categories
  const mo = t.slice(0, 8)
  s.txns = [
    { id: uid(), date: `${mo}01`, amount: 1400, income: true, note: 'Part-time job' },
    { id: uid(), date: `${mo}01`, amount: 800, categoryId: rent.id, note: 'Rent' },
    { id: uid(), date: d(-3) > `${mo}01` ? d(-3) : `${mo}01`, amount: 64.2, categoryId: groc.id, note: 'Weekly shop' },
    { id: uid(), date: t, amount: 7.5, categoryId: out.id, note: 'Bubble tea' },
  ]
  const chq: MoneyAccount = { id: uid(), name: 'Chequing', emoji: '🏦', type: 'chequing', balance: 1240.55, history: [{ date: d(-30), balance: 980 }, { date: d(-14), balance: 1510 }, { date: t, balance: 1240.55 }] }
  const sav: MoneyAccount = { id: uid(), name: 'Savings', emoji: '🐷', type: 'savings', balance: 3200, history: [{ date: d(-60), balance: 2600 }, { date: d(-30), balance: 2900 }, { date: t, balance: 3200 }] }
  const card: MoneyAccount = { id: uid(), name: 'Student card', emoji: '💳', type: 'credit', balance: 186.4, history: [{ date: t, balance: 186.4 }] }
  s.accounts = [chq, sav, card]
  s.goals = [
    { id: uid(), name: 'Emergency fund', emoji: '🛟', target: 5000, accountId: sav.id, contributions: [] },
    { id: uid(), name: 'Reading week trip', emoji: '✈️', target: 900, targetDate: d(95), contributions: [{ id: uid(), date: d(-40), amount: 150 }, { id: uid(), date: d(-10), amount: 120 }] },
    { id: uid(), name: 'New laptop', emoji: '💻', target: 1400, targetDate: d(200), contributions: [{ id: uid(), date: d(-5), amount: 100 }] },
  ]
  s.settings.onboarded = false
  s.settings.demo = true
  return s
}

export const useStore = create<State & Actions>()(
  persist(
    (setState) => {
      const mut = (fn: (s: State) => Partial<State>) => setState((s) => fn(s))
      return {
        ...demoState(),
        setSettings: (p) => mut((s) => ({ settings: { ...s.settings, ...p } })),
        setPage: (id, p) => mut((s) => ({ pages: { ...s.pages, [id]: { ...s.pages[id], ...p } } })),
        upsertItem: (it) => mut((s) => ({ items: upsert(s.items, it) })),
        deleteItem: (id) => mut((s) => ({ items: s.items.filter((i) => i.id !== id) })),
        addItems: (its) => mut((s) => ({ items: [...s.items, ...its] })),
        toggleItem: (id, date) => mut((s) => ({
          items: s.items.map((i) => {
            if (i.id !== id) return i
            if (!i.recurrence) return { ...i, done: !i.done }
            const dd = i.doneDates ?? []
            return { ...i, doneDates: dd.includes(date) ? dd.filter((x) => x !== date) : [...dd, date] }
          }),
        })),
        skipOccurrence: (id, date) => mut((s) => ({
          items: s.items.map((i) => i.id === id && i.recurrence
            ? { ...i, recurrence: { ...i.recurrence, exceptions: [...(i.recurrence.exceptions ?? []), date] } } : i),
        })),
        upsertCourse: (c) => mut((s) => ({ courses: upsert(s.courses, c) })),
        deleteCourse: (id) => mut((s) => ({
          courses: s.courses.filter((c) => c.id !== id),
          items: s.items.map((i) => (i.courseId === id ? { ...i, courseId: undefined } : i)),
        })),
        upsertRecipe: (r) => mut((s) => ({ recipes: upsert(s.recipes, r) })),
        deleteRecipe: (id) => mut((s) => ({ recipes: s.recipes.filter((r) => r.id !== id) })),
        setMeal: (date, slot, e) => mut((s) => {
          const day = { ...(s.mealPlan[date] ?? {}) }
          if (e && (e.recipeId || e.text?.trim())) day[slot] = e
          else delete day[slot]
          return { mealPlan: { ...s.mealPlan, [date]: day } }
        }),
        copyWeek: (fromStart, toStart) => mut((s) => {
          const mp = { ...s.mealPlan }
          for (let i = 0; i < 7; i++) {
            const src = mp[addDaysISO(fromStart, i)]
            if (src) mp[addDaysISO(toStart, i)] = { ...src }
          }
          return { mealPlan: mp }
        }),
        setGrocery: (g) => mut(() => ({ grocery: g })),
        upsertWorkout: (w) => mut((s) => ({ workouts: upsert(s.workouts, w) })),
        deleteWorkout: (id) => mut((s) => ({ workouts: s.workouts.filter((w) => w.id !== id) })),
        upsertHabit: (h) => mut((s) => ({ habits: upsert(s.habits, h) })),
        deleteHabit: (id) => mut((s) => ({ habits: s.habits.filter((h) => h.id !== id) })),
        toggleHabit: (id, date) => mut((s) => ({
          habits: s.habits.map((h) => {
            if (h.id !== id) return h
            const log = { ...h.log }
            if (log[date]) delete log[date]; else log[date] = true
            return { ...h, log }
          }),
        })),
        setWellness: (date, w) => mut((s) => {
          const wellness = { ...s.wellness, [date]: { ...s.wellness[date], ...w } }
          return { wellness, habits: autoTick(s.habits, wellness, [date]) }
        }),
        importHealth: (days) => {
          let n = 0
          mut((s) => {
            const wellness = { ...s.wellness }
            for (const d of days) {
              const cur = wellness[d.date] ?? {}
              const fromHealth = new Set(cur.fromHealth ?? [])
              const next = { ...cur }
              if (d.steps !== undefined) { next.steps = d.steps; fromHealth.add('steps') }
              if (d.sleep !== undefined) { next.sleep = d.sleep; fromHealth.add('sleep') }
              next.fromHealth = [...fromHealth]
              wellness[d.date] = next
              n++
            }
            return { wellness, habits: autoTick(s.habits, wellness, days.map((d) => d.date)), settings: { ...s.settings, healthLastSync: Date.now() } }
          })
          return n
        },
        setCategories: (c) => mut(() => ({ categories: c })),
        upsertTxn: (t) => mut((s) => ({ txns: upsert(s.txns, t) })),
        deleteTxn: (id) => mut((s) => ({ txns: s.txns.filter((t) => t.id !== id) })),
        upsertAccount: (a) => mut((s) => ({ accounts: upsert(s.accounts, a) })),
        deleteAccount: (id) => mut((s) => ({
          accounts: s.accounts.filter((a) => a.id !== id),
          goals: s.goals.map((g) => (g.accountId === id ? { ...g, accountId: undefined } : g)),
        })),
        upsertGoal: (g) => mut((s) => ({ goals: upsert(s.goals, g) })),
        deleteGoal: (id) => mut((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),
        replaceAll: (p) => mut(() => ({ ...emptyState(), ...p, settings: { ...emptyState().settings, ...p.settings, demo: false } })),
        clearAll: () => mut((s) => ({ ...emptyState(), settings: { ...emptyState().settings, ...s.settings, onboarded: true, demo: false }, pages: s.pages })),
      }
    },
    {
      name: 'petal',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => {
        const { settings, pages, items, courses, recipes, mealPlan, grocery, workouts, habits, wellness, categories, txns, accounts, goals } = s
        return { settings, pages, items, courses, recipes, mealPlan, grocery, workouts, habits, wellness, categories, txns, accounts, goals }
      },
      merge: (persisted, current) => mergePersisted(persisted, current),
    },
  ),
)

export const exportData = (): State => {
  const s = useStore.getState()
  const { settings, pages, items, courses, recipes, mealPlan, grocery, workouts, habits, wellness, categories, txns, accounts, goals } = s
  return { settings, pages, items, courses, recipes, mealPlan, grocery, workouts, habits, wellness, categories, txns, accounts, goals }
}
