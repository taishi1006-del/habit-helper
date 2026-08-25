import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { BottomNavigation } from './components/BottomNavigation'
import { CalendarGrid } from './components/CalendarGrid'
import { HabitCard } from './components/HabitCard'
import { HabitForm } from './components/HabitForm'
import { ProgressRing } from './components/ProgressRing'
import { starterHabits, starterRecords } from './data'
import type { AppView, Habit, HabitRecord } from './types'
import { countThisWeek, formatJapaneseDate, formatShortDate, frequencyLabel, getStreak, getWeekDates, isDueToday, percentage, todayISO, toISODate } from './utils'

const STORAGE_KEY = 'habit-helper-local-v1'

type StoredState = { habits: Habit[]; records: HabitRecord[] }

const readStoredState = (): StoredState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored) as StoredState
  } catch {
    // Local storage is optional for this first prototype.
  }
  return { habits: starterHabits, records: starterRecords }
}

const getTone = (index: number): Habit['tone'] => (['mint', 'peach', 'lavender', 'sky', 'yellow'] as const)[index % 5]

function App() {
  const [state, setState] = useState<StoredState>(readStoredState)
  const [activeView, setActiveView] = useState<AppView>('home')
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null)
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')

  const { habits, records } = state
  const today = todayISO()
  const dueHabits = useMemo(() => habits.filter((habit) => isDueToday(habit)), [habits])
  const completedToday = dueHabits.filter((habit) => records.some((record) => record.habitId === habit.id && record.completedDate === today)).length
  const progress = percentage(completedToday, dueHabits.length)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // The UI remains usable if storage is unavailable.
    }
  }, [state])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const navigate = (view: AppView) => {
    setActiveView(view)
    if (view !== 'detail') setSelectedHabitId(null)
    if (view !== 'create') setEditingHabitId(null)
  }

  const openDetail = (habitId: string) => {
    setSelectedHabitId(habitId)
    setActiveView('detail')
  }

  const toggleCompletion = (habitId: string) => {
    const existing = records.find((record) => record.habitId === habitId && record.completedDate === today)
    setState((current) => ({
      ...current,
      records: existing
        ? current.records.filter((record) => record.id !== existing.id)
        : [...current.records, { id: `${habitId}-${today}`, habitId, completedDate: today, createdAt: new Date().toISOString() }],
    }))
    setNotice(existing ? '完了を取り消しました' : '今日の習慣を記録しました ✓')
  }

  const saveHabit = (values: Omit<Habit, 'id' | 'createdAt'>) => {
    if (editingHabitId) {
      setState((current) => ({
        ...current,
        habits: current.habits.map((habit) => habit.id === editingHabitId ? { ...habit, ...values } : habit),
      }))
      setSelectedHabitId(editingHabitId)
      setEditingHabitId(null)
      setActiveView('detail')
      setNotice('習慣を更新しました')
      return
    }

    const newHabit: Habit = {
      ...values,
      id: `habit-${Date.now()}`,
      createdAt: new Date().toISOString(),
      tone: values.tone || getTone(habits.length),
    }
    setState((current) => ({ ...current, habits: [...current.habits, newHabit] }))
    setActiveView('habits')
    setNotice('新しい習慣を追加しました')
  }

  const deleteHabit = (habitId: string) => {
    const habit = habits.find((item) => item.id === habitId)
    if (!habit || !window.confirm(`「${habit.name}」を削除しますか？`)) return
    setState((current) => ({
      habits: current.habits.filter((item) => item.id !== habitId),
      records: current.records.filter((record) => record.habitId !== habitId),
    }))
    setActiveView('habits')
    setSelectedHabitId(null)
    setNotice('習慣を削除しました')
  }

  const resetDemo = () => {
    if (!window.confirm('デモデータを初期状態に戻しますか？')) return
    setState({ habits: starterHabits, records: starterRecords })
    setActiveView('home')
    setNotice('デモデータをリセットしました')
  }

  const selectedHabit = habits.find((habit) => habit.id === selectedHabitId)
  const editingHabit = habits.find((habit) => habit.id === editingHabitId)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <span className="brand-mark">hh</span>
          <span><strong>Habit</strong> Helper</span>
        </div>
        <div className="sidebar__intro">
          <span className="sidebar__eyebrow">YOUR DAILY RHYTHM</span>
          <p>小さな習慣を、<br /><strong>毎日の力に。</strong></p>
        </div>
        <nav className="sidebar__nav" aria-label="メインナビゲーション">
          <SidebarLink icon="⌂" label="ホーム" active={activeView === 'home'} onClick={() => navigate('home')} />
          <SidebarLink icon="◒" label="自分の習慣" active={activeView === 'habits' || activeView === 'detail'} onClick={() => navigate('habits')} />
          <SidebarLink icon="＋" label="習慣を追加" active={activeView === 'create'} onClick={() => navigate('create')} />
          <SidebarLink icon="⚙" label="設定" active={activeView === 'settings'} onClick={() => navigate('settings')} />
        </nav>
        <div className="sidebar__footer">
          <div className="demo-badge"><span /> 仮データモード</div>
          <p>自分のペースで大丈夫。<br />続けることが、いちばんの近道です。</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar__mobile-brand"><span className="brand-mark">hh</span><strong>Habit Helper</strong></div>
          <div className="topbar__spacer" />
          <div className="topbar__profile">
            <div className="profile-copy"><strong>こんにちは、さきさん</strong><span>今日もいい一日にしよう</span></div>
            <span className="profile-avatar">S</span>
          </div>
        </header>

        {activeView === 'home' && <HomeView habits={dueHabits} allHabits={habits} records={records} completedToday={completedToday} progress={progress} onToggle={toggleCompletion} onOpen={openDetail} onAdd={() => navigate('create')} onViewAll={() => navigate('habits')} />}
        {activeView === 'habits' && <HabitsView habits={habits} records={records} onToggle={toggleCompletion} onOpen={openDetail} onAdd={() => navigate('create')} />}
        {activeView === 'create' && <PageFrame eyebrow={editingHabit ? 'EDIT HABIT' : 'NEW HABIT'} title={editingHabit ? '習慣を整える' : '新しい習慣をつくる'} description={editingHabit ? '今のあなたに合うように、いつでも調整できます。' : '続けたいことをひとつだけ。小さく始めるのがコツです。'}><HabitForm initialHabit={editingHabit} onSubmit={saveHabit} onCancel={() => editingHabit ? openDetail(editingHabit.id) : navigate('home')} /></PageFrame>}
        {activeView === 'detail' && selectedHabit && <DetailView habit={selectedHabit} records={records} onBack={() => navigate('habits')} onToggle={() => toggleCompletion(selectedHabit.id)} onEdit={() => { setEditingHabitId(selectedHabit.id); setActiveView('create') }} onDelete={() => deleteHabit(selectedHabit.id)} />}
        {activeView === 'settings' && <SettingsView onReset={resetDemo} />}

        <BottomNavigation activeView={activeView} onNavigate={navigate} />
        {notice && <div className="toast" role="status"><span aria-hidden="true">✦</span>{notice}</div>}
      </main>
    </div>
  )
}

function SidebarLink({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: () => void }) {
  return <button className={`sidebar-link ${active ? 'is-active' : ''}`} onClick={onClick}><span className="sidebar-link__icon" aria-hidden="true">{icon}</span><span>{label}</span>{active && <span className="sidebar-link__active-dot" />}</button>
}

function PageFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return <div className="page-frame"><div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children}</div>
}

type HomeViewProps = {
  habits: Habit[]
  allHabits: Habit[]
  records: HabitRecord[]
  completedToday: number
  progress: number
  onToggle: (habitId: string) => void
  onOpen: (habitId: string) => void
  onAdd: () => void
  onViewAll: () => void
}

function HomeView({ habits, allHabits, records, completedToday, progress, onToggle, onOpen, onAdd, onViewAll }: HomeViewProps) {
  const week = getWeekDates()
  const weekTotal = habits.reduce((total, habit) => total + countThisWeek(habit.id, records), 0)
  const bestHabit = allHabits.slice().sort((a, b) => getStreak(b, records) - getStreak(a, records))[0]

  return <div className="home-view">
    <div className="date-strip"><span className="date-strip__dot" aria-hidden="true" />今日 · {formatJapaneseDate()}</div>

    <section className="welcome-row">
      <div><h1>おかえりなさい。<br /><em>今日も一歩ずつ。</em></h1></div>
      <button className="button button--primary button--add" onClick={onAdd}><span aria-hidden="true">＋</span> 習慣を追加</button>
    </section>

    <section className="section-block today-section">
      <div className="section-heading"><div><span className="eyebrow">FOR TODAY</span><h2>今日の習慣</h2></div><button className="text-button" onClick={onViewAll}>すべて見る <span aria-hidden="true">→</span></button></div>
      <div className="habit-stack">
        {habits.length === 0 ? <EmptyHabits onAdd={onAdd} /> : habits.map((habit) => <HabitCard key={habit.id} habit={habit} records={records} completed={records.some((record) => record.habitId === habit.id && record.completedDate === todayISO())} onToggle={() => onToggle(habit.id)} onOpen={() => onOpen(habit.id)} />)}
      </div>
    </section>

    <section className="progress-panel">
      <div className="progress-panel__copy"><span className="eyebrow eyebrow--light">TODAY'S PROGRESS</span><h2>今日のリズム</h2><p>{progress === 100 ? 'すべての習慣を達成しました。すてきです！' : 'ひとつずつ、できたことを積み重ねよう。'}</p><div className="progress-panel__count"><strong>{completedToday}</strong><span> / {habits.length} habits</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><span className="progress-panel__caption">{progress === 100 ? '今日の目標をクリア！' : `あと${Math.max(habits.length - completedToday, 0)}つで今日の目標達成`}</span></div>
      <ProgressRing completed={completedToday} total={habits.length} />
      <span className="progress-spark progress-spark--one" /><span className="progress-spark progress-spark--two" /><span className="progress-spark progress-spark--three" />
    </section>

    <section className="reflection-row">
      <div className="reflection-card">
        <div className="reflection-card__header"><div><span className="eyebrow">THIS WEEK</span><h3>今週のペース</h3></div><span className="reflection-card__total">{weekTotal}<small>回</small></span></div>
        <div className="week-bars">{week.map((date) => { const count = habits.filter((habit) => records.some((record) => record.habitId === habit.id && record.completedDate === date)).length; return <div className="week-bar" key={date}><span className={count ? 'has-value' : ''} style={{ height: `${Math.max(count / Math.max(habits.length, 1) * 100, 8)}%` }} /><small>{new Intl.DateTimeFormat('ja-JP', { weekday: 'short' }).format(new Date(`${date}T00:00:00`))}</small></div> })}</div>
      </div>
      <div className="encouragement-card"><span className="encouragement-card__icon">✦</span><div><span className="eyebrow">A LITTLE NOTE</span><h3>{bestHabit && getStreak(bestHabit, records) > 0 ? `${getStreak(bestHabit, records)}日続いています` : '小さく始めよう'}</h3><p>{bestHabit && getStreak(bestHabit, records) > 0 ? `「${bestHabit.name}」の調子がいいですね。` : 'できた日を、ひとつずつ数えていこう。'}</p></div></div>
    </section>
  </div>
}

function HabitsView({ habits, records, onToggle, onOpen, onAdd }: { habits: Habit[]; records: HabitRecord[]; onToggle: (id: string) => void; onOpen: (id: string) => void; onAdd: () => void }) {
  return <PageFrame eyebrow="YOUR HABITS" title="自分の習慣" description="あなたが大切にしている、毎日の小さな約束。"><div className="list-toolbar"><span>{habits.length}個の習慣</span><button className="button button--primary button--small" onClick={onAdd}>＋ 追加する</button></div><div className="habit-grid">{habits.map((habit) => <HabitCard key={habit.id} habit={habit} records={records} completed={records.some((record) => record.habitId === habit.id && record.completedDate === todayISO())} onToggle={() => onToggle(habit.id)} onOpen={() => onOpen(habit.id)} />)}</div>{habits.length === 0 && <EmptyHabits onAdd={onAdd} />}</PageFrame>
}

function DetailView({ habit, records, onBack, onToggle, onEdit, onDelete }: { habit: Habit; records: HabitRecord[]; onBack: () => void; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const completedDates = new Set(records.filter((record) => record.habitId === habit.id).map((record) => record.completedDate))
  const thisWeek = countThisWeek(habit.id, records)
  const streak = getStreak(habit, records)
  const last30 = Array.from({ length: 30 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - index); return date })
  const completedLast30 = last30.filter((date) => completedDates.has(toISODate(date))).length

  return <div className="detail-view page-frame"><button className="back-button" onClick={onBack}>← <span>習慣一覧に戻る</span></button><section className={`detail-hero detail-hero--${habit.tone}`}><span className="detail-hero__icon">{habit.icon}</span><div><span className="eyebrow">HABIT DETAIL</span><h1>{habit.name}</h1><p>{frequencyLabel(habit.frequencyType, habit.targetPerWeek, habit.selectedDays)} · {formatShortDate(habit.startDate)}から</p></div><button className={`detail-hero__action ${completedDates.has(todayISO()) ? 'is-complete' : ''}`} onClick={onToggle}>{completedDates.has(todayISO()) ? '✓ 今日達成' : '今日の完了'}</button></section><div className="stats-grid"><Stat label={habit.frequencyType === 'weekly' ? '今週の達成' : '現在のストリーク'} value={habit.frequencyType === 'weekly' ? `${thisWeek}/${habit.targetPerWeek}` : `${streak}日`} accent="purple" /><Stat label="過去30日の達成率" value={`${percentage(completedLast30, 30)}%`} accent="mint" /><Stat label="記録した日数" value={`${completedDates.size}日`} accent="peach" /></div><section className="detail-section"><div className="section-heading"><div><span className="eyebrow">YOUR RECORD</span><h2>達成カレンダー</h2></div><span className="calendar-legend"><i /> 達成</span></div><CalendarGrid completedDates={completedDates} /></section><div className="detail-actions"><button className="button button--secondary" onClick={onEdit}>✎ 編集する</button><button className="button button--danger" onClick={onDelete}>削除する</button></div></div>
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <div className={`stat-card stat-card--${accent}`}><span>{label}</span><strong>{value}</strong></div>
}

function SettingsView({ onReset }: { onReset: () => void }) {
  return <PageFrame eyebrow="PREFERENCES" title="設定" description="Habit Helperをあなたのペースに合わせて整えます。"><div className="settings-card"><div className="settings-profile"><span className="profile-avatar profile-avatar--large">S</span><div><strong>さきさん</strong><span>自分の習慣を楽しむ人</span></div><span className="settings-status">ローカル保存中</span></div><div className="settings-row"><div><strong>データについて</strong><span>今はこの端末だけで使える仮データモードです。</span></div><span className="settings-row__arrow">›</span></div><div className="settings-row"><div><strong>通知</strong><span>通知機能は次のステップで追加予定です。</span></div><span className="settings-soon">COMING SOON</span></div><div className="settings-row"><div><strong>アカウント</strong><span>ログイン・新規登録はDB接続時に追加します。</span></div><span className="settings-soon">COMING SOON</span></div><button className="reset-button" onClick={onReset}>デモデータを初期状態に戻す</button></div></PageFrame>
}

function EmptyHabits({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-state"><span className="empty-state__icon">✦</span><h3>最初の習慣をつくろう</h3><p>続けたいことをひとつ選んで、<br />今日から始めてみませんか？</p><button className="button button--primary" onClick={onAdd}>習慣を追加する →</button></div>
}

export default App
