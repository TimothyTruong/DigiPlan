// Dates are local calendar dates as 'yyyy-MM-dd'; times are 'HH:mm'. No timezones in stored data.
export type ISODate = string
export type HHMM = string

export type ItemKind = 'event' | 'class' | 'task' | 'assignment' | 'exam'
export type Freq = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly'

export interface Recurrence {
  freq: Freq
  until?: ISODate
  byDay?: number[] // 0=Sun..6=Sat, weekly/biweekly only
  exceptions?: ISODate[] // skipped occurrences
}

export interface Step { id: string; text: string; done: boolean }

export interface Item {
  id: string
  kind: ItemKind
  title: string
  date: ISODate
  start?: HHMM
  end?: HHMM
  courseId?: string
  location?: string
  notes?: string
  recurrence?: Recurrence
  done?: boolean // non-recurring
  doneDates?: ISODate[] // recurring
  countdown?: boolean // pin to countdowns
  steps?: Step[]
  weight?: number // % of course grade
  score?: number // % achieved
  gcal?: { calendarId: string; eventId: string } // pushed copy in Google Calendar
  createdAt: number
}

export interface LinkRef { id: string; title: string; url: string }
export interface FileRef { id: string; name: string; size: number; type: string; addedAt: number }
export interface Note { id: string; title: string; body: string; updatedAt: number }

export interface Course {
  id: string
  name: string
  code?: string
  accent: string // hex
  emoji: string
  bannerId?: string // blob id or preset key 'preset:<key>'
  instructor?: string
  room?: string
  links: LinkRef[]
  files: FileRef[]
  notes: Note[]
  targetGrade?: number
  archived?: boolean
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export interface MealEntry { recipeId?: string; text?: string }
export interface Recipe {
  id: string
  name: string
  emoji: string
  imageId?: string
  servings?: number
  prepMins?: number
  ingredients: string[]
  steps: string
  tags: string[]
  favorite?: boolean
}
export interface GroceryItem { id: string; text: string; done: boolean; fromRecipe?: string }

export type WorkoutType = 'strength' | 'cardio' | 'mobility' | 'sport' | 'other'
export interface Exercise { id: string; name: string; sets?: number; reps?: number; weight?: number }
export interface Workout {
  id: string
  date: ISODate
  time?: HHMM
  title: string
  type: WorkoutType
  durationMin?: number
  exercises: Exercise[]
  done: boolean
  notes?: string
}

export interface Habit {
  id: string
  name: string
  emoji: string
  perWeek: number // 1..7
  log: Record<ISODate, true>
  archived?: boolean
}
export interface Wellness { mood?: number; energy?: number; sleep?: number; water?: number }

export interface BudgetCategory { id: string; name: string; emoji: string; planned: number }
export interface Txn { id: string; date: ISODate; amount: number; categoryId?: string; note?: string; income?: boolean }

export type SectionId = 'today' | 'calendar' | 'tasks' | 'classes' | 'meals' | 'fitness' | 'habits' | 'budget' | 'settings'

export interface PageStyle {
  accent: string
  banner: string // 'preset:<key>' | blob id | 'none'
  icon: string // emoji or 'img:<blobId>'
  title?: string
}

export interface Settings {
  name: string
  colorMode: 'system' | 'light' | 'dark'
  weekStartsOn: 0 | 1
  currency: string
  googleClientId?: string
  googleCalendars: { id: string; summary: string; color: string; enabled: boolean }[]
  showGoogle: boolean
  calendarView: 'month' | 'week' | 'list'
  onboarded: boolean
}
