export type FrequencyType = 'daily' | 'weekly' | 'selected_days'

export type Habit = {
  id: string
  name: string
  icon: string
  frequencyType: FrequencyType
  targetPerWeek?: number
  selectedDays?: number[]
  reminderEnabled?: boolean
  reminderTime?: string
  startDate: string
  createdAt: string
  tone: 'mint' | 'peach' | 'lavender' | 'sky' | 'yellow'
}

export type HabitRecord = {
  id: string
  habitId: string
  completedDate: string
  createdAt: string
}

export type AppView = 'home' | 'habits' | 'create' | 'detail' | 'settings'
