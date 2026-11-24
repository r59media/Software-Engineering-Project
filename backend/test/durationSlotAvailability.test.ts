import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSlotInWeeklyAvailability } from '../src/routes/schedule.ts'

test('isSlotInWeeklyAvailability correctly enforces multi-hour service duration', () => {
  const weeklyAvailability = [
    {
      day: 'Sunday',
      available: true,
      timeframes: [{ start: '08:00', end: '23:59' }]
    },
    {
      day: 'Monday',
      available: true,
      timeframes: [{ start: '08:00', end: '23:00' }]
    }
  ]

  // Sunday 2026-11-22: Admin open 08:00 to 23:59
  const sundaySlot7PM = { date: '2026-11-22', start_time: '19:00', end_time: '20:00' }
  const sundaySlot3PM = { date: '2026-11-22', start_time: '15:00', end_time: '16:00' }
  const sundaySlot8AM = { date: '2026-11-22', start_time: '08:00', end_time: '09:00' }

  // 1. Without duration (1-hour default): 7:00 PM fits
  assert.equal(isSlotInWeeklyAvailability(sundaySlot7PM, weeklyAvailability), true)

  // 2. Wedding package (8 hours / 480 min):
  // 7:00 PM (19:00) + 8 hours = 03:00 AM next day -> MUST FAIL
  assert.equal(isSlotInWeeklyAvailability(sundaySlot7PM, weeklyAvailability, 480), false)

  // 3. Wedding package @ 3:00 PM (15:00) + 8 hours = 23:00 <= 23:59 -> MUST SUCCEED
  assert.equal(isSlotInWeeklyAvailability(sundaySlot3PM, weeklyAvailability, 480), true)

  // 4. Wedding package @ 8:00 AM (08:00) + 8 hours = 16:00 <= 23:59 -> MUST SUCCEED
  assert.equal(isSlotInWeeklyAvailability(sundaySlot8AM, weeklyAvailability, 480), true)

  // Monday 2026-11-23: Admin open 08:00 to 23:00
  const mondaySlot4PM = { date: '2026-11-23', start_time: '16:00', end_time: '17:00' }
  const mondaySlot3PM = { date: '2026-11-23', start_time: '15:00', end_time: '16:00' }

  // 16:00 + 8h = 24:00 (crosses 23:00 close) -> MUST FAIL
  assert.equal(isSlotInWeeklyAvailability(mondaySlot4PM, weeklyAvailability, 480), false)

  // 15:00 + 8h = 23:00 (exactly at 23:00 close) -> MUST SUCCEED
  assert.equal(isSlotInWeeklyAvailability(mondaySlot3PM, weeklyAvailability, 480), true)

  // 1-hour session @ 4:00 PM on Monday -> MUST SUCCEED
  assert.equal(isSlotInWeeklyAvailability(mondaySlot4PM, weeklyAvailability, 60), true)
})
