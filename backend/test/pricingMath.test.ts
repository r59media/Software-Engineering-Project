import test from 'node:test'
import assert from 'node:assert/strict'
import { isSlotInWeeklyAvailability } from '../src/routes/schedule.ts'
import { normalizeDepositPercent } from '../src/lib/billingMath.ts'

test('pricing math: total calculation with baseFee, perPerson, and additional people', () => {
  const servicePriceCents = 15000 // $150.00
  const baseFee = 25 // $25.00
  const baseFeeCents = Math.round(baseFee * 100)
  const perPerson = 20 // $20.00
  const perPersonCents = Math.round(perPerson * 100)
  const attendees = 3
  const includedPeople = 1
  const additionalPeople = Math.max(0, attendees - includedPeople) // 2

  const extraPeopleFeeCents = perPersonCents * additionalPeople // 4000 cents
  const subtotalCents = servicePriceCents + baseFeeCents + extraPeopleFeeCents // 15000 + 2500 + 4000 = 21500 ($215.00)

  assert.equal(subtotalCents, 21500)

  // 10% coupon
  const couponDiscountCents = Math.round((subtotalCents * 10) / 100) // 2150 cents
  const totalCents = Math.max(0, subtotalCents - couponDiscountCents) // 19350 cents
  assert.equal(totalCents, 19350)

  // 50% deposit
  const depositPercent = 50
  const depositCents = Math.round((totalCents * depositPercent) / 100) // 9675 cents ($96.75)
  assert.equal(depositCents, 9675)
})

test('pricing math: coupon flooring at 0 and deposit', () => {
  const subtotalCents = 10000 // $100.00
  const fixedDiscountDollars = 150 // $150 off
  const couponDiscountCents = fixedDiscountDollars * 100 // 15000 cents

  const totalCents = Math.max(0, subtotalCents - couponDiscountCents) // floor at 0
  assert.equal(totalCents, 0)

  const depositPercent = 60
  const depositCents = Math.round((totalCents * depositPercent) / 100)
  assert.equal(depositCents, 0)
})

test('weekly availability: isSlotInWeeklyAvailability with and without active rules', () => {
  // Empty rules / unconfigured -> open by default (returns true)
  assert.equal(isSlotInWeeklyAvailability({ date: '2026-11-16', start_time: '10:00', end_time: '11:00' }, []), true)
  // Configured rules where all days are marked unavailable -> closed (returns false)
  assert.equal(
    isSlotInWeeklyAvailability(
      { date: '2026-11-16', start_time: '10:00', end_time: '11:00' },
      [
        { day: 'Monday', available: false, timeframes: [] },
        { day: 'Tuesday', available: false, timeframes: [] }
      ]
    ),
    false
  )

  // Configured weekly availability: Monday 09:00 - 17:00
  // 2026-11-16 is Monday
  const weeklyAvailability = [
    {
      day: 'Monday',
      available: true,
      timeframes: [{ start: '09:00', end: '17:00' }]
    },
    {
      day: 'Tuesday',
      available: false,
      timeframes: []
    }
  ]

  // Inside Monday window
  assert.equal(
    isSlotInWeeklyAvailability({ date: '2026-11-16', start_time: '10:00', end_time: '11:00' }, weeklyAvailability),
    true
  )

  // Outside Monday window (starts before 09:00)
  assert.equal(
    isSlotInWeeklyAvailability({ date: '2026-11-16', start_time: '08:00', end_time: '09:00' }, weeklyAvailability),
    false
  )

  // Outside Monday window (ends after 17:00)
  assert.equal(
    isSlotInWeeklyAvailability({ date: '2026-11-16', start_time: '16:30', end_time: '17:30' }, weeklyAvailability),
    false
  )

  // Tuesday (2026-11-17) is marked unavailable
  assert.equal(
    isSlotInWeeklyAvailability({ date: '2026-11-17', start_time: '10:00', end_time: '11:00' }, weeklyAvailability),
    false
  )
})
