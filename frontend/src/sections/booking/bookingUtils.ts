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
