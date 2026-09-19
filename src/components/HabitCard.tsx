import type { Habit } from '../types'
import { countThisMonth, countThisWeek, frequencyLabel, getScheduledDaysThisWeek, getStreak } from '../utils'
import type { HabitRecord } from '../types'

type HabitCardProps = {
  habit: Habit
  records: HabitRecord[]
  completed: boolean
  onToggle: () => void
  onOpen: () => void
}

export function HabitCard({ habit, records, completed, onToggle, onOpen }: HabitCardProps) {
  const streak = getStreak(habit, records)
  const weeklyCount = countThisWeek(habit.id, records)
  const weeklyGoal = habit.frequencyType === 'weekly' ? habit.targetPerWeek ?? 1 : getScheduledDaysThisWeek(habit)
  const monthlyCount = countThisMonth(habit.id, records)

  return (
    <article className={`habit-card habit-card--${habit.tone} ${completed ? 'is-complete' : ''}`}>
      <button className="habit-card__main" onClick={onOpen} aria-label={`${habit.name}の詳細を見る`}>
        <span className="habit-card__icon" aria-hidden="true">{habit.icon}</span>
        <span className="habit-card__body">
          <span className="habit-card__name">{habit.name}</span>
          <span className="habit-card__meta">
            <span>{frequencyLabel(habit.frequencyType, habit.targetPerWeek, habit.selectedDays, habit.targetPerMonth)}</span>
            <span className="habit-card__streak habit-card__streak--week">{habit.frequencyType === 'monthly' ? `今月 ${monthlyCount} / ${habit.targetPerMonth ?? 1}回` : `今週 ${weeklyCount} / ${weeklyGoal}日`}</span>
            <span className="habit-card__streak">🔥 {streak}日継続</span>
            {habit.reminderEnabled && habit.reminderTime && <span className="habit-card__reminder">🔔 {habit.reminderTime}</span>}
          </span>
        </span>
        <span className="habit-card__chevron" aria-hidden="true">›</span>
      </button>
      <button className={`complete-button ${completed ? 'is-complete' : ''}`} onClick={onToggle}>
        {completed ? <><span aria-hidden="true">✓</span> 完了</> : '完了にする'}
      </button>
    </article>
  )
}
