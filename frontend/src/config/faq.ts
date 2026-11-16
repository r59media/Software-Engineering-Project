export interface FaqItem {
  id: string
  question: string
  answer: string
}

export interface FaqCategory {
  id: string
  title: string
  description?: string
  items: readonly FaqItem[]
}

export interface FaqMetadata {
  title: string
  subtitle: string
  intro: string
  questionHeading: string
  questionText: string
}

export const faqMetadata: FaqMetadata = {
  title: 'Frequently Asked Questions',
  subtitle: 'Clear Answers for Your Session',
  intro: 'Have questions about booking a shoot, preparing for your session, or photo delivery? Find clear answers below or get in touch directly with Kevin D Gonzalez at R59 Media.',
  questionHeading: 'Still Have Questions?',
  questionText: 'We are here to help. Reach out directly to discuss custom packages, specific date availability, or any tailored project needs.',
}

export const faqItems: readonly FaqItem[] = [
  {
    id: 'session-types',
    question: 'What types of photography sessions do you offer?',
    answer:
      'R59 Media offers professional headshots, portraits, branding photography, family sessions, creative shoots, and event photography. If you have something different in mind, send an inquiry so we can discuss your idea.',
  },
  {
    id: 'how-to-book',
    question: 'How do I book a photography session?',
    answer:
      'Select the service you want in the booking section, choose an available date and time, enter your contact information, and complete the required payment. You will receive a confirmation after your reservation is submitted.',
  },
  {
    id: 'deposit-requirement',
    question: 'Is a deposit required to reserve my session?',
    answer:
      'Yes. A deposit is required to secure your selected date and time. The booking page will show the amount due before you complete your reservation.',
  },
  {
    id: 'last-minute-session',
    question: 'Can I book a last-minute session?',
    answer:
      'Last-minute reservations may be available depending on the schedule. Sessions booked with less than 24 hours notice may include an additional fee.',
  },
  {
    id: 'location',
    question: 'Where are you located?',
    answer:
      'R59 Media is based in New Jersey and serves clients throughout New Jersey and New York City. Travel availability may depend on the location and type of session.',
  },
  {
    id: 'delivery-timeline',
    question: 'When will I receive my photos?',
    answer:
      'The delivery time depends on the type and size of the session. An estimated delivery date will be discussed before or after your booking.',
  },
  {
    id: 'photo-delivery',
    question: 'How will my photos be delivered?',
    answer:
      'After the photos are ready, you will receive an email with access to a private shared folder where you can view and download your images.',
  },
  {
    id: 'after-booking',
    question: 'What happens after I book?',
    answer:
      'After your reservation is received, the photographer will contact you by email to discuss your ideas, location, schedule, and other important details. You may also receive a contract to review before the session.',
  },
  {
    id: 'reschedule-cancel',
    question: 'Can I reschedule or cancel my session?',
    answer:
      'If you need to make a change, contact R59 Media as soon as possible. Rescheduling and cancellation options may depend on the amount of notice provided and the terms included in your agreement.',
  },
  {
    id: 'inquiry-details',
    question: 'What should I include in my inquiry?',
    answer:
      'Describe the type of session you want, your preferred date and location, and any ideas or special requests you have. Please also include your name, email address, and phone number so the photographer can contact you.',
  },
]

export const faqCategories: readonly FaqCategory[] = [
  {
    id: 'general-faq',
    title: 'General Questions',
    description: 'Find answers to common questions about booking, photography sessions, delivery, and policies.',
    items: faqItems,
  },
]
