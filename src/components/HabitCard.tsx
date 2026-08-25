import type { Habit } from '../types'
import { countThisWeek, frequencyLabel, getStreak } from '../utils'
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
  const weeklyGoal = habit.targetPerWeek ?? 0

  return (
    <article className={`habit-card habit-card--${habit.tone} ${completed ? 'is-complete' : ''}`}>
      <button className="habit-card__main" onClick={onOpen} aria-label={`${habit.name}の詳細を見る`}>
        <span className="habit-card__icon" aria-hidden="true">{habit.icon}</span>
        <span className="habit-card__body">
          <span className="habit-card__name">{habit.name}</span>
          <span className="habit-card__meta">
            <span>{frequencyLabel(habit.frequencyType, habit.targetPerWeek, habit.selectedDays)}</span>
            {habit.frequencyType === 'weekly' ? (
              <span className="habit-card__streak habit-card__streak--week">今週 {weeklyCount} / {weeklyGoal}</span>
            ) : (
              <span className="habit-card__streak">🔥 {streak}日継続</span>
            )}
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
