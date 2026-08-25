import { toISODate } from '../utils'

type CalendarGridProps = {
  completedDates: Set<string>
  selectedDates?: Set<string>
}

const labels = ['月', '火', '水', '木', '金', '土', '日']

export function CalendarGrid({ completedDates, selectedDates }: CalendarGridProps) {
  const today = new Date()
  const year = today.getFullYear()
  const month = today.getMonth()
  const firstDay = new Date(year, month, 1)
  const offset = (firstDay.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1
    if (day < 1 || day > daysInMonth) return null
    const date = toISODate(new Date(year, month, day))
    return { day, date }
  })

  return (
    <div className="calendar-grid">
      <div className="calendar-grid__labels">
        {labels.map((label) => <span key={label}>{label}</span>)}
      </div>
      <div className="calendar-grid__days">
        {cells.map((cell, index) => cell ? (
          <span
            key={cell.date}
            className={`calendar-day ${completedDates.has(cell.date) ? 'is-complete' : ''} ${selectedDates?.has(cell.date) ? 'is-selected' : ''}`}
            title={completedDates.has(cell.date) ? `${cell.day}日：達成` : `${cell.day}日：未達成`}
          >
            <span>{cell.day}</span>
            {completedDates.has(cell.date) && <i aria-hidden="true" />}
          </span>
        ) : <span key={`empty-${index}`} className="calendar-day calendar-day--empty" />)}
      </div>
    </div>
  )
}
