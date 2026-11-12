export const inquiryTypes = [
  { id: 'portrait', label: 'Portrait session' },
  { id: 'brand', label: 'Brand / business' },
  { id: 'creative', label: 'Creative project' },
  { id: 'event', label: 'Event photography' },
  { id: 'other', label: 'Something else' },
  { id: 'question', label: 'I have a question' },
] as const
export type InquiryType = typeof inquiryTypes[number]['id']
export interface ContactPhoto {
  id: string
  imageUrl: string
  alt: string
  objectPosition?: string
}
export interface ContactInquiry {
  name: string
  email: string
  phone: string
  inquiryType: InquiryType
  message: string
  eventDate?: string
  eventDateUndecided?: boolean
  location?: string
}
export interface ContactSectionProps {
  photos?: readonly ContactPhoto[]
  onSendInquiry?: (inquiry: ContactInquiry) => Promise<void>
}
