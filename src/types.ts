export type FrequencyType = 'daily' | 'weekly' | 'monthly' | 'selected_days'
export type GoalUnit = '回' | '分' | '杯' | '個'

export type Habit = {
  id: string
  name: string
  icon: string
  frequencyType: FrequencyType
  targetPerWeek?: number
  targetPerMonth?: number
  targetValue?: number
  targetUnit?: GoalUnit
  selectedDays?: number[]
  reminderEnabled?: boolean
  reminderTime?: string
  smartReminder?: boolean
  startDate: string
  endDate?: string
  createdAt: string
  tone: 'mint' | 'peach' | 'lavender' | 'sky' | 'yellow'
}

export type HabitRecord = {
  id: string
  habitId: string
  completedDate: string
  note?: string
  amount?: number
  createdAt: string
}

export type AppView = 'home' | 'habits' | 'create' | 'detail' | 'stats' | 'settings'
