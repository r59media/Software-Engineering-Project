import type { PricingData } from '../api/client'

export interface BookingService {
  id: string
  name: string
  description: string
  bestFor: string
  image?: { url: string; alt: string }
  durationMinutes: number | null
  photoCount?: number
  outfits?: number
  priceMinor: number | null
  currency: string
  bookingMode: 'direct' | 'inquiry'
  additionalPeople?: { maxPeople?: number; includedPeople: number; extraPersonPriceMinor?: number }
}

export interface ServiceSelection {
  serviceId: string
  people: number
}

export type BookingStep = 'services' | 'datetime' | 'info' | 'summary' | 'deposit'

export interface BookingDateTimeSelection {
  date: string
  timeSlot: string
  timezone: string
  slotId?: number
}

export interface BookingCustomerInfo {
  firstName: string
  lastName: string
  email: string
  phone: string
  notes?: string
}

export interface BookingSectionSession {
  step: BookingStep
  serviceId: string
  people: number
  dateTime?: BookingDateTimeSelection | null
  customerInfo?: BookingCustomerInfo | null
}

export interface BookingProgressBarProps {
  currentStep: BookingStep
  onStepClick?: (step: BookingStep) => void
  maxAccessibleStep?: BookingStep
}

export interface BookingSessionCardProps {
  hideDateHighlight?: boolean
  service: BookingService
  people: number
  pricing?: PricingData | null
  dateTime?: BookingDateTimeSelection | null
  customerInfo?: BookingCustomerInfo | null
  onEditService?: () => void
  onEditDateTime?: () => void
  continueText?: string
  onContinue?: () => void
  isContinueDisabled?: boolean
}

export interface BookingDateTimeProps {
  service: BookingService
  people: number
  pricing?: PricingData | null
  selection?: BookingDateTimeSelection | null
  onSelectDateTime: (selection: BookingDateTimeSelection) => void
  onBack: () => void
  onContinue: () => void
  inquiryHref?: string
}

export interface BookingYourInfoProps {
  service: BookingService
  people: number
  pricing?: PricingData | null
  dateTime: BookingDateTimeSelection
  initialInfo?: BookingCustomerInfo | null
  onDraftChange?: (info: BookingCustomerInfo) => void
  onSubmit: (info: BookingCustomerInfo) => void | Promise<void>
  onBack: () => void
  isSubmitting?: boolean
  error?: string | null
}

export interface BookingServicesProps {
  services?: readonly BookingService[]
  pricing?: PricingData | null
  status?: 'ready' | 'loading' | 'error'
  onRetry?: () => void
  onContinue?: (selection: ServiceSelection) => void
  onSelectionChange?: (selection: ServiceSelection | null) => void
  inquiryHref?: string
  initialSelection?: ServiceSelection | null
}

export interface SquareConfig {
  applicationId: string
  locationId: string
  environment: 'sandbox' | 'production'
}

export interface ConfirmedBookingSummary {
  bookingId?: number
  totalCents: number
  depositPaidCents: number
  balanceDueCents: number
  eventLocation?: string
  rescheduleUrl?: string
  icsUrl?: string
  googleCalendarUrl?: string
}

export interface BookingSectionProps {
  onProceedToDeposit?: (draft: BookingReviewDraft) => void | Promise<void>
  services?: readonly BookingService[]
  pricing?: PricingData | null
  squareConfig?: SquareConfig | null
  status?: 'ready' | 'loading' | 'error'
  onRetry?: () => void
  inquiryHref?: string
  confirmedBooking?: ConfirmedBookingSummary | null
  onResetBooking?: () => void
}

export type DynamicFeeTrigger =
  | 'rush_days'
  | 'days_before_max'
  | 'privacy_declined'
  | 'weekend'
  | 'client_selectable'
  | 'on_location'
  | 'reschedule'

export interface DynamicFeeRule {
  id: string
  name: string
  description?: string
  trigger: DynamicFeeTrigger | string
  amountType: 'fixed' | 'percent'
  /** Amount in dollars when amountType is 'fixed', or 0-100 when 'percent'. */
  amount: number
  /** Optional explicit minor-unit (cents) amount when provided by API. */
  amountMinor?: number
  /** Threshold in days for rush/last-minute fee triggers (e.g. 1 = day-before). */
  thresholdDays?: number
  active?: boolean
}

export interface AppliedFeeItem {
  id: string
  name: string
  trigger: DynamicFeeTrigger | string
  amountMinor: number
  amountDollars: number
}

export interface BookingPolicySettings {
  balanceDueDaysAfterEvent: number
  lateCancellationDays: number
  requireSignature: boolean
  photographerName?: string
  studioName?: string
}

export interface BookingReviewDraft {
  photoPermissions: BookingPhotoPermissions
  photoPermissionTextVersion: string
  serviceId: string
  people: number
  dateTime: BookingDateTimeSelection
  customerInfo: BookingCustomerInfo
  selectedFeeIds?: string[]
  slotId?: number
  slot_id?: number
}

export interface BookingPhotoPermissions {
  websitePortfolio: boolean
  socialMedia: boolean
}

export interface CheckoutResponseData {
  booking_id?: number
  payment_id?: string
  order_id?: string
  reschedule_token?: string
  reschedule_url?: string
  ics_url?: string
  google_calendar_url?: string
}

export interface RescheduleSlotOption {
  id: number
  date: string
  start_time: string
  end_time?: string
}

export interface RescheduleBookingData {
  booking_id: number
  status?: string
  customer_name?: string
  customer_email?: string
  service_name?: string
  service_title?: string
  date: string
  start_time: string
  end_time?: string
  deposit_cents?: number
  deposit_amount?: number
  total_cents?: number
  currency?: string
  reschedule_url?: string
  ics_url?: string
  google_calendar_url?: string
  available_slots: RescheduleSlotOption[]
  rescheduleFeeCents?: number
  rescheduleFeeItems?: { name: string; amountCents: number }[]
}

export interface RescheduleResultData {
  booking_id?: number
  slot_id?: number
  date?: string
  start_time?: string
  end_time?: string
  balance_invoice_updated?: boolean
  reschedule_url?: string
  ics_url?: string
  google_calendar_url?: string
  rescheduleFeeCents?: number
  rescheduleFeeItems?: { name: string; amountCents: number }[]
}

export interface RescheduleIdentityInput {
  name?: string
  email?: string
  phone?: string
}

export interface RescheduleUnlockRequest extends RescheduleIdentityInput {
  bookingId?: number | string
  token?: string
}

export interface RescheduleUnlockData {
  bookingId: number | string
  token: string
  booking: RescheduleBookingData
}
