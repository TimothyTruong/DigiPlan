import { useMemo, type CSSProperties } from 'react'
import { format } from 'date-fns'
import { countdownLabel, daysUntil, fromISO, isDone, nextOccurrence, todayISO } from '../lib/dates'
import { useStore } from '../store/store'
import { KIND_ACCENT } from '../theme/themes'
import { openEditor } from './ItemEditor'
import { Empty } from './ui'

export function useCountdowns(limit = 8) {
  const items = useStore((s) => s.items)
  const courses = useStore((s) => s.courses)
  return useMemo(() => {
    const t = todayISO()
    const byId = new Map(courses.map((c) => [c.id, c]))
    return items
      .filter((i) => i.countdown || i.kind === 'exam')
      .map((i) => ({ item: i, date: nextOccurrence(i, t) }))
      .filter((x): x is { item: typeof x.item; date: string } => !!x.date && !isDone(x.item, x.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, limit)
      .map((x) => ({ ...x, days: daysUntil(x.date, t), course: x.item.courseId ? byId.get(x.item.courseId) : undefined }))
  }, [items, courses, limit])
}

export function Countdowns({ limit }: { limit?: number }) {
  const list = useCountdowns(limit)
  if (!list.length) return <Empty emoji="⏳">Nothing counting down. Exams show up here automatically, or tick “Show countdown” on anything.</Empty>
  return (
    <div className="countdowns">
      {list.map(({ item, date, days, course }) => (
        <button key={item.id} className="cd" style={{ '--accent': course?.accent ?? KIND_ACCENT[item.kind] } as CSSProperties} onClick={() => openEditor({ id: item.id }, date)}>
          <div className="n">{days <= 1 ? countdownLabel(days) : days}</div>
          {days > 1 && <div className="u">days to go</div>}
          <div className="t ellipsis">{item.title}</div>
          <div className="d ellipsis">{course ? `${course.emoji} ${course.code || course.name} · ` : ''}{format(fromISO(date), 'EEE, MMM d')}</div>
        </button>
      ))}
    </div>
  )
}
