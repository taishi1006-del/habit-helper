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
  if (habit.frequencyType === 'daily' || habit.frequencyType === 'weekly') return true
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  return habit.selectedDays?.includes(weekday) ?? false
}

export const frequencyLabel = (type: FrequencyType, targetPerWeek?: number, selectedDays?: number[]) => {
  if (type === 'daily') return '毎日'
  if (type === 'weekly') return `週${targetPerWeek ?? 1}回`
  const labels = ['月', '火', '水', '木', '金', '土', '日']
  return selectedDays?.map((day) => labels[day - 1]).join('・') || '曜日指定'
}

export const countThisWeek = (habitId: string, records: HabitRecord[]) => {
  const week = new Set(getWeekDates())
  return records.filter((record) => record.habitId === habitId && week.has(record.completedDate)).length
}

export const getStreak = (habit: Habit, records: HabitRecord[]) => {
  if (habit.frequencyType === 'weekly') return 0
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
