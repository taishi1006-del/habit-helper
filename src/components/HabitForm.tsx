import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Habit, FrequencyType } from '../types'

type HabitFormProps = {
  initialHabit?: Habit
  onSubmit: (habit: Omit<Habit, 'id' | 'createdAt'>) => void
  onCancel: () => void
}

const icons = ['💧', '🏃', '📖', '🧘', '✍️', '🧹', '🌱', '🎧']
const dayLabels = ['月', '火', '水', '木', '金', '土', '日']

export function HabitForm({ initialHabit, onSubmit, onCancel }: HabitFormProps) {
  const [name, setName] = useState(initialHabit?.name ?? '')
  const [icon, setIcon] = useState(initialHabit?.icon ?? '💧')
  const [frequencyType, setFrequencyType] = useState<FrequencyType>(initialHabit?.frequencyType ?? 'daily')
  const [targetPerWeek, setTargetPerWeek] = useState(initialHabit?.targetPerWeek ?? 4)
  const [selectedDays, setSelectedDays] = useState<number[]>(initialHabit?.selectedDays ?? [1, 3, 5])
  const [reminderEnabled, setReminderEnabled] = useState(initialHabit?.reminderEnabled ?? true)
  const [reminderTime, setReminderTime] = useState(initialHabit?.reminderTime ?? '20:00')
  const [startDate, setStartDate] = useState(initialHabit?.startDate ?? new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')

  useEffect(() => {
    setName(initialHabit?.name ?? '')
    setIcon(initialHabit?.icon ?? '💧')
    setFrequencyType(initialHabit?.frequencyType ?? 'daily')
    setTargetPerWeek(initialHabit?.targetPerWeek ?? 4)
    setSelectedDays(initialHabit?.selectedDays ?? [1, 3, 5])
    setReminderEnabled(initialHabit?.reminderEnabled ?? true)
    setReminderTime(initialHabit?.reminderTime ?? '20:00')
    setStartDate(initialHabit?.startDate ?? new Date().toISOString().slice(0, 10))
  }, [initialHabit])

  const toggleDay = (day: number) => {
    setSelectedDays((days) => days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort())
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('習慣名を入力してください')
      return
    }
    if (frequencyType === 'selected_days' && selectedDays.length === 0) {
      setError('曜日を1つ以上選択してください')
      return
    }
    setError('')
    onSubmit({
      name: name.trim(),
      icon,
      frequencyType,
      targetPerWeek: frequencyType === 'weekly' ? targetPerWeek : undefined,
      selectedDays: frequencyType === 'selected_days' ? selectedDays : undefined,
      reminderEnabled,
      reminderTime,
      startDate,
      tone: initialHabit?.tone ?? 'mint',
    })
  }

  return (
    <form className="habit-form" onSubmit={submit}>
      <div className="form-section">
        <label className="form-label" htmlFor="habit-name">どんな習慣？</label>
        <input
          id="habit-name"
          className="text-input text-input--large"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例：朝に水を飲む"
          autoFocus
        />
      </div>

      <div className="form-section">
        <span className="form-label">アイコンを選ぶ</span>
        <div className="icon-picker">
          {icons.map((item) => (
            <button key={item} type="button" className={icon === item ? 'is-selected' : ''} onClick={() => setIcon(item)} aria-label={`${item}を選択`}>
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="form-section">
        <span className="form-label">頻度</span>
        <div className="frequency-options">
          <button type="button" className={frequencyType === 'daily' ? 'is-selected' : ''} onClick={() => setFrequencyType('daily')}>
            <strong>毎日</strong><span>リズムを作りたい</span>
          </button>
          <button type="button" className={frequencyType === 'weekly' ? 'is-selected' : ''} onClick={() => setFrequencyType('weekly')}>
            <strong>週に何回か</strong><span>無理なく続けたい</span>
          </button>
          <button type="button" className={frequencyType === 'selected_days' ? 'is-selected' : ''} onClick={() => setFrequencyType('selected_days')}>
            <strong>曜日を選ぶ</strong><span>予定に合わせたい</span>
          </button>
        </div>
      </div>

      {frequencyType === 'weekly' && (
        <div className="form-section form-section--inline">
          <label className="form-label" htmlFor="target-per-week">週の目標</label>
          <select id="target-per-week" className="select-input" value={targetPerWeek} onChange={(event) => setTargetPerWeek(Number(event.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((count) => <option key={count} value={count}>週{count}回</option>)}
          </select>
        </div>
      )}

      {frequencyType === 'selected_days' && (
        <div className="form-section">
          <span className="form-label">曜日を選択</span>
          <div className="day-picker">
            {dayLabels.map((label, index) => {
              const day = index + 1
              return <button type="button" key={label} className={selectedDays.includes(day) ? 'is-selected' : ''} onClick={() => toggleDay(day)}>{label}</button>
            })}
          </div>
        </div>
      )}

      <div className="form-section form-section--inline">
        <label className="form-label" htmlFor="start-date">開始日</label>
        <input id="start-date" type="date" className="date-input" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
      </div>

      <div className="form-section reminder-form-section">
        <div className="reminder-toggle-row">
          <div>
            <span className="form-label">習慣のリマインダー</span>
            <span className="form-hint">設定した時間にブラウザからお知らせします。</span>
          </div>
          <label className="switch-control">
            <input type="checkbox" checked={reminderEnabled} onChange={(event) => setReminderEnabled(event.target.checked)} />
            <span className="switch-control__track" aria-hidden="true"><span /></span>
            <span className="sr-only">この習慣の通知を受け取る</span>
          </label>
        </div>
        <div className="reminder-time-row">
          <label className="form-label" htmlFor="reminder-time">通知時刻</label>
          <input id="reminder-time" type="time" className="time-input" value={reminderTime} disabled={!reminderEnabled} onChange={(event) => setReminderTime(event.target.value)} />
        </div>
        <p className="form-hint">アプリを開いている間に通知されます。まず設定画面で通知を許可してください。</p>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="button button--ghost" onClick={onCancel}>キャンセル</button>
        <button type="submit" className="button button--primary">{initialHabit ? '変更を保存' : '習慣を作成'} <span aria-hidden="true">→</span></button>
      </div>
    </form>
  )
}
