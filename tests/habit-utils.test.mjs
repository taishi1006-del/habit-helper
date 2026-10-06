import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { countThisMonth, countThisWeek, getStreak, getLongestStreak, getStreakLabel, isDueToday, isScheduledOn, toISODate } from '../src/utils.ts'

const date = (value) => new Date(`${value}T00:00:00`)
const habit = (overrides = {}) => ({ id: 'habit-a', name: '読書', frequencyType: 'daily', startDate: '2026-01-01', ...overrides })
const records = (...days) => days.map((day, i) => ({ id: String(i), habitId: 'habit-a', completedDate: day, createdAt: `${day}T12:00:00Z` }))

test('local calendar dates and Monday-based weeks', () => {
  assert.equal(toISODate(new Date(2026, 9, 6, 0, 5)), '2026-10-06')
  const rows = records('2026-10-04', '2026-10-05', '2026-10-05', '2026-10-06', '2026-10-07')
  assert.equal(countThisWeek('habit-a', rows, date('2026-10-06')), 2)
  assert.equal(countThisWeek('habit-a', rows, date('2026-10-04')), 1)
  assert.equal(countThisMonth('habit-a', rows, date('2026-10-06')), 3)
})

test('daily, legacy, selected weekdays, start/end dates', () => {
  assert.equal(isDueToday(habit(), date('2026-10-06')), true)
  assert.equal(isDueToday(habit({ frequencyType: undefined }), date('2026-10-06')), true)
  const selected = habit({ frequencyType: 'selected_days', selectedDays: [1, 3, 5] })
  assert.equal(isDueToday(selected, date('2026-10-05')), true)
  assert.equal(isDueToday(selected, date('2026-10-06')), false)
  assert.equal(isDueToday(habit({ frequencyType: 'selected_days', selectedDays: [7] }), date('2026-10-04')), true)
  assert.equal(isDueToday(habit({ startDate: '2026-10-07' }), date('2026-10-06')), false)
  assert.equal(isDueToday(habit({ endDate: '2026-10-05' }), date('2026-10-06')), false)
})

test('weekly target: hide after goal, retain checked item today, reset Monday', () => {
  const weekly = habit({ frequencyType: 'weekly', targetPerWeek: 1 })
  assert.equal(isDueToday(weekly, date('2026-10-06'), []), true)
  assert.equal(isDueToday(weekly, date('2026-10-06'), records('2026-10-05')), false)
  assert.equal(isDueToday(weekly, date('2026-10-06'), records('2026-10-06')), true)
  assert.equal(isDueToday(weekly, date('2026-10-12'), records('2026-10-06')), true)
  assert.equal(isScheduledOn(weekly, date('2026-10-06')), true)
  assert.equal(isDueToday(weekly, date('2026-10-06'), [{ ...records('2026-10-05')[0], habitId: 'other' }]), true)
})

test('monthly target: distinct dates, current month and no future records', () => {
  const monthly = habit({ frequencyType: 'monthly', targetPerMonth: 2 })
  assert.equal(isDueToday(monthly, date('2026-10-06'), records('2026-09-30', '2026-10-05', '2026-10-05', '2026-10-07')), true)
  assert.equal(isDueToday(monthly, date('2026-10-06'), records('2026-10-04', '2026-10-05')), false)
  assert.equal(isDueToday(monthly, date('2026-11-01'), records('2026-10-04', '2026-10-05')), true)
  assert.equal(isDueToday(monthly, date('2026-10-06'), records('2026-10-05', '2026-10-06')), true)
})

test('daily streak: unfinished today has grace; missed past day breaks; duplicates/future excluded', () => {
  const daily = habit()
  assert.equal(getStreak(daily, records('2026-10-04', '2026-10-05'), date('2026-10-06')), 2)
  assert.equal(getStreak(daily, records('2026-10-04', '2026-10-05', '2026-10-06'), date('2026-10-06')), 3)
  assert.equal(getStreak(daily, records('2026-10-04'), date('2026-10-06')), 0)
  assert.equal(getStreak(daily, records('2026-10-04', '2026-10-04', '2026-10-05', '2026-10-07'), date('2026-10-06')), 2)
  assert.equal(getLongestStreak(daily, records('2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-06'), date('2026-10-06')), 3)
  assert.equal(getStreak(habit({ startDate: '2026-10-05' }), records('2026-10-04', '2026-10-05'), date('2026-10-06')), 1)
})

test('selected days bridge non-scheduled days and break only after missing a target day', () => {
  const selected = habit({ frequencyType: 'selected_days', selectedDays: [1, 3, 5] })
  const rows = records('2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05')
  assert.equal(getStreak(selected, rows, date('2026-10-06')), 4)
  assert.equal(getStreak(selected, rows, date('2026-10-07')), 4)
  assert.equal(getStreak(selected, rows, date('2026-10-08')), 0)
  assert.equal(getStreak(selected, [...rows, ...records('2026-10-07')], date('2026-10-08')), 5)
  assert.equal(getLongestStreak(selected, rows, date('2026-10-08')), 4)
  assert.equal(getStreakLabel(selected, 4), '4回連続（対象日）')
  assert.equal(getStreak(habit({ frequencyType: 'selected_days', selectedDays: [] }), rows, date('2026-10-06')), 0)
})

test('weekdays bridge weekend; ended schedules have no indefinite grace', () => {
  const weekday = habit({ frequencyType: 'selected_days', selectedDays: [1, 2, 3, 4, 5] })
  assert.equal(getStreak(weekday, records('2026-10-01', '2026-10-02'), date('2026-10-05')), 2)
  assert.equal(getStreak(weekday, records('2026-10-01', '2026-10-02'), date('2026-10-06')), 0)
  assert.equal(getStreak(habit({ endDate: '2026-10-05' }), records('2026-10-04'), date('2026-10-06')), 0)
  assert.equal(getStreak(habit({ endDate: '2026-10-05' }), records('2026-10-04', '2026-10-05'), date('2026-10-06')), 2)
})

test('weekly streak counts achieved Monday-Sunday periods, not individual days', () => {
  const weekly = habit({ frequencyType: 'weekly', targetPerWeek: 2 })
  const rows = records('2026-09-21', '2026-09-23', '2026-09-28', '2026-10-02', '2026-10-05')
  assert.equal(getStreak(weekly, rows, date('2026-10-06')), 2)
  assert.equal(getStreak(weekly, [...rows, ...records('2026-10-06')], date('2026-10-06')), 3)
  assert.equal(getStreak(weekly, rows, date('2026-10-12')), 0)
  assert.equal(getLongestStreak(weekly, rows, date('2026-10-12')), 2)
  assert.equal(getStreakLabel(weekly, 2), '2週連続')
  assert.equal(getStreak({ ...weekly, startDate: '2025-01-01' }, records('2025-12-22', '2025-12-23', '2025-12-29', '2026-01-01'), date('2026-01-04')), 2)
})

test('monthly streak bridges month/year boundaries, no failure during an open month', () => {
  const monthly = habit({ frequencyType: 'monthly', targetPerMonth: 2, startDate: '2025-01-01' })
  const rows = records('2025-11-01', '2025-11-02', '2025-12-01', '2025-12-31', '2026-01-01')
  assert.equal(getStreak(monthly, rows, date('2026-01-15')), 2)
  assert.equal(getStreak(monthly, [...rows, ...records('2026-01-15')], date('2026-01-15')), 3)
  assert.equal(getStreak(monthly, rows, date('2026-02-01')), 0)
  assert.equal(getLongestStreak(monthly, rows, date('2026-02-01')), 2)
  assert.equal(getStreakLabel(monthly, 2), '2か月連続')
})

test('streaks use calendar navigation across daylight-saving transitions', () => {
  assert.equal(getStreak(habit(), records('2026-03-07', '2026-03-08', '2026-03-09'), date('2026-03-09')), 3)
  assert.equal(getStreak(habit(), records('2026-10-31', '2026-11-01', '2026-11-02'), date('2026-11-02')), 3)
})

test('local date is preserved on both sides of UTC, including daylight saving', () => {
  const moduleUrl = new URL('../src/utils.ts', import.meta.url).href
  for (const [zone, timestamp, expected] of [['Asia/Tokyo', '2026-10-05T15:05:00Z', '2026-10-06'], ['America/Los_Angeles', '2026-10-06T06:30:00Z', '2026-10-05']]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {toISODate,getStreak} from ${JSON.stringify(moduleUrl)}; console.log(toISODate(new Date(${JSON.stringify(timestamp)}))); const h={id:'a',frequencyType:'daily',startDate:'2026-01-01'}; const r=['2026-03-07','2026-03-08','2026-03-09'].map(completedDate=>({habitId:'a',completedDate})); console.log(getStreak(h,r,new Date('2026-03-09T00:00:00')));`], { env: { ...process.env, TZ: zone }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), `${expected}\n3`)
  }
})
