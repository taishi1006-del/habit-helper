import type { CSSProperties } from 'react'

type ProgressRingProps = {
  completed: number
  total: number
}

export function ProgressRing({ completed, total }: ProgressRingProps) {
  const percentage = total ? Math.round((completed / total) * 100) : 0
  return (
    <div className="progress-ring" style={{ '--progress': `${percentage * 3.6}deg` } as CSSProperties}>
      <div className="progress-ring__inner">
        <strong>{percentage}%</strong>
        <span>今日の達成</span>
      </div>
    </div>
  )
}
