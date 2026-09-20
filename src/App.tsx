import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { BottomNavigation } from './components/BottomNavigation'
import { CalendarGrid } from './components/CalendarGrid'
import { HabitCard } from './components/HabitCard'
import { HabitForm } from './components/HabitForm'
import { ProgressRing } from './components/ProgressRing'
import { clearSession, createHabit, deleteHabit as deleteRemoteHabit, deleteRecord, fetchAppData, getStoredSession, resetUserData, saveSession, signIn, signUp, updateHabit as updateRemoteHabit, updateProfile, upsertRecord } from './api'
import type { AuthSession, RemoteAppData } from './api'
import type { AppView, FrequencyType, GoalUnit, Habit, HabitRecord } from './types'
import { countThisWeek, formatJapaneseDate, formatShortDate, frequencyLabel, getLongestStreak, getMonday, getPeriodCompletionRate, getPeriodProgress, getStreak, getSuggestedReminderTime, getWeekdayCompletionRates, isDueToday, percentage, todayISO, toISODate } from './utils'

const NOTIFICATION_HISTORY_KEY = 'habit-helper-notification-history-v1'
const REMINDER_REPEAT_MINUTES = 60
const MAX_REMINDER_NOTIFICATIONS = 4

type NotificationPermission = 'default' | 'granted' | 'denied' | 'unsupported'
type StoredState = { habits: Habit[]; records: HabitRecord[]; notificationsEnabled: boolean; aiReflectionEnabled: boolean; dailyGoal: number; displayName: string }
type Celebration = { name: string; icon: string }
type NoteTarget = { habitId: string; date: string; name: string; initialNote: string; initialAmount?: number; targetValue?: number; targetUnit?: string }
const DEFAULT_DAILY_GOAL = 3
const DEFAULT_DISPLAY_NAME = 'さき'

const normalizeDailyGoal = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DAILY_GOAL
  return Math.min(20, Math.max(1, Math.round(value)))
}

const normalizeDisplayName = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_DISPLAY_NAME
  return value.trim().slice(0, 20)
}

const getNotificationPermission = (): NotificationPermission => {
  if (!('Notification' in window)) return 'unsupported'
  return window.Notification.permission
}

const readNotificationHistory = (userId: string) => {
  try {
    const stored = localStorage.getItem(`${NOTIFICATION_HISTORY_KEY}:${userId}`)
    const parsed = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

const rememberNotification = (userId: string, key: string) => {
  const history = readNotificationHistory(userId).filter((item) => item !== key).slice(-199)
  try {
    localStorage.setItem(`${NOTIFICATION_HISTORY_KEY}:${userId}`, JSON.stringify([...history, key]))
  } catch {
    // Notification history is optional; it only prevents duplicate reminders.
  }
}

const timeToMinutes = (time: string) => {
  const [hours, minutes] = time.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

const mapRemoteHabit = (row: Record<string, unknown>): Habit => ({
  id: String(row.id),
  name: String(row.name ?? ''),
  icon: String(row.icon ?? '💧'),
  frequencyType: String(row.frequency_type ?? 'daily') as FrequencyType,
  targetPerWeek: typeof row.target_per_week === 'number' ? row.target_per_week : undefined,
  targetPerMonth: typeof row.target_per_month === 'number' ? row.target_per_month : undefined,
  targetValue: typeof row.target_value === 'number' ? row.target_value : undefined,
  targetUnit: typeof row.target_unit === 'string' ? row.target_unit as GoalUnit : undefined,
  selectedDays: Array.isArray(row.selected_days) ? row.selected_days as number[] : undefined,
  reminderEnabled: row.reminder_enabled !== false,
  reminderTime: String(row.reminder_time ?? '20:00'),
  smartReminder: row.smart_reminder === true,
  startDate: String(row.start_date),
  endDate: typeof row.end_date === 'string' ? row.end_date : undefined,
  createdAt: String(row.created_at),
  tone: String(row.tone ?? 'mint') as Habit['tone'],
})

const getProgressInsights = (habits: Habit[], records: HabitRecord[], now = new Date()) => {
  const weekStart = getMonday(now)
  const previousWeekStart = new Date(weekStart)
  previousWeekStart.setDate(previousWeekStart.getDate() - 7)
  const previousWeekEnd = new Date(weekStart)
  previousWeekEnd.setDate(previousWeekEnd.getDate() - 1)
  const currentStreak = Math.max(0, ...habits.map((habit) => getStreak(habit, records)))
  const longestStreak = Math.max(0, ...habits.map((habit) => getLongestStreak(habit, records)))
  const weekProgress = getPeriodProgress(habits, records, weekStart, now)
  const previousWeekProgress = getPeriodProgress(habits, records, previousWeekStart, previousWeekEnd)
  const weekRate = weekProgress.rate
  const previousWeekRate = previousWeekProgress.rate
  const monthRate = getPeriodCompletionRate(habits, records, new Date(now.getFullYear(), now.getMonth(), 1), now)
  const weekdayRates = getWeekdayCompletionRates(habits, records, now)
  const last30Start = new Date(now)
  last30Start.setDate(last30Start.getDate() - 29)
  const habitRates = habits.map((habit) => ({ habit, rate: getPeriodCompletionRate([habit], records, last30Start, now) }))
  const focusHabit = habitRates.slice().sort((a, b) => a.rate - b.rate)[0]
  const focusDay = weekdayRates.filter((item) => item.target > 0).slice().sort((a, b) => a.rate - b.rate)[0]
  const totalCompletions = records.filter((record) => habits.some((habit) => habit.id === record.habitId)).length
  const levelName = longestStreak >= 30 ? '習慣マスター' : longestStreak >= 7 ? '初心者' : 'はじめの一歩'
  return { weekStart, weekProgress, previousWeekProgress, weekRate, previousWeekRate, monthRate, currentStreak, longestStreak, weekdayRates, focusHabit, focusDay, totalCompletions, levelName }
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(() => getStoredSession())
  const [remoteUser, setRemoteUser] = useState<RemoteAppData['user'] | null>(null)
  const [state, setState] = useState<StoredState | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [activeView, setActiveView] = useState<AppView>('home')
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null)
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [celebration, setCelebration] = useState<Celebration | null>(null)
  const [noteTarget, setNoteTarget] = useState<NoteTarget | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(getNotificationPermission)

  const habits = state?.habits ?? []
  const records = state?.records ?? []
  const today = todayISO()
  const dueHabits = useMemo(() => habits.filter((habit) => isDueToday(habit)), [habits])
  const completedToday = dueHabits.filter((habit) => records.some((record) => record.habitId === habit.id && record.completedDate === today)).length
  const progress = percentage(completedToday, state?.dailyGoal ?? DEFAULT_DAILY_GOAL)

  useEffect(() => {
    if (!session) {
      setState(null)
      setRemoteUser(null)
      setAuthLoading(false)
      return
    }
    let cancelled = false
    setAuthLoading(true)
    fetchAppData(session)
      .then((data) => {
        if (cancelled) return
        setRemoteUser(data.user)
        setState({
          habits: data.habits,
          records: data.records,
          notificationsEnabled: data.preferences.notificationsEnabled,
          aiReflectionEnabled: data.preferences.aiReflectionEnabled,
          dailyGoal: normalizeDailyGoal(data.preferences.dailyGoal),
          displayName: normalizeDisplayName(data.user.name),
        })
        setAuthError('')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        clearSession()
        setSession(null)
        setState(null)
        setAuthError(error instanceof Error ? error.message : 'ログインセッションを確認できませんでした')
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false)
      })
    return () => { cancelled = true }
  }, [session])

  useEffect(() => {
    if (!session || !state || notificationPermission !== 'granted' || !state.notificationsEnabled) return

    const notifyDueHabits = () => {
      const now = new Date()
      const date = toISODate(now)
      const currentMinutes = now.getHours() * 60 + now.getMinutes()
      const history = new Set(readNotificationHistory(session.user.id))

      state.habits
        .filter((habit) => habit.reminderEnabled && habit.reminderTime && isDueToday(habit, now))
        .filter((habit) => !state.records.some((record) => record.habitId === habit.id && record.completedDate === date))
        .forEach((habit) => {
          const reminderTime = habit.smartReminder ? getSuggestedReminderTime(habit.id, state.records) ?? habit.reminderTime : habit.reminderTime
          const reminderMinutes = timeToMinutes(reminderTime ?? '')
          if (reminderMinutes === null || currentMinutes < reminderMinutes) return
          const slot = Math.floor((currentMinutes - reminderMinutes) / REMINDER_REPEAT_MINUTES)
          if (slot >= MAX_REMINDER_NOTIFICATIONS) return
          const key = `${date}:${habit.id}:${slot}`
          if (history.has(key)) return
          const isFollowUp = slot > 0
          const notification = new window.Notification(isFollowUp ? `まだ終わっていません · ${habit.name}` : `${reminderTime} ${habit.name}の時間です`, {
            body: isFollowUp ? `${reminderTime}に予定していた習慣です。今日のうちに記録しましょう。` : '小さく始めよう。完了ボタンから達成を記録できます。',
            tag: `habit-helper-${habit.id}-${slot}`,
          })
          notification.onclick = () => {
            window.focus()
            notification.close()
          }
          rememberNotification(session.user.id, key)
        })
    }

    notifyDueHabits()
    const timer = window.setInterval(notifyDueHabits, 15000)
    return () => window.clearInterval(timer)
  }, [notificationPermission, session, state?.notificationsEnabled, state?.habits, state?.records])

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

  const startEditingHabit = (habitId: string) => {
    setEditingHabitId(habitId)
    setActiveView('create')
  }

  const toggleCompletion = async (habitId: string, date = today) => {
    if (!session || !state) return
    if (date > today) {
      setNotice('未来の日付は記録できません')
      return
    }
    const habit = habits.find((item) => item.id === habitId)
    if (habit && !isDueToday(habit, new Date(`${date}T00:00:00`))) {
      setNotice('この日は設定した実行日に含まれていません')
      return
    }
    const existing = records.find((record) => record.habitId === habitId && record.completedDate === date)
    try {
      if (existing) {
        await deleteRecord(session, habitId, date)
        setState((current) => current ? { ...current, records: current.records.filter((record) => record.id !== existing.id) } : current)
      } else {
        const saved = await upsertRecord(session, { habitId, completedDate: date })
        const nextRecord: HabitRecord = { id: String(saved.id), habitId, completedDate: date, createdAt: String(saved.created_at ?? new Date().toISOString()) }
        setState((current) => current ? { ...current, records: [...current.records, nextRecord] } : current)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '記録の保存に失敗しました')
      return
    }
    if (!existing && habit && date === today) {
      setCelebration({ name: habit.name, icon: habit.icon })
      setNoteTarget({ habitId, date: today, name: habit.name, initialNote: '', targetValue: habit.targetValue, targetUnit: habit.targetUnit })
    }
    setNotice(existing ? `${date === today ? '今日' : formatShortDate(date)}の完了を取り消しました` : `${date === today ? '今日' : formatShortDate(date)}の達成を記録しました${date === today ? ' ✓ メモも残せます' : ''}`)
  }

  const saveRecordNote = async (note: string, amount?: number) => {
    if (!noteTarget || !session) return
    const trimmedNote = note.trim().slice(0, 120)
    try {
      const saved = await upsertRecord(session, { habitId: noteTarget.habitId, completedDate: noteTarget.date, note: trimmedNote, amount })
      setState((current) => current ? {
        ...current,
        records: current.records.map((record) => record.habitId === noteTarget.habitId && record.completedDate === noteTarget.date
          ? { ...record, id: String(saved.id ?? record.id), note: trimmedNote || undefined, amount: amount && Number.isFinite(amount) ? amount : undefined }
          : record),
      } : current)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'メモの保存に失敗しました')
      return
    }
    setNoteTarget(null)
    setNotice(trimmedNote ? '達成メモを保存しました' : '達成を記録しました')
  }

  const openNoteEditor = (habitId: string, date: string, initialNote = '') => {
    const habit = habits.find((item) => item.id === habitId)
    if (!habit) return
    const record = records.find((item) => item.habitId === habitId && item.completedDate === date)
    setNoteTarget({ habitId, date, name: habit.name, initialNote, initialAmount: record?.amount, targetValue: habit.targetValue, targetUnit: habit.targetUnit })
  }

  const saveHabit = async (values: Omit<Habit, 'id' | 'createdAt'>) => {
    if (!session || !state) return
    try {
      if (editingHabitId) {
        const saved = await updateRemoteHabit(session, editingHabitId, values)
        const updatedHabit = mapRemoteHabit(saved)
        setState((current) => current ? { ...current, habits: current.habits.map((habit) => habit.id === editingHabitId ? updatedHabit : habit) } : current)
        setSelectedHabitId(editingHabitId)
        setEditingHabitId(null)
        setActiveView('detail')
        setNotice('習慣を更新しました')
        return
      }

      const saved = await createHabit(session, values)
      const newHabit = mapRemoteHabit(saved)
      setState((current) => current ? { ...current, habits: [...current.habits, newHabit] } : current)
      setActiveView('habits')
      setNotice('新しい習慣を追加しました')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '習慣の保存に失敗しました')
    }
  }

  const deleteHabit = async (habitId: string) => {
    const habit = habits.find((item) => item.id === habitId)
    if (!habit || !window.confirm(`「${habit.name}」を削除しますか？`)) return
    if (!session) return
    try {
      await deleteRemoteHabit(session, habitId)
      setState((current) => current ? {
        ...current,
        habits: current.habits.filter((item) => item.id !== habitId),
        records: current.records.filter((record) => record.habitId !== habitId),
      } : current)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '習慣の削除に失敗しました')
      return
    }
    if (activeView === 'detail') setActiveView('habits')
    setSelectedHabitId(null)
    setNotice('習慣を削除しました')
  }

  const resetDemo = async () => {
    if (!session || !window.confirm('自分の習慣と達成記録をすべて削除しますか？')) return
    try {
      await resetUserData(session)
      setState((current) => current ? { ...current, habits: [], records: [] } : current)
      setActiveView('home')
      setNotice('自分のデータをリセットしました')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'データのリセットに失敗しました')
    }
  }

  const enableNotifications = async () => {
    if (notificationPermission === 'unsupported') {
      setNotice('このブラウザは通知に対応していません')
      return
    }
    const permission = await window.Notification.requestPermission()
    setNotificationPermission(permission)
    if (permission === 'granted') {
      setState((current) => current ? { ...current, notificationsEnabled: true } : current)
      if (session) {
        try { await updateProfile(session, { notificationsEnabled: true }) } catch { setNotice('通知設定の保存に失敗しました') }
      }
      setNotice('通知を有効にしました')
    } else if (permission === 'denied') {
      setNotice('通知がブロックされています。ブラウザの設定を確認してください')
    }
  }

  const disableNotifications = async () => {
    setState((current) => current ? { ...current, notificationsEnabled: false } : current)
    if (session) {
      try { await updateProfile(session, { notificationsEnabled: false }) } catch { setNotice('通知設定の保存に失敗しました') }
    }
    setNotice('通知を停止しました')
  }

  const updateDailyGoal = async (value: number) => {
    if (!session) return
    const dailyGoal = normalizeDailyGoal(value)
    setState((current) => current ? { ...current, dailyGoal } : current)
    try { await updateProfile(session, { dailyGoal }) } catch { setNotice('目標の保存に失敗しました') }
  }

  const updateDisplayName = async (value: string) => {
    if (!session) return
    const displayName = value.slice(0, 20)
    setState((current) => current ? { ...current, displayName } : current)
    try { await updateProfile(session, { displayName }) } catch { setNotice('表示名の保存に失敗しました') }
  }

  const updateAiReflection = async (enabled: boolean) => {
    if (!session) return
    setState((current) => current ? { ...current, aiReflectionEnabled: enabled } : current)
    try { await updateProfile(session, { aiReflectionEnabled: enabled }) } catch { setNotice('設定の保存に失敗しました') }
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

  const signOut = () => {
    clearSession()
    setSession(null)
    setState(null)
    setRemoteUser(null)
    setActiveView('home')
  }

  if (authLoading) return <LoadingScreen />
  if (!session || !state || !remoteUser) return <AuthView initialError={authError} onAuthenticated={(nextSession) => { saveSession(nextSession); setAuthError(''); setSession(nextSession) }} />

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
        <nav className="sidebar__nav" aria-label="メインナビゲーション">
          <SidebarLink icon="⌂" label="ホーム" active={activeView === 'home'} onClick={() => navigate('home')} />
          <SidebarLink icon="◒" label="自分の習慣" active={activeView === 'habits' || activeView === 'detail'} onClick={() => navigate('habits')} />
          <SidebarLink icon="▥" label="統計" active={activeView === 'stats'} onClick={() => navigate('stats')} />
          <SidebarLink icon="＋" label="習慣を追加" active={activeView === 'create'} onClick={() => navigate('create')} />
          <SidebarLink icon="⚙" label="設定" active={activeView === 'settings'} onClick={() => navigate('settings')} />
        </nav>
        <div className="sidebar__footer">
          <div className="demo-badge"><span /> クラウド保存中</div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar__mobile-brand"><span className="brand-mark">hh</span><strong>Habit Helper</strong></div>
          <div className="topbar__spacer" />
          <div className="topbar__profile">
            <div className="profile-copy"><strong>{state.displayName}さん</strong></div>
            <span className="profile-avatar">{displayNameInitial}</span>
          </div>
        </header>

        {activeView === 'home' && <HomeView habits={dueHabits} allHabits={habits} records={records} completedToday={completedToday} dailyGoal={state.dailyGoal} progress={progress} onToggle={toggleCompletion} onOpen={openDetail} onEdit={startEditingHabit} onDelete={deleteHabit} onAdd={() => navigate('create')} onViewAll={() => navigate('habits')} onViewStats={() => navigate('stats')} />}
        {activeView === 'habits' && <HabitsView habits={habits} records={records} onToggle={toggleCompletion} onOpen={openDetail} onEdit={startEditingHabit} onDelete={deleteHabit} onAdd={() => navigate('create')} />}
        {activeView === 'stats' && <StatsView habits={habits} records={records} aiReflectionEnabled={state.aiReflectionEnabled} />}
        {activeView === 'create' && <PageFrame eyebrow={editingHabit ? 'EDIT HABIT' : 'NEW HABIT'} title={editingHabit ? '習慣を整える' : '新しい習慣をつくる'} description={editingHabit ? '今のあなたに合うように、いつでも調整できます。' : '続けたいことをひとつだけ。小さく始めるのがコツです。'}><HabitForm initialHabit={editingHabit} records={records} onSubmit={saveHabit} onCancel={() => editingHabit ? openDetail(editingHabit.id) : navigate('home')} /></PageFrame>}
        {activeView === 'detail' && selectedHabit && <DetailView habit={selectedHabit} records={records} onBack={() => navigate('habits')} onToggle={() => toggleCompletion(selectedHabit.id)} onToggleDate={(date) => toggleCompletion(selectedHabit.id, date)} onEdit={() => { setEditingHabitId(selectedHabit.id); setActiveView('create') }} onEditNote={(record) => openNoteEditor(selectedHabit.id, record.completedDate, record.note ?? '')} onDelete={() => deleteHabit(selectedHabit.id)} />}
        {activeView === 'settings' && <SettingsView displayName={state.displayName} email={remoteUser.email} onDisplayNameChange={updateDisplayName} onReset={resetDemo} onSignOut={signOut} dailyGoal={state.dailyGoal} onDailyGoalChange={updateDailyGoal} notificationsEnabled={state.notificationsEnabled} aiReflectionEnabled={state.aiReflectionEnabled} notificationPermission={notificationPermission} onEnableNotifications={enableNotifications} onDisableNotifications={disableNotifications} onTestNotification={sendTestNotification} onAiReflectionChange={updateAiReflection} />}

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
  onToggle: (habitId: string) => void
  onOpen: (habitId: string) => void
  onEdit: (habitId: string) => void
  onDelete: (habitId: string) => void
  onAdd: () => void
  onViewAll: () => void
  onViewStats: () => void
}

function HomeView({ habits, allHabits, records, completedToday, dailyGoal, progress, onToggle, onOpen, onEdit, onDelete, onAdd, onViewAll, onViewStats }: HomeViewProps) {
  const bestHabit = allHabits.slice().sort((a, b) => getStreak(b, records) - getStreak(a, records))[0]
  const bestStreak = bestHabit ? getStreak(bestHabit, records) : 0
  const insights = getProgressInsights(allHabits, records)

  return <div className="home-view">
    <div className="date-strip"><span className="date-strip__dot" aria-hidden="true" />今日 · {formatJapaneseDate()}</div>

    <section className="section-block today-section">
      <div className="section-heading"><div><span className="eyebrow">FOR TODAY</span><h2>今日やること</h2></div><div className="today-section__actions"><button className="button button--primary button--small" onClick={onAdd}><span aria-hidden="true">＋</span> 習慣を追加</button><button className="text-button" onClick={onViewAll}>すべて見る <span aria-hidden="true">→</span></button></div></div>
      <div className="habit-stack">
        {habits.length === 0 ? <EmptyHabits onAdd={onAdd} /> : habits.map((habit) => <HabitCard key={habit.id} habit={habit} records={records} completed={records.some((record) => record.habitId === habit.id && record.completedDate === todayISO())} onToggle={() => onToggle(habit.id)} onOpen={() => onOpen(habit.id)} onEdit={() => onEdit(habit.id)} onDelete={() => onDelete(habit.id)} />)}
      </div>
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

    <section className="progress-panel">
      <div className="progress-panel__copy"><span className="eyebrow eyebrow--light">TODAY'S PROGRESS</span><h2>今日のリズム</h2><p>{progress === 100 ? 'すべての習慣を達成しました。すてきです！' : 'ひとつずつ、できたことを積み重ねよう。'}</p><div className="progress-panel__count"><strong>{Math.min(completedToday, dailyGoal)}</strong><span> / {dailyGoal} habits</span></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><span className="progress-panel__caption">{progress === 100 ? '今日の目標をクリア！' : `あと${Math.max(dailyGoal - completedToday, 0)}つで今日の目標達成`}</span></div>
      <ProgressRing completed={Math.min(completedToday, dailyGoal)} total={dailyGoal} />
      <span className="progress-spark progress-spark--one" /><span className="progress-spark progress-spark--two" /><span className="progress-spark progress-spark--three" />
    </section>

    <section className="home-stats-teaser">
      <div><span className="eyebrow">THIS WEEK</span><strong>今週 {insights.weekProgress.completed}/{insights.weekProgress.target}達成</strong><p>達成率 {insights.weekRate}% · 現在の連続日数 {insights.currentStreak}日</p></div>
      <button className="text-button" onClick={onViewStats}>統計を見る <span aria-hidden="true">→</span></button>
    </section>
  </div>
}

function StatsView({ habits, records, aiReflectionEnabled }: { habits: Habit[]; records: HabitRecord[]; aiReflectionEnabled: boolean }) {
  const insights = getProgressInsights(habits, records)
  const difference = insights.weekRate - insights.previousWeekRate
  const achievements = [
    { icon: '🌱', title: '初心者', detail: '7日継続', unlocked: insights.longestStreak >= 7 },
    { icon: '🏆', title: '習慣マスター', detail: '30日継続', unlocked: insights.longestStreak >= 30 },
    { icon: '🎯', title: '実績解除', detail: '100回達成', unlocked: insights.totalCompletions >= 100 },
  ]
  const reflectionBody = insights.focusHabit && insights.focusDay
    ? `「${insights.focusHabit.habit.name}」は直近30日で${insights.focusHabit.rate}%達成。${insights.focusDay.label}曜日が${insights.focusDay.rate}%と少し低めなので、その曜日だけ目標を軽くしてみると続けやすそうです。`
    : insights.focusHabit
      ? `「${insights.focusHabit.habit.name}」の直近30日の達成率は${insights.focusHabit.rate}%です。無理のない小さな行動に分けて続けてみましょう。`
      : '記録が増えると、あなたの続きやすい曜日やペースをここで振り返れます。'

  return <PageFrame eyebrow="YOUR PROGRESS" title="統計" description="見る項目を絞って、今のペースを確認しましょう。">
    <div className="stats-grid stats-grid--overview">
      <Stat label="今週の達成率" value={`${insights.weekRate}%`} accent="purple" />
      <Stat label="現在の連続日数" value={`${insights.currentStreak}日`} accent="mint" />
      <Stat label="先週との比較" value={`${difference >= 0 ? '+' : ''}${difference}pt`} accent="peach" />
    </div>
    <section className="stats-compare-card"><div><span className="eyebrow">WEEKLY CHECK</span><h2>今週のペース</h2><p>今週 {insights.weekProgress.completed}/{insights.weekProgress.target}達成 · 先週 {insights.previousWeekProgress.completed}/{insights.previousWeekProgress.target}</p></div><strong className={difference >= 0 ? 'is-up' : 'is-down'}>{difference >= 0 ? '↗' : '↘'} {Math.abs(difference)}pt</strong></section>
    <section className="achievement-section"><div className="achievement-section__header"><div><span className="eyebrow">LEVEL & ACHIEVEMENTS</span><h2>続けるほど育つ</h2></div><div className="level-badge"><span>LEVEL</span><strong>{insights.levelName}</strong><small>{insights.totalCompletions}回記録</small></div></div><div className="achievement-list">{achievements.map((achievement) => <div className={`achievement-item ${achievement.unlocked ? 'is-unlocked' : ''}`} key={achievement.title}><span className="achievement-item__icon">{achievement.unlocked ? achievement.icon : '🔒'}</span><span><strong>{achievement.title}</strong><small>{achievement.detail}</small></span><b>{achievement.unlocked ? '解除済み' : '未解除'}</b></div>)}</div></section>
    {aiReflectionEnabled && <section className="ai-reflection-card"><div className="ai-reflection-card__icon">✦</div><div><span className="eyebrow">AI REFLECTION</span><h2>記録からの振り返り</h2><p>{reflectionBody}</p><small>設定からいつでもON/OFFを切り替えられます。</small></div></section>}
  </PageFrame>
}

function HabitsView({ habits, records, onToggle, onOpen, onEdit, onDelete, onAdd }: { habits: Habit[]; records: HabitRecord[]; onToggle: (id: string) => void; onOpen: (id: string) => void; onEdit: (id: string) => void; onDelete: (id: string) => void; onAdd: () => void }) {
  return <PageFrame eyebrow="YOUR HABITS" title="自分の習慣" description="あなたが大切にしている、毎日の小さな約束。"><div className="list-toolbar"><span>{habits.length}個の習慣</span><button className="button button--primary button--small" onClick={onAdd}>＋ 追加する</button></div><div className="habit-grid">{habits.map((habit) => <HabitCard key={habit.id} habit={habit} records={records} completed={records.some((record) => record.habitId === habit.id && record.completedDate === todayISO())} onToggle={() => onToggle(habit.id)} onOpen={() => onOpen(habit.id)} onEdit={() => onEdit(habit.id)} onDelete={() => onDelete(habit.id)} />)}</div>{habits.length === 0 && <EmptyHabits onAdd={onAdd} />}</PageFrame>
}

function DetailView({ habit, records, onBack, onToggle, onToggleDate, onEdit, onEditNote, onDelete }: { habit: Habit; records: HabitRecord[]; onBack: () => void; onToggle: () => void; onToggleDate: (date: string) => void; onEdit: () => void; onEditNote: (record: HabitRecord) => void; onDelete: () => void }) {
  const completedDates = new Set(records.filter((record) => record.habitId === habit.id).map((record) => record.completedDate))
  const thisWeek = countThisWeek(habit.id, records)
  const streak = getStreak(habit, records)
  const last30 = Array.from({ length: 30 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - index); return date })
  const completedLast30 = last30.filter((date) => completedDates.has(toISODate(date))).length
  const noteRecords = records.filter((record) => record.habitId === habit.id && record.note).slice().sort((a, b) => b.completedDate.localeCompare(a.completedDate))

  return <div className="detail-view page-frame"><button className="back-button" onClick={onBack}>← <span>習慣一覧に戻る</span></button><section className={`detail-hero detail-hero--${habit.tone}`}><span className="detail-hero__icon">{habit.icon}</span><div><span className="eyebrow">HABIT DETAIL</span><h1>{habit.name}</h1><p>{frequencyLabel(habit.frequencyType, habit.targetPerWeek, habit.selectedDays, habit.targetPerMonth)}{habit.targetValue ? ` · 1日${habit.targetValue}${habit.targetUnit ?? '回'}` : ''} · {formatShortDate(habit.startDate)}から</p></div><button className={`detail-hero__action ${completedDates.has(todayISO()) ? 'is-complete' : ''}`} onClick={onToggle}>{completedDates.has(todayISO()) ? '✓ 今日達成' : '今日の完了'}</button></section><div className="stats-grid"><Stat label={habit.frequencyType === 'weekly' ? '今週の達成' : '現在のストリーク'} value={habit.frequencyType === 'weekly' ? `${thisWeek}/${habit.targetPerWeek}` : `${streak}日`} accent="purple" /><Stat label="過去30日の達成率" value={`${percentage(completedLast30, 30)}%`} accent="mint" /><Stat label="記録した日数" value={`${completedDates.size}日`} accent="peach" /></div><section className="detail-section"><div className="section-heading"><div><span className="eyebrow">YOUR RECORD</span><h2>達成カレンダー</h2></div><span className="calendar-legend"><i /> 達成</span></div><p className="calendar-hint">日付をタップして、過去の達成記録を修正できます。</p><CalendarGrid completedDates={completedDates} onToggleDate={onToggleDate} /></section><section className="detail-section detail-notes"><div className="section-heading"><div><span className="eyebrow">YOUR NOTES</span><h2>達成メモ</h2></div><span className="settings-soon">SHORT NOTES</span></div>{noteRecords.length ? <div className="note-list">{noteRecords.map((record) => <div className="note-item" key={record.id}><div><span>{formatShortDate(record.completedDate)}{record.amount ? ` · 実績${record.amount}${habit.targetUnit ?? ''}` : ''}</span><p>{record.note}</p></div><button className="text-button" onClick={() => onEditNote(record)}>編集</button></div>)}</div> : <p className="note-empty">完了したときに、短いメモを残せます。</p>}</section><div className="detail-actions"><button className="button button--secondary" onClick={onEdit}>✎ 編集する</button><button className="button button--danger" onClick={onDelete}>削除する</button></div></div>
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <div className={`stat-card stat-card--${accent}`}><span>{label}</span><strong>{value}</strong></div>
}

type SettingsViewProps = {
  displayName: string
  email: string
  onDisplayNameChange: (value: string) => void
  onReset: () => void
  onSignOut: () => void
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

function SettingsView({ displayName, email, onDisplayNameChange, onReset, onSignOut, dailyGoal, onDailyGoalChange, notificationsEnabled, aiReflectionEnabled, notificationPermission, onEnableNotifications, onDisableNotifications, onTestNotification, onAiReflectionChange }: SettingsViewProps) {
  const notificationDescription = notificationPermission === 'unsupported'
    ? 'このブラウザは通知に対応していません。'
    : notificationPermission === 'denied'
      ? '通知がブロックされています。ブラウザの設定から許可してください。'
      : notificationsEnabled
        ? '習慣ごとに設定した時間に通知します。'
        : '通知を許可すると、習慣の時間にお知らせします。'

  return <PageFrame eyebrow="PREFERENCES" title="設定" description="Habit Helperをあなたのペースに合わせて整えます。"><div className="settings-card"><div className="settings-profile"><span className="profile-avatar profile-avatar--large">{displayName.slice(0, 1)}</span><div><strong>{displayName}さん</strong><span>{email}</span></div><span className="settings-status">クラウド保存中</span></div><div className="settings-row settings-row--name"><div><strong>表示名</strong><span>ホーム画面の挨拶に表示する名前です。</span></div><input className="name-input" type="text" value={displayName} maxLength={20} aria-label="表示名" onChange={(event) => onDisplayNameChange(event.target.value)} /></div><div className="settings-row"><div><strong>データについて</strong><span>習慣・記録・メモはログイン中のアカウントに保存されます。</span></div><span className="settings-row__arrow">›</span></div><div className="settings-row settings-row--goal"><div><strong>今日のリズムの目標</strong><span>進捗リングに表示する、1日の目標習慣数です。</span></div><label className="goal-control"><input className="goal-input" type="number" min="1" max="20" value={dailyGoal} onChange={(event) => onDailyGoalChange(Number(event.target.value))} /><span>習慣</span></label></div><div className="settings-row settings-row--notifications"><div><strong>習慣の通知</strong><span>{notificationDescription}</span></div><div className="notification-actions">{notificationsEnabled && notificationPermission === 'granted' ? <><button className="button button--ghost button--small" onClick={onDisableNotifications}>通知を停止</button><button className="button button--secondary button--small" onClick={onTestNotification}>テスト通知</button></> : <button className="button button--primary button--small" onClick={onEnableNotifications} disabled={notificationPermission === 'unsupported'}>通知を有効にする</button>}</div></div><p className="notification-note">通知はこの端末のブラウザ上で、アプリを開いている間に動作します。習慣ごとの時刻は習慣の編集画面から変更できます。通知時刻を過ぎても未完了の場合は、1時間おきに最大3回再通知します。</p><div className="settings-row settings-row--ai"><div><strong>AIによる振り返り</strong><span>記録データから達成率や曜日別の傾向を自動分析します。</span></div><label className="switch-control"><input type="checkbox" checked={aiReflectionEnabled} onChange={(event) => onAiReflectionChange(event.target.checked)} /><span className="switch-control__track" aria-hidden="true"><span /></span><span className="sr-only">AIによる振り返りを有効にする</span></label></div><div className="settings-row"><div><strong>ログイン中のアカウント</strong><span>{email}</span></div><button className="button button--ghost button--small" onClick={onSignOut}>ログアウト</button></div><button className="reset-button" onClick={onReset}>自分のデータをリセット</button></div></PageFrame>
}

function LoadingScreen() {
  return <div className="auth-shell"><div className="auth-card auth-card--loading"><span className="brand-mark">hh</span><h1>Habit Helper</h1><p>ログイン情報を確認しています…</p></div></div>
}

function AuthView({ initialError, onAuthenticated }: { initialError: string; onAuthenticated: (session: AuthSession) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')
    setSubmitting(true)
    try {
      const result = mode === 'login' ? await signIn(email, password) : await signUp(email, password, name)
      if (result.access_token) onAuthenticated(result)
      else setMessage('確認メールを送信しました。メール内のリンクを開いてからログインしてください。')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '認証に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="auth-shell"><div className="auth-card"><div className="auth-brand"><span className="brand-mark">hh</span><strong>Habit Helper</strong></div><span className="eyebrow">YOUR PRIVATE RHYTHM</span><h1>{mode === 'login' ? 'おかえりなさい。' : '習慣を始めよう。'}</h1><p className="auth-card__description">ログインすると、習慣・達成記録・メモをあなたのアカウントだけに保存できます。</p><form onSubmit={submit}>{mode === 'signup' && <label className="auth-field"><span>表示名</span><input type="text" value={name} maxLength={20} autoComplete="name" placeholder="例：さき" onChange={(event) => setName(event.target.value)} /></label>}<label className="auth-field"><span>メールアドレス</span><input type="email" required value={email} autoComplete="email" placeholder="you@example.com" onChange={(event) => setEmail(event.target.value)} /></label><label className="auth-field"><span>パスワード</span><input type="password" required minLength={6} value={password} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder="6文字以上" onChange={(event) => setPassword(event.target.value)} /></label>{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}<button className="button button--primary auth-submit" type="submit" disabled={submitting}>{submitting ? '処理中…' : mode === 'login' ? 'ログインする' : 'アカウントを作成'} <span aria-hidden="true">→</span></button></form><button className="auth-switch" type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setMessage('') }}>{mode === 'login' ? 'アカウントを作成する' : 'ログイン画面に戻る'}</button><p className="auth-footnote">データはアカウント単位で分離され、他のユーザーからは見えません。</p></div></div>
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

function NoteDialog({ target, onSave, onSkip }: { target: NoteTarget; onSave: (note: string, amount?: number) => void; onSkip: () => void }) {
  const [note, setNote] = useState(target.initialNote)
  const [amount, setAmount] = useState(target.initialAmount?.toString() ?? '')

  useEffect(() => {
    setNote(target.initialNote)
    setAmount(target.initialAmount?.toString() ?? '')
  }, [target])

  return <div className="note-dialog" role="dialog" aria-modal="true" aria-label={`${target.name}の達成メモ`}>
    <button className="note-dialog__backdrop" aria-label="メモを閉じる" onClick={onSkip} />
    <form className="note-dialog__card" onSubmit={(event) => { event.preventDefault(); onSave(note, amount.trim() ? Number(amount) : undefined) }}>
      <span className="note-dialog__icon" aria-hidden="true">✎</span>
      <span className="eyebrow">A LITTLE NOTE</span>
      <h2>今日のメモを残す？</h2>
      <p>「{target.name}」について、短く記録できます。</p>
      {target.targetValue && <label className="note-dialog__amount-label">実績値（目標 {target.targetValue}{target.targetUnit ?? '回'}）<input className="note-dialog__amount" type="number" min="0" step="1" value={amount} placeholder={`${target.targetValue}`} onChange={(event) => setAmount(event.target.value)} /><span>{target.targetUnit ?? '回'}</span></label>}
      <textarea className="note-dialog__input" value={note} maxLength={120} autoFocus placeholder="例：今日は30分走った" onChange={(event) => setNote(event.target.value)} />
      <div className="note-dialog__footer"><small>{note.length}/120</small><div><button type="button" className="button button--ghost button--small" onClick={onSkip}>あとで</button><button type="submit" className="button button--primary button--small">メモを保存</button></div></div>
    </form>
  </div>
}

export default App
