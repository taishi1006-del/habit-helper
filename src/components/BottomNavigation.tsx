import type { AppView } from '../types'

type BottomNavigationProps = {
  activeView: AppView
  onNavigate: (view: AppView) => void
}

const items: Array<{ view: AppView; icon: string; label: string }> = [
  { view: 'home', icon: '⌂', label: 'ホーム' },
  { view: 'habits', icon: '◒', label: '習慣' },
  { view: 'create', icon: '+', label: '追加' },
  { view: 'settings', icon: '⚙', label: '設定' },
]

export function BottomNavigation({ activeView, onNavigate }: BottomNavigationProps) {
  return (
    <nav className="bottom-navigation" aria-label="メインナビゲーション">
      {items.map((item) => (
        <button
          key={item.view}
          className={activeView === item.view ? 'is-active' : ''}
          onClick={() => onNavigate(item.view)}
        >
          <span className="bottom-navigation__icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
