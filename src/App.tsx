import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { BottomNavigation } from './components/BottomNavigation'
import { CalendarGrid } from './components/CalendarGrid'
import { HabitCard } from './components/HabitCard'
import { HabitForm } from './components/HabitForm'
import { ProgressRing } from './components/ProgressRing'
import { starterHabits, starterRecords } from './data'
import type { AppView, Habit, HabitRecord } from './types'
import { countThisWeek, formatJapaneseDate, formatShortDate, frequencyLabel, getLongestStreak, getMonday, getPeriodCompletionRate, getStreak, getWeekDates, getWeekdayCompletionRates, isDueToday, percentage, todayISO, toISODate } from './utils'

const STORAGE_KEY = 'habit-helper-local-v1'
const NOTIFICATION_HISTORY_KEY = 'habit-helper-notification-history-v1'
const REMINDER_REPEAT_MINUTES = 60
const MAX_REMINDER_NOTIFICATIONS = 4

type NotificationPermission = 'default' | 'granted' | 'denied' | 'unsupported'
type StoredState = { habits: Habit[]; records: HabitRecord[]; notificationsEnabled: boolean; aiReflectionEnabled: boolean; dailyGoal: number; displayName: string }
type Celebration = { name: string; icon: string }
type NoteTarget = { habitId: string; date: string; name: string; initialNote: string }
const DEFAULT_DAILY_GOAL = 3
const DEFAULT_DISPLAY_NAME = 'さき'
const starterReminderTimes: Record<string, string> = { water: '09:00', workout: '18:00', english: '20:00', stretch: '22:00' }

const normalizeDailyGoal = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DAILY_GOAL
  return Math.min(20, Math.max(1, Math.round(value)))
}

const normalizeDisplayName = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_DISPLAY_NAME
  return value.trim().slice(0, 20)
}

const normalizeHabit = (habit: Habit): Habit => ({
  ...habit,
  reminderEnabled: habit.reminderEnabled ?? true,
  reminderTime: habit.reminderTime ?? starterReminderTimes[habit.id] ?? '20:00',
})

const getDefaultState = (): StoredState => ({
  habits: starterHabits.map(normalizeHabit),
  records: starterRecords,
  notificationsEnabled: false,
  aiReflectionEnabled: true,
  dailyGoal: DEFAULT_DAILY_GOAL,
  displayName: DEFAULT_DISPLAY_NAME,
})

const readStoredState = (): StoredState => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<StoredState>
      return {
        habits: Array.isArray(parsed.habits) ? parsed.habits.map(normalizeHabit) : getDefaultState().habits,
        records: Array.isArray(parsed.records) ? parsed.records : getDefaultState().records,
        notificationsEnabled: parsed.notificationsEnabled ?? false,
        aiReflectionEnabled: parsed.aiReflectionEnabled ?? true,
        dailyGoal: normalizeDailyGoal(parsed.dailyGoal),
        displayName: normalizeDisplayName(parsed.displayName),
      }
    }
  } catch {
    // Local storage is optional for this first prototype.
  }
  return getDefaultState()
}

const getNotificationPermission = (): NotificationPermission => {
  if (!('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

const readNotificationHistory = () => {
  try {
    const stored = localStorage.getItem(NOTIFICATION_HISTORY_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

const rememberNotification = (key: string) => {
  const history = readNotificationHistory().filter((item) => item !== key).slice(-199)
  try {
    localStorage.setItem(NOTIFICATION_HISTORY_KEY, JSON.stringify([...history, key]))
  } catch {
    // Notification history is optional; it only prevents duplicate reminders.
  }
}

const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

const getTone = (index: number): Habit['tone'] => (['mint', 'peach', 'lavender', 'sky', 'yellow'] as const)[index % 5]

function App() {
  const [state, setState] = useState<StoredState>(readStoredState)
  const [activeView, setActiveView] = useState<AppView>('home')
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null)
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [celebration, setCelebration] = useState<Celebration | null>(null)
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(getNotificationPermission)

  const { habits, records } = state
  const today = todayISO()
  const dueHabits = useMemo(() => habits.filter((habit) => isDueToday(habit)), [habits])
  const completedToday = dueHabits.filter((habit) => records.some((record) => record.habitId === habit.id && record.completedDate === today)).length
  const progress = percentage(completedToday, state.dailyGoal)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // The UI remains usable if storage is unavailable.
    }
  }, [state])

  useEffect(() => {
    if (notificationPermission !== 'granted' || !state.notificationsEnabled) return

    const notifyDueHabits = () => {
      const now = new Date()
      const date = toISODate(now)
      const currentMinutes = now.getHours() * 60 + now.getMinutes()
      const history = new Set(readNotificationHistory())

      state.habits
        .filter((habit) => habit.reminderEnabled && habit.reminderTime && isDueToday(habit, now))
        .filter((habit) => !state.records.some((record) => record.habitId === habit.id && record.completedDate === date))
        .forEach((habit) => {
          const reminderMinutes = timeToMinutes(habit.reminderTime ?? '')
          if (reminderMinutes === null || currentMinutes < reminderMinutes) return
          const slot = Math.floor((currentMinutes - reminderMinutes) / REMINDER_REPEAT_MINUTES)
          if (slot >= MAX_REMINDER_NOTIFICATIONS) return
          const key = `${date}:${habit.id}:${slot}`
          if (history.has(key)) return
          const isFollowUp = slot > 0
          const notification = new window.Notification(isFollowUp ? `まだ終わっていません · ${habit.name}` : `${habit.reminderTime} ${habit.name}の時間です`, {
            body: isFollowUp ? `${habit.reminderTime}に予定していた習慣です。今日のうちに記録しましょう。` : '小さく始めよう。完了ボタンから達成を記録できます。',
            tag: `habit-helper-${habit.id}-${slot}`,
          })
          notification.onclick = () => {
            window.focus()
            notification.close()
          }
          rememberNotification(key)
        })
    }

    notifyDueHabits()
    const timer = window.setInterval(notifyDueHabits, 15000)
    return () => window.clearInterval(timer)
  }, [notificationPermission, state.notificationsEnabled, state.habits, state.records])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  useEffect(() => {
    if (!celebration) return
    const timeout = window.setTimeout(() => setCelebration(null), 2600)
    return () => window.clearTimeout(timeout)
  }, [celebration])

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
    const habit = habits.find((item) => item.id === habitId)
    setState((current) => ({
      ...current,
      records: existing
        ? current.records.filter((record) => record.id !== existing.id)
        : [...current.records, { id: `${habitId}-${today}`, habitId, completedDate: today, createdAt: new Date().toISOString() }],
    }))
    if (!existing && habit) {
      setCelebration({ name: habit.name, icon: habit.icon })
      setNoteTarget({ habitId, date: today, name: habit.name, initialNote: '' })
    }
    setNotice(existing ? '完了を取り消しました' : '今日の習慣を記録しました ✓ メモも残せます')
  }

  const saveRecordNote = (note: string) => {
    if (!noteTarget) return
    const trimmedNote = note.trim().slice(0, 120)
    setState((current) => ({
      ...current,
      records: current.records.map((record) => record.habitId === noteTarget.habitId && record.completedDate === noteTarget.date
        ? { ...record, note: trimmedNote || undefined }
        : record),
    }))
    setNoteTarget(null)
    setNotice(trimmedNote ? '達成メモを保存しました' : '達成を記録しました')
  }

  const openNoteEditor = (habitId: string, date: string, initialNote = '') => {
    const habit = habits.find((item) => item.id === habitId)
    if (!habit) return
    setNoteTarget({ habitId, date, name: habit.name, initialNote })
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
      ...current,
      habits: current.habits.filter((item) => item.id !== habitId),
      records: current.records.filter((record) => record.habitId !== habitId),
    }))
    setActiveView('habits')
    setSelectedHabitId(null)
    setNotice('習慣を削除しました')
  }

  const resetDemo = () => {
    if (!window.confirm('デモデータを初期状態に戻しますか？')) return
    setState(getDefaultState())
    setActiveView('home')
    setNotice('デモデータをリセットしました')
  }

  const enableNotifications = async () => {
    if (notificationPermission === 'unsupported') {
      setNotice('このブラウザは通知に対応していません')
      return
    }
    const permission = await window.Notification.requestPermission()
    setNotificationPermission(permission)
    if (permission === 'granted') {
      setState((current) => ({ ...current, notificationsEnabled: true }))
      setNotice('通知を有効にしました')
    } else if (permission === 'denied') {
      setNotice('通知がブロックされています。ブラウザの設定を確認してください')
    }
  }

  const disableNotifications = () => {
    setState((current) => ({ ...current, notificationsEnabled: false }))
    setNotice('通知を停止しました')
  }

  const updateDailyGoal = (value: number) => {
    setState((current) => ({ ...current, dailyGoal: normalizeDailyGoal(value) }))
  }

  const updateDisplayName = (value: string) => {
    setState((current) => ({ ...current, displayName: value.slice(0, 20) }))
  }

  const updateAiReflection = (enabled: boolean) => {
    setState((current) => ({ ...current, aiReflectionEnabled: enabled }))
  }

  const sendTestNotification = () => {
    if (notificationPermission !== 'granted') return
    const notification = new window.Notification('Habit Helper', {
      body: '通知は正常に動作しています。習慣をひとつ続けてみましょう。',
      tag: 'habit-helper-test',
    })
    notification.onclick = () => {
      window.focus()
      notification.close()
    }
    setNotice('テスト通知を送りました')
  }

  const selectedHabit = habits.find((habit) => habit.id === selectedHabitId)
  const editingHabit = habits.find((habit) => habit.id === editingHabitId)
  const displayNameInitial = state.displayName.slice(0, 1)

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
            <div className="profile-copy"><strong>こんにちは、{state.displayName}さん</strong><span>今日もいい一日にしよう</span></div>
            <span className="profile-avatar">{displayNameInitial}</span>
          </div>
        </header>

        {activeView === 'home' && <HomeView habits={dueHabits} allHabits={habits} records={records} completedToday={completedToday} dailyGoal={state.dailyGoal} progress={progress} aiReflectionEnabled={state.aiReflectionEnabled} onToggle={toggleCompletion} onOpen={openDetail} onAdd={() => navigate('create')} onViewAll={() => navigate('habits')} />}
        {activeView === 'habits' && <HabitsView habits={habits} records={records} onToggle={toggleCompletion} onOpen={openDetail} onAdd={() => navigate('create')} />}
        {activeView === 'create' && <PageFrame eyebrow={editingHabit ? 'EDIT HABIT' : 'NEW HABIT'} title={editingHabit ? '習慣を整える' : '新しい習慣をつくる'} description={editingHabit ? '今のあなたに合うように、いつでも調整できます。' : '続けたいことをひとつだけ。小さく始めるのがコツです。'}><HabitForm initialHabit={editingHabit} onSubmit={saveHabit} onCancel={() => editingHabit ? openDetail(editingHabit.id) : navigate('home')} /></PageFrame>}
        {activeView === 'detail' && selectedHabit && <DetailView habit={selectedHabit} records={records} onBack={() => navigate('habits')} onToggle={() => toggleCompletion(selectedHabit.id)} onEdit={() => { setEditingHabitId(selectedHabit.id); setActiveView('create') }} onEditNote={(record) => openNoteEditor(selectedHabit.id, record.completedDate, record.note ?? '')} onDelete={() => deleteHabit(selectedHabit.id)} />}
        {activeView === 'settings' && <SettingsView displayName={state.displayName} onDisplayNameChange={updateDisplayName} onReset={resetDemo} dailyGoal={state.dailyGoal} onDailyGoalChange={updateDailyGoal} notificationsEnabled={state.notificationsEnabled} aiReflectionEnabled={state.aiReflectionEnabled} notificationPermission={notificationPermission} onEnableNotifications={enableNotifications} onDisableNotifications={disableNotifications} onTestNotification={sendTestNotification} onAiReflectionChange={updateAiReflection} />}

        <BottomNavigation activeView={activeView} onNavigate={navigate} />
        {celebration && <CelebrationOverlay celebration={celebration} />}
        {noteTarget && <NoteDialog target={noteTarget} onSave={saveRecordNote} onSkip={() => setNoteTarget(null)} />}
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
  dailyGoal: number
  progress: number
  aiReflectionEnabled: boolean
  onToggle: (habitId: string) => void
  onOpen: (habitId: string) => void
  onAdd: () => void
  onViewAll: () => void
}

function HomeView({ habits, allHabits, records, completedToday, dailyGoal, progress, aiReflectionEnabled, onToggle, onOpen, onAdd, onViewAll }: HomeViewProps) {
  const week = getWeekDates()
  const weekTotal = habits.reduce((total, habit) => total + countThisWeek(habit.id, records), 0)
  const bestHabit = allHabits.slice().sort((a, b) => getStreak(b, records) - getStreak(a, records))[0]
  const bestStreak = bestHabit ? getStreak(bestHabit, records) : 0
  const currentStreak = Math.max(0, ...allHabits.map((habit) => getStreak(habit, records)))
  const longestStreak = Math.max(0, ...allHabits.map((habit) => getLongestStreak(habit, records)))
  const now = new Date()
  const weekRate = getPeriodCompletionRate(allHabits, records, getMonday(now), now)
  const monthRate = getPeriodCompletionRate(allHabits, records, new Date(now.getFullYear(), now.getMonth(), 1), now)
  const weekdayRates = getWeekdayCompletionRates(allHabits, records, now)
  const last30Start = new Date(now)
  last30Start.setDate(last30Start.getDate() - 29)
  const habitRates = allHabits.map((habit) => ({ habit, rate: getPeriodCompletionRate([habit], records, last30Start, now) }))
  const focusHabit = habitRates.slice().sort((a, b) => a.rate - b.rate)[0]
  const focusDay = weekdayRates.filter((item) => item.target > 0).slice().sort((a, b) => a.rate - b.rate)[0]
  const totalCompletions = records.filter((record) => allHabits.some((habit) => habit.id === record.habitId)).length
  const levelName = longestStreak >= 30 ? '習慣マスター' : longestStreak >= 7 ? '初心者' : 'はじめの一歩'
  const achievements = [
    { icon: '🌱', title: '初心者', detail: '7日継続', unlocked: longestStreak >= 7 },
    { icon: '🏆', title: '習慣マスター', detail: '30日継続', unlocked: longestStreak >= 30 },
    { icon: '🎯', title: '実績解除', detail: '100回達成', unlocked: totalCompletions >= 100 },
  ]
  const reflectionBody = focusHabit && focusDay
    ? `「${focusHabit.habit.name}」は直近30日で${focusHabit.rate}%達成。${focusDay.label}曜日が${focusDay.rate}%と少し低めなので、その曜日だけ目標を軽くしてみると続けやすそうです。`
    : focusHabit
      ? `「${focusHabit.habit.name}」の直近30日の達成率は${focusHabit.rate}%です。無理のない小さな行動に分けて続けてみましょう。`
      : '記録が増えると、あなたの続きやすい曜日やペースをここで振り返れます。'

  return <div className="home-view">
    <div className="date-strip"><span className="date-strip__dot" aria-hidden="true" />今日 · {formatJapaneseDate()}</div>

    <section className="welcome-row">
      <div><h1>おかえりなさい。<br /><em>今日も一歩ずつ。</em></h1></div>
      <button className="button button--primary button--add" onClick={onAdd}><span aria-hidden="true">＋</span> 習慣を追加</button>
    </section>

    <section className="streak-summary" aria-label={`続いている日数 ${bestStreak}日`}>
      <span className="streak-summary__icon" aria-hidden="true">🔥</span>
      <div className="streak-summary__copy">
        <span className="eyebrow">YOUR STREAK</span>
        <div className="streak-summary__value"><strong>{bestStreak}</strong><span>日続いています</span></div>
        <p>{bestStreak > 0 && bestHabit ? `「${bestHabit.name}」の記録` : '今日から小さく始めよう'}</p>
      </div>
      <span className="streak-summary__spark" aria-hidden="true">✦</span>
    </section>

    <section className="section-block today-section">
      <div className="section-heading"><div><span className="eyebrow">FOR TODAY</span><h2>今日やること</h2></div><button className="text-button" onClick={onViewAll}>すべて見る <span aria-hidden="true">→</span></button></div>
      <div className="habit-stack">
        {habits.length === 0 ? <EmptyHabits onAdd={onAdd} /> : habits.map((habit) => <HabitCard key={habit.id} habit={habit} records={records} completed={records.some((record) => record.habitId === habit.id && record.completedDate === todayISO())} onToggle={() => onToggle(habit.id)} onOpen={() => onOpen(habit.id)} />)}
      </div>
    </section>

    <section className="progress-panel">
      <div className="progress-panel__copy"><span className="eyebrow eyebrow--light">TODAY'S PROGRESS</span><h2>今日のリズム</h2><p>{progress === 100 ? 'すべての習慣を達成しました。すてきです！' : 'ひとつずつ、できたことを積み重ねよう。'}</p><div className="progress-panel__count"><strong>{Math.min(completedToday, dailyGoal)}</strong><span> / {dailyGoal} habits</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><span className="progress-panel__caption">{progress === 100 ? '今日の目標をクリア！' : `あと${Math.max(dailyGoal - completedToday, 0)}つで今日の目標達成`}</span></div>
      <ProgressRing completed={Math.min(completedToday, dailyGoal)} total={dailyGoal} />
      <span className="progress-spark progress-spark--one" /><span className="progress-spark progress-spark--two" /><span className="progress-spark progress-spark--three" />
    </section>

    <section className="reflection-row">
      <div className="reflection-card">
        <div className="reflection-card__header"><div><span className="eyebrow">THIS WEEK</span><h3>今週のペース</h3></div><span className="reflection-card__total">{weekTotal}<small>回</small></span></div>
        <div className="week-bars">{week.map((date) => { const count = habits.filter((habit) => records.some((record) => record.habitId === habit.id && record.completedDate === date)).length; return <div className="week-bar" key={date}><span className={count ? 'has-value' : ''} style={{ height: `${Math.max(count / Math.max(habits.length, 1) * 100, 8)}%` }} /><small>{new Intl.DateTimeFormat('ja-JP', { weekday: 'short' }).format(new Date(`${date}T00:00:00`))}</small></div> })}</div>
      </div>
      <div className="encouragement-card"><span className="encouragement-card__icon">✦</span><div><span className="eyebrow">A LITTLE NOTE</span><h3>{bestHabit && getStreak(bestHabit, records) > 0 ? `${getStreak(bestHabit, records)}日続いています` : '小さく始めよう'}</h3><p>{bestHabit && getStreak(bestHabit, records) > 0 ? `「${bestHabit.name}」の調子がいいですね。` : 'できた日を、ひとつずつ数えていこう。'}</p></div></div>
    </section>

    <section className="stats-overview">
      <div className="section-heading"><div><span className="eyebrow">YOUR PROGRESS</span><h2>続け方を見える化</h2></div><span className="stats-overview__hint">過去の記録から集計</span></div>
      <div className="stats-overview__cards">
        <div className="metric-card metric-card--purple"><span>今週の達成率</span><strong>{weekRate}%</strong></div>
        <div className="metric-card metric-card--mint"><span>今月の達成率</span><strong>{monthRate}%</strong></div>
        <div className="metric-card metric-card--peach"><span>最長継続</span><strong>{longestStreak}<small>日</small></strong></div>
        <div className="metric-card metric-card--sky"><span>現在の継続</span><strong>{currentStreak}<small>日</small></strong></div>
      </div>
      <div className="weekday-chart">
        <div className="weekday-chart__header"><strong>曜日別達成率</strong><span>直近30日</span></div>
        <div className="weekday-chart__bars">
          {weekdayRates.map((item) => <div className="weekday-chart__item" key={item.label} aria-label={`${item.label}曜日 ${item.rate}%`}><div className="weekday-chart__track"><span style={{ height: `${Math.max(item.rate, 7)}%` }} /></div><small>{item.label}</small><b>{item.rate}%</b></div>)}
        </div>
      </div>
    </section>

    <section className="achievement-section">
      <div className="achievement-section__header"><div><span className="eyebrow">LEVEL & ACHIEVEMENTS</span><h2>続けるほど育つ</h2></div><div className="level-badge"><span>LEVEL</span><strong>{levelName}</strong><small>{totalCompletions}回記録</small></div></div>
      <div className="achievement-list">
        {achievements.map((achievement) => <div className={`achievement-item ${achievement.unlocked ? 'is-unlocked' : ''}`} key={achievement.title}><span className="achievement-item__icon">{achievement.unlocked ? achievement.icon : '🔒'}</span><span><strong>{achievement.title}</strong><small>{achievement.detail}</small></span><b>{achievement.unlocked ? '解除済み' : '未解除'}</b></div>)}
      </div>
    </section>

    {aiReflectionEnabled && <section className="ai-reflection-card"><div className="ai-reflection-card__icon">✦</div><div><span className="eyebrow">AI REFLECTION</span><h2>今日の振り返り</h2><p>{reflectionBody}</p><small>記録データから自動で分析しています。設定からON/OFFを切り替えられます。</small></div></section>}
  </div>
}

function HabitsView({ habits, records, onToggle, onOpen, onAdd }: { habits: Habit[]; records: HabitRecord[]; onToggle: (id: string) => void; onOpen: (id: string) => void; onAdd: () => void }) {
  return <PageFrame eyebrow="YOUR HABITS" title="自分の習慣" description="あなたが大切にしている、毎日の小さな約束。"><div className="list-toolbar"><span>{habits.length}個の習慣</span><button className="button button--primary button--small" onClick={onAdd}>＋ 追加する</button></div><div className="habit-grid">{habits.map((habit) => <HabitCard key={habit.id} habit={habit} records={records} completed={records.some((record) => record.habitId === habit.id && record.completedDate === todayISO())} onToggle={() => onToggle(habit.id)} onOpen={() => onOpen(habit.id)} />)}</div>{habits.length === 0 && <EmptyHabits onAdd={onAdd} />}</PageFrame>
}

function DetailView({ habit, records, onBack, onToggle, onEdit, onEditNote, onDelete }: { habit: Habit; records: HabitRecord[]; onBack: () => void; onToggle: () => void; onEdit: () => void; onEditNote: (record: HabitRecord) => void; onDelete: () => void }) {
  const completedDates = new Set(records.filter((record) => record.habitId === habit.id).map((record) => record.completedDate))
  const thisWeek = countThisWeek(habit.id, records)
  const streak = getStreak(habit, records)
  const last30 = Array.from({ length: 30 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - index); return date })
  const completedLast30 = last30.filter((date) => completedDates.has(toISODate(date))).length
  const noteRecords = records.filter((record) => record.habitId === habit.id && record.note).slice().sort((a, b) => b.completedDate.localeCompare(a.completedDate))

  return <div className="detail-view page-frame"><button className="back-button" onClick={onBack}>← <span>習慣一覧に戻る</span></button><section className={`detail-hero detail-hero--${habit.tone}`}><span className="detail-hero__icon">{habit.icon}</span><div><span className="eyebrow">HABIT DETAIL</span><h1>{habit.name}</h1><p>{frequencyLabel(habit.frequencyType, habit.targetPerWeek, habit.selectedDays, habit.targetPerMonth)} · {formatShortDate(habit.startDate)}から</p></div><button className={`detail-hero__action ${completedDates.has(todayISO()) ? 'is-complete' : ''}`} onClick={onToggle}>{completedDates.has(todayISO()) ? '✓ 今日達成' : '今日の完了'}</button></section><div className="stats-grid"><Stat label={habit.frequencyType === 'weekly' ? '今週の達成' : '現在のストリーク'} value={habit.frequencyType === 'weekly' ? `${thisWeek}/${habit.targetPerWeek}` : `${streak}日`} accent="purple" /><Stat label="過去30日の達成率" value={`${percentage(completedLast30, 30)}%`} accent="mint" /><Stat label="記録した日数" value={`${completedDates.size}日`} accent="peach" /></div><section className="detail-section"><div className="section-heading"><div><span className="eyebrow">YOUR RECORD</span><h2>達成カレンダー</h2></div><span className="calendar-legend"><i /> 達成</span></div><CalendarGrid completedDates={completedDates} /></section><section className="detail-section detail-notes"><div className="section-heading"><div><span className="eyebrow">YOUR NOTES</span><h2>達成メモ</h2></div><span className="settings-soon">SHORT NOTES</span></div>{noteRecords.length ? <div className="note-list">{noteRecords.map((record) => <div className="note-item" key={record.id}><div><span>{formatShortDate(record.completedDate)}</span><p>{record.note}</p></div><button className="text-button" onClick={() => onEditNote(record)}>編集</button></div>)}</div> : <p className="note-empty">完了したときに、短いメモを残せます。</p>}</section><div className="detail-actions"><button className="button button--secondary" onClick={onEdit}>✎ 編集する</button><button className="button button--danger" onClick={onDelete}>削除する</button></div></div>
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <div className={`stat-card stat-card--${accent}`}><span>{label}</span><strong>{value}</strong></div>
}

type SettingsViewProps = {
  displayName: string
  onDisplayNameChange: (value: string) => void
  onReset: () => void
  dailyGoal: number
  onDailyGoalChange: (value: number) => void
  notificationsEnabled: boolean
  aiReflectionEnabled: boolean
  notificationPermission: NotificationPermission
  onEnableNotifications: () => void
  onDisableNotifications: () => void
  onTestNotification: () => void
  onAiReflectionChange: (enabled: boolean) => void
}

function SettingsView({ displayName, onDisplayNameChange, onReset, dailyGoal, onDailyGoalChange, notificationsEnabled, aiReflectionEnabled, notificationPermission, onEnableNotifications, onDisableNotifications, onTestNotification, onAiReflectionChange }: SettingsViewProps) {
  const notificationDescription = notificationPermission === 'unsupported'
    ? 'このブラウザは通知に対応していません。'
    : notificationPermission === 'denied'
      ? '通知がブロックされています。ブラウザの設定から許可してください。'
      : notificationsEnabled
        ? '習慣ごとに設定した時間に通知します。'
        : '通知を許可すると、習慣の時間にお知らせします。'

  return <PageFrame eyebrow="PREFERENCES" title="設定" description="Habit Helperをあなたのペースに合わせて整えます。"><div className="settings-card"><div className="settings-profile"><span className="profile-avatar profile-avatar--large">{displayName.slice(0, 1)}</span><div><strong>{displayName}さん</strong><span>自分の習慣を楽しむ人</span></div><span className="settings-status">ローカル保存中</span></div><div className="settings-row settings-row--name"><div><strong>表示名</strong><span>ホーム画面の挨拶に表示する名前です。</span></div><input className="name-input" type="text" value={displayName} maxLength={20} aria-label="表示名" onChange={(event) => onDisplayNameChange(event.target.value)} /></div><div className="settings-row"><div><strong>データについて</strong><span>今はこの端末だけで使える仮データモードです。</span></div><span className="settings-row__arrow">›</span></div><div className="settings-row settings-row--goal"><div><strong>今日のリズムの目標</strong><span>進捗リングに表示する、1日の目標習慣数です。</span></div><label className="goal-control"><input className="goal-input" type="number" min="1" max="20" value={dailyGoal} onChange={(event) => onDailyGoalChange(Number(event.target.value))} /><span>習慣</span></label></div><div className="settings-row settings-row--notifications"><div><strong>習慣の通知</strong><span>{notificationDescription}</span></div><div className="notification-actions">{notificationsEnabled && notificationPermission === 'granted' ? <><button className="button button--ghost button--small" onClick={onDisableNotifications}>通知を停止</button><button className="button button--secondary button--small" onClick={onTestNotification}>テスト通知</button></> : <button className="button button--primary button--small" onClick={onEnableNotifications} disabled={notificationPermission === 'unsupported'}>通知を有効にする</button>}</div></div><p className="notification-note">通知はこの端末のブラウザ上で、アプリを開いている間に動作します。習慣ごとの時刻は習慣の編集画面から変更できます。通知時刻を過ぎても未完了の場合は、1時間おきに最大3回再通知します。</p><div className="settings-row settings-row--ai"><div><strong>AIによる振り返り</strong><span>記録データから達成率や曜日別の傾向を自動分析します。</span></div><label className="switch-control"><input type="checkbox" checked={aiReflectionEnabled} onChange={(event) => onAiReflectionChange(event.target.checked)} /><span className="switch-control__track" aria-hidden="true"><span /></span><span className="sr-only">AIによる振り返りを有効にする</span></label></div><div className="settings-row"><div><strong>アカウント</strong><span>ログイン・新規登録はDB接続時に追加します。</span></div><span className="settings-soon">COMING SOON</span></div><button className="reset-button" onClick={onReset}>デモデータを初期状態に戻す</button></div></PageFrame>
}

function EmptyHabits({ onAdd }: { onAdd: () => void }) {
  return <div className="empty-state"><span className="empty-state__icon">✦</span><h3>最初の習慣をつくろう</h3><p>続けたいことをひとつ選んで、<br />今日から始めてみませんか？</p><button className="button button--primary" onClick={onAdd}>習慣を追加する →</button></div>
}

function CelebrationOverlay({ celebration }: { celebration: Celebration }) {
  const confetti = ['✦', '•', '◆', '✧', '●', '＋', '✦', '•', '◆', '✧']

  return <div className="celebration" role="status" aria-live="polite" aria-label={`${celebration.name}を完了しました`}>
    <div className="celebration__backdrop" aria-hidden="true" />
    <div className="celebration__confetti" aria-hidden="true">
      {confetti.map((item, index) => <span key={`${item}-${index}`} className={`celebration__confetti-piece celebration__confetti-piece--${index + 1}`}>{item}</span>)}
    </div>
    <div className="celebration__card">
      <span className="celebration__icon" aria-hidden="true">{celebration.icon}</span>
      <span className="eyebrow">WELL DONE</span>
      <h2>「{celebration.name}」達成！</h2>
      <p>今日も一歩、前に進みました。</p>
      <span className="celebration__star celebration__star--one" aria-hidden="true">✦</span>
      <span className="celebration__star celebration__star--two" aria-hidden="true">✦</span>
    </div>
  </div>
}

function NoteDialog({ target, onSave, onSkip }: { target: NoteTarget; onSave: (note: string) => void; onSkip: () => void }) {
  const [note, setNote] = useState(target.initialNote)

  useEffect(() => {
    setNote(target.initialNote)
  }, [target])

  return <div className="note-dialog" role="dialog" aria-modal="true" aria-label={`${target.name}の達成メモ`}>
    <button className="note-dialog__backdrop" aria-label="メモを閉じる" onClick={onSkip} />
    <form className="note-dialog__card" onSubmit={(event) => { event.preventDefault(); onSave(note) }}>
      <span className="note-dialog__icon" aria-hidden="true">✎</span>
      <span className="eyebrow">A LITTLE NOTE</span>
      <h2>今日のメモを残す？</h2>
      <p>「{target.name}」について、短く記録できます。</p>
      <textarea className="note-dialog__input" value={note} maxLength={120} autoFocus placeholder="例：今日は30分走った" onChange={(event) => setNote(event.target.value)} />
      <div className="note-dialog__footer"><small>{note.length}/120</small><div><button type="button" className="button button--ghost button--small" onClick={onSkip}>あとで</button><button type="submit" className="button button--primary button--small">メモを保存</button></div></div>
    </form>
  </div>
}

export default App
