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

export const isDueToday = (habit: Habit, date = new Date()) => {
  const isoDate = toISODate(date)
  if (isoDate < habit.startDate || (habit.endDate && isoDate > habit.endDate)) return false
  if (habit.frequencyType === 'daily' || habit.frequencyType === 'weekly' || habit.frequencyType === 'monthly') return true
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  return habit.selectedDays?.includes(weekday) ?? false
}

export const frequencyLabel = (type: FrequencyType, targetPerWeek?: number, selectedDays?: number[], targetPerMonth?: number) => {
  if (type === 'daily') return '毎日'
  if (type === 'weekly') return `週${targetPerWeek ?? 1}回`
  if (type === 'monthly') return `月${targetPerMonth ?? 1}回`
  const labels = ['月', '火', '水', '木', '金', '土', '日']
  if (selectedDays?.join(',') === '1,2,3,4,5') return '平日のみ'
  return selectedDays?.map((day) => labels[day - 1]).join('・') || '曜日指定'
}

export const countThisWeek = (habitId: string, records: HabitRecord[]) => {
  const week = new Set(getWeekDates())
  return records.filter((record) => record.habitId === habitId && week.has(record.completedDate)).length
}

export const countThisMonth = (habitId: string, records: HabitRecord[], date = new Date()) => {
  const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  return records.filter((record) => record.habitId === habitId && record.completedDate.startsWith(prefix)).length
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

export const countScheduledDays = (habit: Habit, dates: string[]) => dates.filter((date) => isDueToday(habit, new Date(`${date}T00:00:00`))).length

export const getScheduledDaysThisWeek = (habit: Habit, date = new Date()) => countScheduledDays(habit, getWeekDates(date))

export const getLongestStreak = (habit: Habit, records: HabitRecord[]) => {
  const dates = records
    .filter((record) => record.habitId === habit.id)
    .map((record) => record.completedDate)
    .sort()
  if (!dates.length) return 0
  let longest = 1
  let current = 1
  for (let index = 1; index < dates.length; index += 1) {
    const previous = new Date(`${dates[index - 1]}T00:00:00`)
    const next = new Date(`${dates[index]}T00:00:00`)
    const difference = Math.round((next.getTime() - previous.getTime()) / 86400000)
    if (difference === 1) {
      current += 1
      longest = Math.max(longest, current)
    } else if (difference > 1) {
      current = 1
    }
  }
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

export const getStreak = (habit: Habit, records: HabitRecord[]) => {
  const recordDates = new Set(records.filter((record) => record.habitId === habit.id).map((record) => record.completedDate))
  let streak = 0
  const cursor = new Date()

  while (recordDates.has(toISODate(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export const percentage = (completed: number, total: number) => {
  if (!total) return 0
  return Math.round((completed / total) * 100)
}
