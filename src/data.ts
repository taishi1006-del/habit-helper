import type { Habit, HabitRecord } from './types'
import { toISODate } from './utils'

const daysAgo = (amount: number) => {
  const date = new Date()
  date.setDate(date.getDate() - amount)
  return toISODate(date)
}

export const starterHabits: Habit[] = [
  {
    id: 'water',
    name: '水を飲む',
    icon: '💧',
    frequencyType: 'daily',
    startDate: daysAgo(18),
    createdAt: new Date().toISOString(),
    tone: 'sky',
  },
  {
    id: 'workout',
    name: '筋トレ',
    icon: '🏃',
    frequencyType: 'weekly',
    targetPerWeek: 4,
    startDate: daysAgo(24),
    createdAt: new Date().toISOString(),
    tone: 'peach',
  },
  {
    id: 'english',
    name: '英単語を勉強する',
    icon: '📖',
    frequencyType: 'selected_days',
    selectedDays: [1, 3, 5],
    startDate: daysAgo(31),
    createdAt: new Date().toISOString(),
    tone: 'lavender',
  },
  {
    id: 'stretch',
    name: '寝る前にストレッチ',
    icon: '🧘',
    frequencyType: 'daily',
    startDate: daysAgo(9),
    createdAt: new Date().toISOString(),
    tone: 'mint',
  },
]

export const starterRecords: HabitRecord[] = [
  { id: 'water-0', habitId: 'water', completedDate: daysAgo(6), createdAt: new Date().toISOString() },
  { id: 'water-1', habitId: 'water', completedDate: daysAgo(5), createdAt: new Date().toISOString() },
  { id: 'water-2', habitId: 'water', completedDate: daysAgo(4), createdAt: new Date().toISOString() },
  { id: 'water-3', habitId: 'water', completedDate: daysAgo(3), createdAt: new Date().toISOString() },
  { id: 'water-4', habitId: 'water', completedDate: daysAgo(2), createdAt: new Date().toISOString() },
  { id: 'water-5', habitId: 'water', completedDate: daysAgo(1), createdAt: new Date().toISOString() },
  { id: 'workout-0', habitId: 'workout', completedDate: daysAgo(6), createdAt: new Date().toISOString() },
  { id: 'workout-1', habitId: 'workout', completedDate: daysAgo(4), createdAt: new Date().toISOString() },
  { id: 'workout-2', habitId: 'workout', completedDate: daysAgo(2), createdAt: new Date().toISOString() },
  { id: 'english-0', habitId: 'english', completedDate: daysAgo(4), createdAt: new Date().toISOString() },
  { id: 'english-1', habitId: 'english', completedDate: daysAgo(2), createdAt: new Date().toISOString() },
  { id: 'stretch-0', habitId: 'stretch', completedDate: daysAgo(1), createdAt: new Date().toISOString() },
]
