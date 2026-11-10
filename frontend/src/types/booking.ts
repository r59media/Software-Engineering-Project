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
  service: BookingService
  people: number
  dateTime?: BookingDateTimeSelection | null
  onEditService?: () => void
  onEditDateTime?: () => void
  continueText?: string
  onContinue?: () => void
  isContinueDisabled?: boolean
}

export interface BookingDateTimeProps {
  service: BookingService
  people: number
  selection?: BookingDateTimeSelection | null
  onSelectDateTime: (selection: BookingDateTimeSelection) => void
  onBack: () => void
  onContinue: () => void
  inquiryHref?: string
}

export interface BookingYourInfoProps {
  service: BookingService
  people: number
  dateTime: BookingDateTimeSelection
  initialInfo?: BookingCustomerInfo | null
  onSubmit: (info: BookingCustomerInfo) => void | Promise<void>
  onBack: () => void
  isSubmitting?: boolean
  error?: string | null
}

export interface BookingServicesProps {
  services?: readonly BookingService[]
  status?: 'ready' | 'loading' | 'error'
  onRetry?: () => void
  onContinue?: (selection: ServiceSelection) => void
  onSelectionChange?: (selection: ServiceSelection | null) => void
  inquiryHref?: string
  initialSelection?: ServiceSelection | null
}

export interface BookingSectionProps {
  services?: readonly BookingService[]
  status?: 'ready' | 'loading' | 'error'
  onRetry?: () => void
  inquiryHref?: string
}
