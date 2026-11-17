export interface Graded { weight?: number; score?: number }

export interface GradeSummary {
  totalWeight: number
  gradedWeight: number
  /** Weighted average of graded items, 0–100; undefined if nothing graded. */
  current?: number
  /** Points banked toward the final grade (out of totalWeight). */
  earned: number
  /** Average needed on remaining weight to hit target; undefined if no target or nothing remaining. */
  needed?: number
}

export function summarize(items: Graded[], target?: number): GradeSummary {
  let totalWeight = 0, gradedWeight = 0, earned = 0
  for (const it of items) {
    const w = it.weight ?? 0
    if (w <= 0) continue
    totalWeight += w
    if (it.score !== undefined && !Number.isNaN(it.score)) {
      gradedWeight += w
      earned += (w * it.score) / 100
    }
  }
  const current = gradedWeight > 0 ? (earned / gradedWeight) * 100 : undefined
  const remaining = Math.max(totalWeight, 100) - gradedWeight
  const needed = target !== undefined && remaining > 0 ? ((target / 100) * Math.max(totalWeight, 100) - earned) / remaining * 100 : undefined
  return { totalWeight, gradedWeight, current, earned, needed }
}

export function letter(p?: number): string {
  if (p === undefined) return '—'
  return p >= 90 ? 'A+' : p >= 85 ? 'A' : p >= 80 ? 'A-' : p >= 77 ? 'B+' : p >= 73 ? 'B' : p >= 70 ? 'B-'
    : p >= 67 ? 'C+' : p >= 63 ? 'C' : p >= 60 ? 'C-' : p >= 57 ? 'D+' : p >= 53 ? 'D' : p >= 50 ? 'D-' : 'F'
}
