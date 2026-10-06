// Isolated UI test with simulated Auth/DB responses. No real account or DB writes.
// Node 24; set PLAYWRIGHT_MODULE if Playwright is supplied by a bundled runtime.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' })
const page = await context.newPage()
await page.clock.install({ time: new Date('2026-10-06T12:00:00+09:00') })
const errors = []
const expectedErrors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() !== 'error') return
  if (message.text().includes('status of 503') && message.location().url.includes('/api/data')) expectedErrors.push(message.text())
  else errors.push(message.text())
})
// External fonts are outside this offline UI test; use the normal CSS fallback.
await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
const ownerA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ownerB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
const user = (id) => ({ id, email: id === ownerA ? 'a@example.invalid' : 'b@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: { name: id === ownerA ? 'テストA' : 'テストB' }, created_at: '2026-01-01T00:00:00Z', email_confirmed_at: '2026-01-01T00:00:00Z' })
const session = (id) => ({ access_token: `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: id, exp: 2100000000, aud: 'authenticated' })).toString('base64url')}.test-signature`, token_type: 'bearer', refresh_token: `test-refresh-${id}`, expires_in: 3600, expires_at: 2100000000, user: user(id) })
const tokenOwner = (request) => {
  const token = request.headers().authorization?.replace('Bearer ', '')
  return token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub : null
}
const habits = []
const records = []
let nextId = 1
let simulateFailure = false

await page.route('**/auth/v1/**', async (route) => {
  const request = route.request()
  const path = new URL(request.url()).pathname
  if (path.endsWith('/signup')) return route.fulfill({ json: user(ownerA) })
  if (path.endsWith('/token')) {
    const input = request.postDataJSON()
    return route.fulfill({ json: session(input.email === 'b@example.invalid' ? ownerB : ownerA) })
  }
  if (path.endsWith('/user')) return route.fulfill({ json: user(tokenOwner(request) ?? ownerA) })
  if (path.endsWith('/logout')) return route.fulfill({ status: 204 })
  return route.fulfill({ json: {} })
})
await page.route('**/api/**', async (route) => {
  const request = route.request()
  const url = new URL(request.url())
  const owner = tokenOwner(request)
  assert.ok([ownerA, ownerB].includes(owner))
  const method = request.method()
  const input = request.postData() ? request.postDataJSON() : null
  if (url.pathname === '/api/data') {
    if (simulateFailure) return route.fulfill({ status: 503, json: { error: 'テスト用の通信エラー' } })
    return route.fulfill({ json: { user: { id: owner, email: user(owner).email, name: user(owner).user_metadata.name }, preferences: { dailyGoal: 3, aiReflectionEnabled: true, notificationsEnabled: false }, habits: habits.filter((habit) => habit.user_id === owner).map((row) => ({ id: row.id, name: row.name, icon: row.icon, frequencyType: row.frequency_type, targetPerWeek: row.target_per_week, targetPerMonth: row.target_per_month, selectedDays: row.selected_days, startDate: row.start_date, endDate: row.end_date, createdAt: row.created_at, tone: 'mint' })), records: records.filter((row) => row.user_id === owner && row.completed).map((row) => ({ id: row.id, habitId: row.habit_id, completedDate: row.date, note: row.memo, amount: row.amount, createdAt: row.created_at })) } })
  }
  const dbHabit = (values) => ({ name: values.name, icon: values.icon, frequency_type: values.frequencyType, target_per_week: values.targetPerWeek, target_per_month: values.targetPerMonth, selected_days: values.selectedDays, start_date: values.startDate, end_date: values.endDate, tone: 'mint' })
  if (url.pathname === '/api/habits' && method === 'POST') {
    const row = { ...dbHabit(input), id: `habit-${nextId++}`, user_id: owner, created_at: '2026-10-06T03:00:00Z' }
    habits.push(row)
    return route.fulfill({ json: row })
  }
  if (url.pathname.startsWith('/api/habits/')) {
    const id = url.pathname.split('/').at(-1)
    const index = habits.findIndex((habit) => habit.id === id && habit.user_id === owner)
    assert.ok(index >= 0)
    if (method === 'DELETE') { habits.splice(index, 1); return route.fulfill({ status: 204 }) }
    Object.assign(habits[index], dbHabit(input))
    return route.fulfill({ json: habits[index] })
  }
  if (url.pathname === '/api/records') {
    const habitId = input?.habitId ?? url.searchParams.get('habitId')
    const date = input?.completedDate ?? url.searchParams.get('date')
    assert.ok(habits.some((habit) => habit.id === habitId && habit.user_id === owner))
    let row = records.find((record) => record.habit_id === habitId && record.date === date && record.user_id === owner)
    if (method === 'DELETE') { row.completed = false; return route.fulfill({ status: 204 }) }
    if (!row) { row = { id: `record-${nextId++}`, user_id: owner, habit_id: habitId, date, created_at: '2026-10-06T03:00:00Z' }; records.push(row) }
    row.completed = true
    if ('note' in input) row.memo = input.note
    return route.fulfill({ json: row })
  }
  return route.fulfill({ json: {} })
})

const login = async (email = 'a@example.invalid') => {
  await page.getByLabel('メールアドレス', { exact: true }).fill(email)
  await page.getByLabel('パスワード', { exact: true }).fill('Test-password-only-123!')
  await page.getByRole('button', { name: 'ログインする' }).click()
  await page.getByRole('heading', { name: '今日の習慣', exact: true }).waitFor()
}
const nav = (label) => page.locator('.bottom-navigation').getByRole('button', { name: label, exact: true })
const create = async (name, frequency, count) => {
  await nav('追加').click()
  await page.getByLabel('どんな習慣？').fill(name)
  if (frequency) await page.getByRole('button', { name: frequency }).click()
  if (count && frequency === '週に何回か') await page.getByLabel('週の目標', { exact: true }).selectOption(String(count))
  if (count && frequency === '月に何回か') await page.getByLabel('月の目標', { exact: true }).selectOption(String(count))
  if (frequency === '週に何回か' || frequency === '月に何回か') {
    await page.getByRole('button', { name: '詳細設定（アイコン・目標・通知）' }).click()
    await page.getByLabel('開始日', { exact: true }).fill('2026-01-01')
  }
  await page.getByRole('button', { name: '習慣を作成', exact: false }).click()
  await page.getByRole('heading', { name: '今日の習慣', exact: true }).waitFor()
  return habits.at(-1)
}
const card = (name) => page.locator('.today-section .habit-card').filter({ has: page.getByText(name, { exact: true }) })
const noOverflow = async (width) => {
  await page.setViewportSize({ width, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `horizontal overflow at ${width}px`)
}

try {
  await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5175/')
  await page.getByRole('button', { name: 'アカウントを作成する', exact: true }).click()
  await page.getByLabel('表示名', { exact: true }).fill('テストA')
  await page.getByLabel('メールアドレス', { exact: true }).fill('a@example.invalid')
  await page.getByLabel('パスワード', { exact: true }).fill('Test-password-only-123!')
  await page.getByRole('button', { name: 'アカウントを作成', exact: false }).first().click()
  await page.getByText('確認メールを送信しました。メール内のリンクを開いてからログインしてください。', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'ログイン画面に戻る' }).click()
  await login()
  await page.getByText('今日の習慣はまだありません', { exact: true }).waitFor()
  const daily = await create('読書')
  await card('読書').waitFor()
  await card('読書').getByRole('button', { name: '読書：未達成、完了にする', exact: true }).click()
  await card('読書').getByRole('button', { name: '読書：達成済み、取り消す', exact: true }).waitFor()
  assert.equal(records.filter((record) => record.habit_id === daily.id).length, 1)
  await page.reload()
  await card('読書').getByRole('button', { name: '読書：達成済み、取り消す', exact: true }).waitFor()
  await card('読書').getByRole('button', { name: '読書：達成済み、取り消す', exact: true }).click()
  await card('読書').getByRole('button', { name: '読書：未達成、完了にする', exact: true }).waitFor()
  await card('読書').getByRole('button', { name: '読書：未達成、完了にする', exact: true }).click()
  await card('読書').getByRole('button', { name: '読書：達成済み、取り消す', exact: true }).waitFor()
  assert.equal(records.filter((record) => record.habit_id === daily.id).length, 1)
  const weekly = await create('週の習慣', '週に何回か', 2)
  const monthly = await create('月の習慣', '月に何回か', 2)
  await create('平日の習慣', '平日のみ')
  const selected = await create('月水金', '曜日を選ぶ')
  assert.deepEqual(selected.selected_days, [1, 3, 5])
  assert.equal(await card('月水金').count(), 0)
  assert.equal(await card('平日の習慣').count(), 1)
  assert.equal(await card('週の習慣').count(), 1)
  assert.equal(await card('月の習慣').count(), 1)
  records.push(...['2026-09-21', '2026-09-23', '2026-09-28', '2026-10-02'].map((date) => ({ id: `record-${nextId++}`, user_id: ownerA, habit_id: weekly.id, date, completed: true, created_at: `${date}T03:00:00Z` })))
  records.push(...['2026-10-01', '2026-10-02'].map((date) => ({ id: `record-${nextId++}`, user_id: ownerA, habit_id: monthly.id, date, completed: true, created_at: `${date}T03:00:00Z` })))
  await page.reload()
  await card('週の習慣').getByText('🔥 2週連続', { exact: true }).waitFor()
  assert.equal(await card('月の習慣').count(), 0)
  for (const width of [320, 360, 375, 390, 430, 768, 1280]) await noOverflow(width)
  await page.setViewportSize({ width: 390, height: 844 })
  const height = await card('読書').locator('.complete-button').evaluate((element) => element.getBoundingClientRect().height)
  assert.ok(height >= 44)
  await page.screenshot({ path: join(tmpdir(), 'habit-helper-mobile.png'), fullPage: true })
  await card('読書').getByRole('button', { name: '読書の詳細を見る', exact: true }).click()
  await page.getByRole('button', { name: 'メモを追加', exact: true }).click()
  await page.locator('.note-dialog__input').fill('テストのメモ')
  await page.getByRole('button', { name: 'メモを保存', exact: true }).click()
  await page.locator('.note-list').getByText('テストのメモ', { exact: true }).waitFor()
  await page.getByRole('button', { name: '編集する', exact: false }).click()
  await page.getByLabel('どんな習慣？').fill('読書を編集')
  await page.getByRole('button', { name: '月に何回か' }).click()
  await page.getByLabel('月の目標', { exact: true }).selectOption('31')
  await page.getByRole('button', { name: '変更を保存' }).click()
  await page.getByRole('heading', { name: '読書を編集', exact: true }).waitFor()
  for (const width of [320, 375, 390, 430]) await noOverflow(width)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(habits.find((habit) => habit.id === daily.id).target_per_month, 31)
  await nav('設定').click()
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
  await page.getByRole('button', { name: 'ログインする' }).waitFor()
  assert.equal(await page.locator('.habit-card').count(), 0)
  await login()
  await card('読書を編集').getByRole('button', { name: '読書を編集：達成済み、取り消す', exact: true }).waitFor()
  await nav('設定').click()
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
  await page.getByRole('button', { name: 'ログインする' }).waitFor()
  await login('b@example.invalid')
  await page.getByText('今日の習慣はまだありません', { exact: true }).waitFor()
  assert.equal(await page.locator('.habit-card').count(), 0)
  await nav('設定').click()
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click()
  await page.getByRole('button', { name: 'ログインする' }).waitFor()
  await login()
  simulateFailure = true
  await page.reload()
  await page.getByRole('heading', { name: 'データを読み込めません' }).waitFor()
  assert.equal(await page.locator('.habit-card').count(), 0)
  simulateFailure = false
  await page.getByRole('button', { name: '再読み込み', exact: true }).click()
  await card('読書を編集').waitFor()
  await page.clock.fastForward(12 * 60 * 60 * 1000 + 60000)
  await card('月水金').waitFor()
  await card('週の習慣').getByRole('button', { name: '週の習慣：未達成、完了にする', exact: true }).click()
  await card('週の習慣').getByRole('button', { name: '週の習慣：達成済み、取り消す', exact: true }).waitFor()
  assert.equal(records.filter((record) => record.habit_id === weekly.id).at(-1).date, '2026-10-07')
  page.once('dialog', (dialog) => dialog.accept())
  await card('読書を編集').getByRole('button', { name: '読書を編集を削除', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.today-section')?.textContent.includes('読書を編集'))
  assert.equal(habits.some((habit) => habit.id === daily.id), false)
  assert.deepEqual(errors, [])
  assert.ok(expectedErrors.length > 0, 'intentional 503 failure was exercised')
  console.log(JSON.stringify({ result: 'PASS', kind: 'mocked Auth/DB UI', verified: ['signup confirmation UI', 'login', 'habit create/edit/delete', 'frequency controls', 'completion/undo', 'refresh persistence', 'streak labels', 'memo', 'logout/relogin', 'account switch', 'data-error retry', 'midnight date rollover', '320-1280px no overflow', '44px touch target', 'no unexpected console errors'], expected503Errors: expectedErrors.length, screenshot: join(tmpdir(), 'habit-helper-mobile.png') }))
} finally {
  await browser.close()
}
