export function getEasternToday(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    return formatter.format(new Date()) // YYYY-MM-DD
  } catch {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
}

export function parseYMD(dateStr: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, month: month - 1, day }
}

export function formatYMD(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function addDaysToYMD(dateStr: string, days: number): string {
  const { year, month, day } = parseYMD(dateStr)
  const d = new Date(Date.UTC(year, month, day + days))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function formatSlotTime(rawTime: string): string {
  if (rawTime.includes('AM') || rawTime.includes('PM')) {
    return rawTime
  }
  const [hourStr, minStr = '00'] = rawTime.split(':')
  const hour = parseInt(hourStr, 10)
  if (isNaN(hour)) return rawTime
  const isPM = hour >= 12
  const formattedHour = hour % 12 === 0 ? 12 : hour % 12
  const ampm = isPM ? 'PM' : 'AM'
  return `${formattedHour}:${minStr.padStart(2, '0')} ${ampm}`
}

/**
 * Converts a time string (e.g. "08:00", "19:00", "09:00 AM", "03:00 PM")
 * into total minutes from midnight (0 - 1439).
 */
export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0
  const trimmed = timeStr.trim().toUpperCase()
  const is12Hour = trimmed.includes('AM') || trimmed.includes('PM')

  if (is12Hour) {
    const isPM = trimmed.includes('PM')
    const cleaned = trimmed.replace(/[A-Z]/g, '').trim()
    const parts = cleaned.split(':')
    let hours = parseInt(parts[0], 10) || 0
    const minutes = parseInt(parts[1], 10) || 0
    if (isPM && hours < 12) hours += 12
    if (!isPM && hours === 12) hours = 0
    return hours * 60 + minutes
  }

  const parts = trimmed.split(':')
  const hours = parseInt(parts[0], 10) || 0
  const minutes = parseInt(parts[1], 10) || 0
  return hours * 60 + minutes
}

/**
 * Returns the current time in Eastern Time (America/New_York) in minutes from midnight (0 - 1439).
 */
export function getEasternCurrentMinutes(): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = formatter.formatToParts(new Date())
    const hash: Record<string, string> = {}
    for (const p of parts) {
      hash[p.type] = p.value
    }
    let h = parseInt(hash.hour || '0', 10)
    if (h === 24) h = 0
    const m = parseInt(hash.minute || '0', 10)
    return h * 60 + m
  } catch {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  }
}

export interface RawScheduleSlot {
  id?: number
  date: string
  start_time: string
  end_time?: string
  is_booked?: number | boolean
}

/**
 * Validates whether a candidate slot can accommodate the required session duration:
 * 1. The session cannot cross midnight into the next day.
 * 2. If the slot is today (Eastern), the slot start must be in the future (not past/present).
 * 3. The entire window [slotStart, slotStart + durationMinutes] must be continuously covered
 *    by unbooked availability for that day (cannot exceed workday end time, cannot hit booked slots or gaps).
 */
export function isSlotAvailableForDuration(
  candidateSlot: RawScheduleSlot,
  daySlots: readonly RawScheduleSlot[],
  durationMinutes: number | null | undefined,
  easternToday: string,
  currentEasternMinutes: number
): boolean {
  const neededDuration = Math.max(15, durationMinutes && durationMinutes > 0 ? durationMinutes : 60)
  const slotStartMin = parseTimeToMinutes(candidateSlot.start_time)
  const sessionEndMin = slotStartMin + neededDuration

  // 1. A session cannot exceed the calendar day (midnight = 1440 min)
  if (sessionEndMin > 1440) {
    return false
  }

  // 2. Same-day cutoff: slot cannot start in the past or immediately right now
  if (candidateSlot.date === easternToday && slotStartMin <= currentEasternMinutes) {
    return false
  }

  // 3. Unbooked slots for the day
  const unbookedDaySlots = daySlots.filter(s => {
    const isBooked = Number(s.is_booked) === 1 || s.is_booked === true
    if (isBooked) return false
    if (s.date === easternToday && parseTimeToMinutes(s.start_time) <= currentEasternMinutes) {
      return false
    }
    return true
  })

  if (unbookedDaySlots.length === 0) {
    return false
  }

  // Build 1440-minute coverage bitmap for the day
  const coverage = new Uint8Array(1441)
  for (const s of unbookedDaySlots) {
    const sStart = parseTimeToMinutes(s.start_time)
    let sEnd = s.end_time ? parseTimeToMinutes(s.end_time) : sStart + 60
    if (sEnd <= sStart) {
      sEnd = sStart + 60
    }
    // Handle 23:59 as covering up to 1440
    if (sEnd >= 1439) {
      sEnd = 1440
    }
    const from = Math.max(0, Math.min(1440, sStart))
    const to = Math.max(0, Math.min(1440, sEnd))
    for (let m = from; m < to; m++) {
      coverage[m] = 1
    }
  }

  // 4. Verify continuous coverage across [slotStartMin, sessionEndMin)
  for (let m = slotStartMin; m < sessionEndMin; m++) {
    if (coverage[m] === 0) {
      return false
    }
  }

  return true
}

/**
 * Checks preview slots so that multi-hour sessions do not exceed preview studio hours (9am - 6pm),
 * and same-day preview slots in the past are excluded.
 */
export function isPreviewSlotAvailable(
  slotTimeStr: string,
  durationMinutes: number | null | undefined,
  date: string,
  easternToday: string,
  currentEasternMinutes: number
): boolean {
  const neededDuration = Math.max(15, durationMinutes && durationMinutes > 0 ? durationMinutes : 60)
  const startMin = parseTimeToMinutes(slotTimeStr)
  const sessionEndMin = startMin + neededDuration

  if (date === easternToday && startMin <= currentEasternMinutes) {
    return false
  }

  // In preview mode, studio hours are treated as 9:00 AM - 6:00 PM (18:00 / 1080 min)
  if (sessionEndMin > 18 * 60) {
    return false
  }

  return true
}
