import type { LinguistScheduleTiming } from '@linguist/domain-service/contracts'

export type AdaptedScheduleTiming = Extract<LinguistScheduleTiming, { kind: 'monthly' | 'every' }>

export function usesCalendarAdapter(timing: LinguistScheduleTiming): timing is AdaptedScheduleTiming {
  return timing.kind === 'monthly' || timing.kind === 'every' && (timing.activeWindowStart !== undefined || Boolean(timing.activeWeekdays?.length))
}

/** Port of source automation-manager.computeNextRunAt; DSH owns all timers and delivery. */
export function nextCalendarOccurrence(timing: AdaptedScheduleTiming, from: number): number {
  if (timing.kind === 'monthly') {
    const [hours, minutes] = timing.time.split(':').map(Number)
    const next = new Date(from)
    next.setHours(hours!, minutes!, 0, 0)
    const align = () => next.setDate(Math.min(timing.dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()))
    next.setDate(1)
    align()
    if (next.getTime() <= from) {
      next.setDate(1)
      next.setMonth(next.getMonth() + 1)
      align()
    }
    return next.getTime()
  }
  const step = timing.seconds * 1000
  const weekdays = timing.activeWeekdays ?? []
  const isAllowedDay = (date: Date) => weekdays.length === 0 || weekdays.includes(date.getDay())
  const nextAllowedDay = (date: Date) => {
    const next = new Date(date)
    for (let i = 0; i < 7; i++) {
      if (i > 0) next.setDate(next.getDate() + 1)
      if (isAllowedDay(next)) return next
    }
    return next
  }
  if (timing.activeWindowStart !== undefined) {
    const [startHour, startMinute] = timing.activeWindowStart.split(':').map(Number)
    const [endHour, endMinute] = timing.activeWindowEnd!.split(':').map(Number)
    const start = new Date(from)
    start.setHours(startHour!, startMinute!, 0, 0)
    const end = new Date(from)
    end.setHours(endHour!, endMinute!, 0, 0)
    if (!isAllowedDay(start) || from >= end.getTime()) {
      start.setDate(start.getDate() + (from >= end.getTime() ? 1 : 0))
      const next = nextAllowedDay(start)
      next.setHours(startHour!, startMinute!, 0, 0)
      return next.getTime()
    }
    if (from < start.getTime()) return start.getTime()
    const candidate = start.getTime() + (Math.floor((from - start.getTime()) / step) + 1) * step
    if (candidate < end.getTime()) return candidate
    start.setDate(start.getDate() + 1)
    const next = nextAllowedDay(start)
    next.setHours(startHour!, startMinute!, 0, 0)
    return next.getTime()
  }
  const current = new Date(from)
  if (isAllowedDay(current)) {
    const candidate = from + step
    if (isAllowedDay(new Date(candidate))) return candidate
    const next = nextAllowedDay(new Date(candidate))
    next.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds())
    return next.getTime()
  }
  const next = nextAllowedDay(current)
  next.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds())
  return next.getTime()
}

export function nativeTiming(timing: LinguistScheduleTiming, now: number): Exclude<LinguistScheduleTiming, { kind: 'monthly' }> {
  return usesCalendarAdapter(timing) ? { kind: 'at', at: new Date(nextCalendarOccurrence(timing, now)).toISOString() } : timing
}
