import type { FrequencyType, Habit, HabitRecord } from './types'

export const toISODate = (date: Date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const todayISO = () => toISODate(new Date())

export const formatJapaneseDate = (date = new Date()) => {
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
}

export const formatShortDate = (date: string) => {
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(new Date(`${date}T00:00:00`))
}

export const getMonday = (date = new Date()) => {
  const monday = new Date(date)
  const day = monday.getDay()
  const distance = day === 0 ? 6 : day - 1
  monday.setDate(monday.getDate() - distance)
  monday.setHours(0, 0, 0, 0)
  return monday
}

export const getWeekDates = (date = new Date()) => {
  const monday = getMonday(date)
  return Array.from({ length: 7 }, (_, index) => {
    const current = new Date(monday)
    current.setDate(monday.getDate() + index)
    return toISODate(current)
  })
}

// Schedule eligibility is separate from remaining weekly/monthly targets.
export const isScheduledOn = (habit: Habit, date = new Date()) => {
  const isoDate = toISODate(date)
  if (isoDate < habit.startDate || (habit.endDate && isoDate > habit.endDate)) return false
  if (!habit.frequencyType || habit.frequencyType === 'daily' || habit.frequencyType === 'weekly' || habit.frequencyType === 'monthly') return true
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  return habit.selectedDays?.includes(weekday) ?? false
}

const countCompletedDates = (habitId: string, records: HabitRecord[], start: string, end: string) =>
  new Set(records.filter((record) => record.habitId === habitId && record.completedDate >= start && record.completedDate <= end).map((record) => record.completedDate)).size

export const isDueToday = (habit: Habit, date = new Date(), records: HabitRecord[] = []) => {
  if (!isScheduledOn(habit, date)) return false
  const today = toISODate(date)
  // Keep today's checked item visible so it can be undone and counted in progress.
  if (records.some((record) => record.habitId === habit.id && record.completedDate === today)) return true
  const eligibleRecords = records.filter((record) => isScheduledOn(habit, new Date(`${record.completedDate}T00:00:00`)))
  if (habit.frequencyType === 'weekly') return countThisWeek(habit.id, eligibleRecords, date) < (habit.targetPerWeek ?? 1)
  if (habit.frequencyType === 'monthly') return countThisMonth(habit.id, eligibleRecords, date) < (habit.targetPerMonth ?? 1)
  return true
}

export const frequencyLabel = (type: FrequencyType, targetPerWeek?: number, selectedDays?: number[], targetPerMonth?: number) => {
  if (type === 'daily') return '毎日'
  if (type === 'weekly') return `週${targetPerWeek ?? 1}回`
  if (type === 'monthly') return `月${targetPerMonth ?? 1}回`
  const labels = ['月', '火', '水', '木', '金', '土', '日']
  if (selectedDays?.join(',') === '1,2,3,4,5') return '平日のみ'
  return selectedDays?.map((day) => labels[day - 1]).join('・') || '曜日指定'
}

export const countThisWeek = (habitId: string, records: HabitRecord[], date = new Date()) => {
  return countCompletedDates(habitId, records, toISODate(getMonday(date)), toISODate(date))
}

export const countThisMonth = (habitId: string, records: HabitRecord[], date = new Date()) => {
  const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return countCompletedDates(habitId, records, `${prefix}-01`, toISODate(date))
}

export const getSuggestedReminderTime = (habitId: string, records: HabitRecord[], date = new Date()) => {
  const counts = new Map<string, number>()
  const recentLimit = date.getTime() - 45 * 86400000
  records
    .filter((record) => record.habitId === habitId && Date.parse(record.createdAt) >= recentLimit)
    .forEach((record) => {
      const completedAt = new Date(record.createdAt)
      if (Number.isNaN(completedAt.getTime())) return
      const hour = String(completedAt.getHours()).padStart(2, '0')
      const minute = completedAt.getMinutes() < 30 ? '00' : '30'
      const time = `${hour}:${minute}`
      counts.set(time, (counts.get(time) ?? 0) + 1)
    })
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

export const countScheduledDays = (habit: Habit, dates: string[]) => dates.filter((date) => isScheduledOn(habit, new Date(`${date}T00:00:00`))).length

export const getScheduledDaysThisWeek = (habit: Habit, date = new Date()) => countScheduledDays(habit, getWeekDates(date))

const streakDates = (habit: Habit, records: HabitRecord[], date: Date) =>
  [...new Set(records.filter((record) => record.habitId === habit.id && record.completedDate <= toISODate(date) && isScheduledOn(habit, new Date(`${record.completedDate}T00:00:00`))).map((record) => record.completedDate))].sort()

const previousScheduledDate = (habit: Habit, date: Date) => {
  const cursor = new Date(date)
  cursor.setDate(cursor.getDate() - 1)
  // A selected-days schedule repeats every seven days; empty schedules are invalid.
  for (let index = 0; index < 7 && toISODate(cursor) >= habit.startDate; index += 1) {
    if (isScheduledOn(habit, cursor)) return toISODate(cursor)
    cursor.setDate(cursor.getDate() - 1)
  }
  return null
}

const periodStart = (habit: Habit, date: Date) => habit.frequencyType === 'weekly'
  ? getMonday(date)
  : new Date(date.getFullYear(), date.getMonth(), 1)

const previousPeriod = (habit: Habit, date: Date) => {
  const cursor = new Date(date)
  if (habit.frequencyType === 'weekly') cursor.setDate(cursor.getDate() - 7)
  else cursor.setMonth(cursor.getMonth() - 1, 1)
  return cursor
}

const achievedPeriods = (habit: Habit, dates: string[]) => {
  const counts = new Map<string, number>()
  dates.forEach((date) => {
    const key = toISODate(periodStart(habit, new Date(`${date}T00:00:00`)))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  const target = habit.frequencyType === 'weekly' ? habit.targetPerWeek ?? 1 : habit.targetPerMonth ?? 1
  return new Set([...counts].filter(([, count]) => count >= target).map(([key]) => key))
}

export const getLongestStreak = (habit: Habit, records: HabitRecord[], date = new Date()) => {
  const dates = streakDates(habit, records, date)
  const periodBased = habit.frequencyType === 'weekly' || habit.frequencyType === 'monthly'
  const entries = periodBased ? [...achievedPeriods(habit, dates)].sort() : dates
  let longest = 0
  let current = 0
  entries.forEach((entry, index) => {
    const cursor = new Date(`${entry}T00:00:00`)
    const previous = periodBased ? toISODate(previousPeriod(habit, cursor)) : previousScheduledDate(habit, cursor)
    current = index > 0 && previous === entries[index - 1] ? current + 1 : 1
    longest = Math.max(longest, current)
  })
  return longest
}

export const getPeriodDates = (start: Date, end: Date) => {
  const dates: string[] = []
  const cursor = new Date(start)
  cursor.setHours(0, 0, 0, 0)
  while (cursor <= end) {
    dates.push(toISODate(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

const getTargetForPeriod = (habit: Habit, dates: string[]) => {
  if (habit.frequencyType === 'daily') return countScheduledDays(habit, dates)
  if (habit.frequencyType === 'selected_days') return countScheduledDays(habit, dates)
  if (habit.frequencyType === 'weekly') return Math.max(1, Math.ceil(dates.length / 7)) * (habit.targetPerWeek ?? 1)
  return Math.max(1, new Set(dates.map((date) => date.slice(0, 7))).size) * (habit.targetPerMonth ?? 1)
}

export const getPeriodProgress = (habits: Habit[], records: HabitRecord[], start: Date, end: Date) => {
  const dates = getPeriodDates(start, end)
  const dateSet = new Set(dates)
  const completed = records.filter((record) => dateSet.has(record.completedDate) && habits.some((habit) => habit.id === record.habitId)).length
  const target = habits.reduce((total, habit) => total + getTargetForPeriod(habit, dates), 0)
  return { completed: Math.min(completed, target), target, rate: percentage(Math.min(completed, target), target) }
}

export const getPeriodCompletionRate = (habits: Habit[], records: HabitRecord[], start: Date, end: Date) => {
  return getPeriodProgress(habits, records, start, end).rate
}

export const getWeekdayCompletionRates = (habits: Habit[], records: HabitRecord[], end = new Date()) => {
  const start = new Date(end)
  start.setDate(start.getDate() - 29)
  const dates = getPeriodDates(start, end)
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const weekdayDates = dates.filter((date) => {
      const day = new Date(`${date}T00:00:00`).getDay()
      return (day === 0 ? 7 : day) === weekday
    })
    const target = habits.reduce((total, habit) => total + countScheduledDays(habit, weekdayDates), 0)
    const dateSet = new Set(weekdayDates)
    const completed = records.filter((record) => dateSet.has(record.completedDate) && habits.some((habit) => habit.id === record.habitId)).length
    return { label: ['月', '火', '水', '木', '金', '土', '日'][weekday - 1], rate: percentage(Math.min(completed, target), target), completed, target }
  })
}

export const getStreak = (habit: Habit, records: HabitRecord[], date = new Date()) => {
  const today = toISODate(date)
  if (today < habit.startDate) return 0
  if (habit.frequencyType === 'selected_days' && !habit.selectedDays?.length) return 0
  const dates = streakDates(habit, records, date)
  const recordDates = new Set(dates)
  let streak = 0
  const lastDate = habit.endDate && habit.endDate < today ? habit.endDate : today
  if (habit.frequencyType === 'weekly' || habit.frequencyType === 'monthly') {
    const achieved = achievedPeriods(habit, dates)
    let cursor = periodStart(habit, new Date(`${lastDate}T00:00:00`))
    const firstPeriod = toISODate(periodStart(habit, new Date(`${habit.startDate}T00:00:00`)))
    // An unfinished current period is still in progress, not a failure.
    if (lastDate === today && !achieved.has(toISODate(cursor))) cursor = previousPeriod(habit, cursor)
    while (toISODate(cursor) >= firstPeriod && achieved.has(toISODate(cursor))) {
      streak += 1
      cursor = previousPeriod(habit, cursor)
    }
    return streak
  }
  const cursor = new Date(`${lastDate}T00:00:00`)
  // Today's deadline has not passed. Keep the streak until a scheduled day is missed.
  if (lastDate === today && !recordDates.has(today)) cursor.setDate(cursor.getDate() - 1)
  while (toISODate(cursor) >= habit.startDate) {
    if (!isScheduledOn(habit, cursor)) { cursor.setDate(cursor.getDate() - 1); continue }
    if (!recordDates.has(toISODate(cursor))) break
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export const getStreakUnit = (habit: Habit) => habit.frequencyType === 'weekly' ? '週' : habit.frequencyType === 'monthly' ? 'か月' : habit.frequencyType === 'selected_days' ? '回' : '日'

export const getStreakLabel = (habit: Habit, count: number) => `${count}${getStreakUnit(habit)}連続${habit.frequencyType === 'selected_days' ? '（対象日）' : ''}`

export const percentage = (completed: number, total: number) => {
  if (!total) return 0
  return Math.round((completed / total) * 100)
}
