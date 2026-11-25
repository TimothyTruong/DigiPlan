import type { PageStyle, SectionId } from '../store/types'

/** Pastel accents. Everything else (soft fills, ink, borders) is derived with color-mix in CSS, so any custom hex works in light & dark. */
export const ACCENTS: { key: string; name: string; hex: string }[] = [
  { key: 'blush', name: 'Blush', hex: '#E9A3B4' },
  { key: 'peach', name: 'Peach', hex: '#F2B48C' },
  { key: 'butter', name: 'Butter', hex: '#E8C872' },
  { key: 'sage', name: 'Sage', hex: '#9CC19F' },
  { key: 'mint', name: 'Mint', hex: '#8ED3C2' },
  { key: 'sky', name: 'Sky', hex: '#9CC3E8' },
  { key: 'periwinkle', name: 'Periwinkle', hex: '#A9B2EC' },
  { key: 'lilac', name: 'Lilac', hex: '#BCA7E4' },
  { key: 'mauve', name: 'Mauve', hex: '#CFA3C0' },
  { key: 'clay', name: 'Clay', hex: '#D4AE9C' },
  { key: 'stone', name: 'Stone', hex: '#BBB2A8' },
]

export const BANNERS: Record<string, { name: string; css: string }> = {
  cotton: { name: 'Cotton candy', css: 'linear-gradient(120deg,#FBE3EA 0%,#EDE6FB 55%,#E1EEFB 100%)' },
  matcha: { name: 'Matcha latte', css: 'linear-gradient(120deg,#E4F0DF 0%,#F6F0DC 60%,#FBE9DD 100%)' },
  sunset: { name: 'Peach sunset', css: 'linear-gradient(120deg,#FDE6D6 0%,#FBDCE4 50%,#EBDDF6 100%)' },
  lavender: { name: 'Lavender haze', css: 'radial-gradient(circle at 20% 30%,#EADFFB 0,transparent 45%),radial-gradient(circle at 80% 60%,#DCE8FB 0,transparent 50%),#F5F1FC' },
  seaglass: { name: 'Sea glass', css: 'linear-gradient(120deg,#DDF3EE 0%,#E2EEF9 60%,#EEE9FB 100%)' },
  butter: { name: 'Butter', css: 'radial-gradient(circle at 75% 20%,#FFF3C9 0,transparent 50%),linear-gradient(120deg,#FFF8E5,#FCEFE3)' },
  dots: { name: 'Polka', css: 'radial-gradient(#F3CBD6 1.6px,transparent 1.7px) 0 0/18px 18px,#FDF3F6' },
  grid: { name: 'Graph paper', css: 'linear-gradient(#E6E2F3 1px,transparent 1px) 0 0/22px 22px,linear-gradient(90deg,#E6E2F3 1px,transparent 1px) 0 0/22px 22px,#FAF9FD' },
  stripes: { name: 'Ribbon', css: 'repeating-linear-gradient(135deg,#FBE9EE 0 14px,#FFF6F8 14px 28px)' },
  sky: { name: 'Cloudy sky', css: 'radial-gradient(ellipse at 30% 80%,#fff 0,transparent 40%),radial-gradient(ellipse at 70% 30%,#fff 0,transparent 35%),linear-gradient(180deg,#D7E8F8,#EEF5FC)' },
}

export const EMOJI_PRESETS = ['🌷', '🌸', '🍓', '🍑', '🌼', '🌿', '🍵', '🫧', '☁️', '🌙', '⭐', '🎀', '📚', '📓', '✏️', '🧠', '🔬', '🧪', '📐', '💻', '🎨', '🎧', '🥗', '🍳', '🧁', '🏃‍♀️', '🧘‍♀️', '💪', '💧', '💸', '🗓️', '✅', '🕯️', '🪴', '🐚', '🦋']

export interface SectionDef { id: SectionId; label: string; path: string; style: PageStyle; blurb: string }

export const SECTIONS: SectionDef[] = [
  { id: 'today', label: 'Today', path: '/', blurb: 'Everything today needs, on one page.', style: { accent: '#E9A3B4', banner: 'preset:cotton', icon: '🌷' } },
  { id: 'calendar', label: 'Calendar', path: '/calendar', blurb: 'Classes, deadlines and plans.', style: { accent: '#A9B2EC', banner: 'preset:lavender', icon: '🗓️' } },
  { id: 'tasks', label: 'Tasks', path: '/tasks', blurb: 'Assignments, to-dos and exams.', style: { accent: '#E8C872', banner: 'preset:butter', icon: '✅' } },
  { id: 'classes', label: 'Classes', path: '/classes', blurb: 'Notes, links and files for every class.', style: { accent: '#BCA7E4', banner: 'preset:grid', icon: '📚' } },
  { id: 'meals', label: 'Recipes', path: '/meals', blurb: 'Your recipe base, fresh ideas, the week’s meals and groceries.', style: { accent: '#F2B48C', banner: 'preset:sunset', icon: '🥗' } },
  { id: 'fitness', label: 'Fitness', path: '/fitness', blurb: 'Plan workouts, log sets, keep moving.', style: { accent: '#8ED3C2', banner: 'preset:seaglass', icon: '🏃‍♀️' } },
  { id: 'habits', label: 'Habits & Wellness', path: '/habits', blurb: 'Gentle streaks and how you’re feeling.', style: { accent: '#9CC19F', banner: 'preset:matcha', icon: '🌿' } },
  { id: 'budget', label: 'Budget', path: '/budget', blurb: 'Monthly spending, savings goals and account balances.', style: { accent: '#9CC3E8', banner: 'preset:sky', icon: '💸' } },
  { id: 'settings', label: 'Settings', path: '/settings', blurb: 'Themes, calendars and your data.', style: { accent: '#BBB2A8', banner: 'none', icon: '⚙️' } },
]

export const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<SectionId, SectionDef>

export const KIND_META = {
  event: { label: 'Event', emoji: '✨' },
  class: { label: 'Class', emoji: '📖' },
  task: { label: 'Task', emoji: '☑️' },
  assignment: { label: 'Assignment', emoji: '📝' },
  exam: { label: 'Exam', emoji: '🎯' },
} as const

export const KIND_ACCENT: Record<string, string> = {
  event: '#A9B2EC', class: '#BCA7E4', task: '#E8C872', assignment: '#F2B48C', exam: '#E9A3B4', workout: '#8ED3C2', google: '#9CC3E8',
}
