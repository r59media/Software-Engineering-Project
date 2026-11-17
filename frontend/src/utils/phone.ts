/** Strip non-digits, normalize an 11-digit US/Canada leading '1', and cap at 10 digits. */
export function extractPhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, '')
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return normalized.slice(0, 10)
}

/** Format a phone input string progressively as (XXX) XXX-XXXX. */
export function formatPhoneInput(value: string): string {
  const digits = extractPhoneDigits(value)
  if (digits.length === 0) return ''
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`
}
