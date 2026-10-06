import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'

// Vercel compiles these .js imports to their TypeScript sources.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.js') && context.parentURL?.includes('/api/')) {
    const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
    if (existsSync(candidate)) return nextResolve(candidate.href, context)
  }
  return nextResolve(specifier, context)
} })
const { default: recordsApi } = await import('../api/records.ts')
const { default: dataApi } = await import('../api/data.ts')
const { default: habitsApi } = await import('../api/habits.ts')
const { default: editApi } = await import('../api/habits/[id].ts')
const { habitPayload, isValidDate } = await import('../api/_shared.ts')

const originalFetch = globalThis.fetch
const names = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']
const originalEnv = Object.fromEntries(names.map((name) => [name, process.env[name]]))
for (const name of names) delete process.env[name]
process.env.VITE_SUPABASE_URL = 'https://test-project.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_only'
after(() => {
  globalThis.fetch = originalFetch
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const invoke = async (handler, { method = 'GET', token = 'token-a', body, query = {} } = {}) => {
  const response = { code: 200, value: null, status(code) { this.code = code; return this }, json(value) { this.value = value }, end() {} }
  await handler({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body, query }, response)
  return response
}

test('API uses authenticated owner, unique upsert, persistent undo and active-record reads (mock transport)', async () => {
  const ownerA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
  const ownerB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb'
  const habitA = 'aaaaaaaa-aaaa-4aaa-aaaa-000000000001'
  const habitB = 'bbbbbbbb-bbbb-4bbb-bbbb-000000000001'
  const habits = [{ id: habitA, user_id: ownerA, name: '読書', frequency_type: 'daily', start_date: '2026-01-01' }, { id: habitB, user_id: ownerB, name: '他人の習慣' }]
  const rows = []
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input)
    const headers = new Headers(init.headers)
    assert.equal(headers.get('apikey'), 'sb_publishable_test_only')
    const token = headers.get('Authorization')?.replace('Bearer ', '')
    const owner = token === 'token-a' || token === 'token-a-relogin' ? ownerA : token === 'token-b' ? ownerB : null
    if (url.pathname === '/auth/v1/user') return Response.json(owner ? { id: owner, email: 'test@example.invalid' } : { error: 'invalid' }, { status: owner ? 200 : 401 })
    assert.ok(owner, 'DB request must carry a validated user JWT')
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ url, method, body, owner })
    const table = url.pathname.split('/').at(-1)
    const match = (row) => ['user_id', 'id', 'habit_id', 'date'].every((key) => !url.searchParams.has(key) || row[key] === url.searchParams.get(key).slice(3))
    if (table === 'users') return Response.json([{ id: owner, name: 'テスト', daily_goal: 3 }])
    if (table === 'habits') {
      if (method === 'POST') {
        assert.equal(body.user_id, owner)
        const created = { ...body, id: 'new-habit', created_at: '2026-10-06T00:00:00Z' }
        habits.push(created)
        return Response.json([created])
      }
      assert.equal(url.searchParams.get('user_id'), `eq.${owner}`)
      const found = habits.filter(match)
      if (method === 'PATCH') found.forEach((row) => Object.assign(row, body))
      return Response.json(found)
    }
    assert.equal(table, 'habit_records')
    if (method === 'POST') {
      assert.equal(url.searchParams.get('on_conflict'), 'user_id,habit_id,date')
      assert.match(headers.get('Prefer'), /resolution=merge-duplicates/)
      assert.equal(body.user_id, owner)
      assert.ok(habits.some((habit) => habit.id === body.habit_id && habit.user_id === owner))
      let row = rows.find((row) => row.user_id === owner && row.habit_id === body.habit_id && row.date === body.date)
      if (!row) { row = { id: `record-${rows.length}`, created_at: '2026-10-06T00:00:00Z' }; rows.push(row) }
      Object.assign(row, body)
      return Response.json([{ ...row }])
    }
    assert.equal(url.searchParams.get('user_id'), `eq.${owner}`)
    const found = rows.filter(match)
    if (method === 'PATCH') found.forEach((row) => Object.assign(row, body))
    return Response.json(found.filter((row) => !url.searchParams.has('completed') || row.completed === true))
  }

  assert.equal((await invoke(recordsApi, { method: 'POST', token: null, body: {} })).code, 401)
  assert.equal((await invoke(recordsApi, { method: 'POST', token: 'invalid', body: {} })).code, 401)
  assert.equal(calls.length, 0)
  const input = { habitId: habitA, completedDate: '2026-10-06', user_id: ownerB, note: 'メモを残す' }
  const saved = await invoke(recordsApi, { method: 'POST', body: input })
  assert.equal(saved.code, 200)
  assert.equal(saved.value.user_id, ownerA)
  await invoke(recordsApi, { method: 'POST', body: { habitId: habitA, completedDate: '2026-10-06' } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].memo, 'メモを残す')
  await invoke(recordsApi, { method: 'POST', body: { habitId: habitA, completedDate: '2026-10-05' } })
  assert.equal((await invoke(recordsApi, { method: 'DELETE', query: { habitId: habitA, date: '2026-10-06' } })).code, 204)
  assert.equal(rows.length, 2)
  assert.equal(rows.find((row) => row.date === '2026-10-06').completed, false)
  assert.equal((await invoke(dataApi)).value.records.length, 1)
  await invoke(recordsApi, { method: 'POST', body: { habitId: habitA, completedDate: '2026-10-06' } })
  assert.equal(rows.length, 2)
  assert.equal((await invoke(dataApi, { token: 'token-a-relogin' })).value.records.length, 2)
  assert.equal((await invoke(dataApi, { token: 'token-b' })).value.records.length, 0)
  for (const method of ['POST', 'PATCH']) {
    assert.equal((await invoke(recordsApi, { method, body: { habitId: habitB, completedDate: '2026-10-06' } })).code, 404)
  }
  assert.equal((await invoke(recordsApi, { method: 'DELETE', query: { habitId: habitB, date: '2026-10-06' } })).code, 404)
  assert.equal((await invoke(recordsApi, { method: 'POST', body: { habitId: habitA, completedDate: '2026-02-30' } })).code, 400)
  const created = await invoke(habitsApi, { method: 'POST', body: { name: '新しい習慣', frequencyType: 'daily', startDate: '2026-10-06', user_id: ownerB } })
  assert.equal(created.value.user_id, ownerA)
  assert.equal((await invoke(editApi, { method: 'PATCH', query: { id: habitB }, body: { name: '改ざん' } })).code, 404)
  assert.equal(habits.find((row) => row.id === habitB).name, '他人の習慣')
  const weeklyEdit = await invoke(editApi, { method: 'PATCH', query: { id: habitA }, body: { frequencyType: 'weekly', targetPerWeek: 4 } })
  assert.equal(weeklyEdit.value.target_per_week, 4)
  const partial = await invoke(editApi, { method: 'PATCH', query: { id: habitA }, body: { targetPerWeek: 3 } })
  assert.equal(partial.value.target_per_week, 3)
  assert.equal((await invoke(editApi, { method: 'PATCH', query: { id: habitA }, body: { targetPerWeek: 8 } })).code, 400)
  const selectedEdit = await invoke(editApi, { method: 'PATCH', query: { id: habitA }, body: { frequencyType: 'selected_days', selectedDays: [7, 1, 1], endDate: '2026-12-31' } })
  assert.deepEqual(selectedEdit.value.selected_days, [1, 7])
  assert.equal(selectedEdit.value.target_per_week, null)
  const clearDate = await invoke(editApi, { method: 'PATCH', query: { id: habitA }, body: { frequencyType: 'daily', endDate: null, user_id: ownerB } })
  assert.equal(clearDate.value.end_date, null)
  assert.equal(clearDate.value.selected_days, null)
  assert.equal(clearDate.value.user_id, ownerA)
})

test('invalid real calendar dates are rejected', () => {
  assert.equal(isValidDate('2024-02-29'), true)
  assert.equal(isValidDate('2026-02-29'), false)
  assert.equal(isValidDate('2026-13-01'), false)
  assert.equal(isValidDate('2026-10-06T00:00:00Z'), false)
})

test('frequency payload matches DB constraints and local dates', () => {
  const base = { name: '読書', startDate: '2026-10-06' }
  assert.equal(habitPayload(base).frequency_type, 'daily')
  assert.equal(habitPayload({ ...base, frequencyType: 'weekly', targetPerWeek: 7 }).target_per_week, 7)
  assert.equal(habitPayload({ ...base, frequencyType: 'monthly', targetPerMonth: 31 }).target_per_month, 31)
  assert.deepEqual(habitPayload({ ...base, frequencyType: 'selected_days', selectedDays: [7, 1, 3, 1] }).selected_days, [1, 3, 7])
  assert.deepEqual(habitPayload({ ...base, frequencyType: 'selected_days', selectedDays: [1, 2, 3, 4, 5] }).selected_days, [1, 2, 3, 4, 5])
  for (const bad of [{ frequencyType: 'weekly', targetPerWeek: 0 }, { frequencyType: 'weekly', targetPerWeek: 8 }, { frequencyType: 'monthly', targetPerMonth: 32 }, { frequencyType: 'selected_days', selectedDays: [] }, { frequencyType: 'selected_days', selectedDays: [0] }, { frequencyType: 'selected_days', selectedDays: [8] }, { endDate: '2026-10-05' }, { startDate: '2026-02-30' }]) {
    assert.throws(() => habitPayload({ ...base, ...bad }))
  }
})

test('missing environment, denied network, bad key, auth outage and RLS are distinct', async () => {
  const previousFetch = globalThis.fetch
  const configured = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
  try {
    delete process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    const missing = await invoke(dataApi)
    assert.equal(missing.code, 500)
    assert.equal(missing.value.code, 'SUPABASE_ENV_MISSING')
    assert.match(missing.value.error, /VITE_SUPABASE_PUBLISHABLE_KEY/)
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = configured
    globalThis.fetch = async () => { throw new TypeError('fetch failed', { cause: { code: 'EACCES', request: { authorization: 'sensitive-test-value' } } }) }
    const denied = await invoke(dataApi)
    assert.equal(denied.code, 502)
    assert.equal(denied.value.code, 'SUPABASE_NETWORK_DENIED')
    assert.match(denied.value.error, /EACCES/)
    assert.doesNotMatch(JSON.stringify(denied.value), /Vercel|sensitive-test-value|sb_publishable_test_only/)
    globalThis.fetch = async () => Response.json({ message: 'Invalid API key' }, { status: 401 })
    const badKey = await invoke(dataApi)
    assert.equal(badKey.code, 502)
    assert.equal(badKey.value.code, 'SUPABASE_KEY_INVALID')
    globalThis.fetch = async () => Response.json({ message: 'auth outage' }, { status: 503 })
    const unavailable = await invoke(dataApi)
    assert.equal(unavailable.code, 502)
    assert.equal(unavailable.value.code, 'SUPABASE_AUTH_ERROR')
    assert.match(unavailable.value.error, /HTTP 503/)
    globalThis.fetch = async (url) => String(url).endsWith('/auth/v1/user')
      ? Response.json({ id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' })
      : Response.json({ code: '42501', message: 'permission denied for table users' }, { status: 403 })
    const rls = await invoke(dataApi)
    assert.equal(rls.code, 403)
    assert.equal(rls.value.code, 'SUPABASE_RLS_DENIED')
    assert.match(rls.value.error, /permission denied/)
  } finally {
    globalThis.fetch = previousFetch
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = configured
  }
})
