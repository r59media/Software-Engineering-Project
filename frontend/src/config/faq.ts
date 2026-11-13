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
      'We offer portrait sessions, graduation photoshoots, personal branding, event coverage, and custom business packages. You can explore each package and its deliverables in detail on our booking page.',
  },
  {
    id: 'how-to-book',
    question: 'How do I book a photography session?',
    answer:
      'Select the service you want in the booking section, choose an available date and time, enter your contact information, and submit your deposit payment. You will receive a confirmation after your reservation is submitted.',
  },
  {
    id: 'deposit-requirement',
    question: 'Is a deposit required to reserve my session?',
    answer:
      'Yes. A deposit is required to secure your selected date and time. The booking page will show the amount due before you finalize your reservation.',
  },
  {
    id: 'last-minute-session',
    question: 'Can I book a last-minute session?',
    answer:
      'Last-minute availability depends on our schedule. If your desired date is not available in the booking calendar, please reach out directly through our contact inquiry form and we will do our best to accommodate you.',
  },
  {
    id: 'location',
    question: 'Where are you located?',
    answer:
      'We are based in the New Jersey / New York metropolitan area and shoot on location as well as in studio settings. Travel options are also available upon request.',
  },
  {
    id: 'delivery-timeline',
    question: 'When will I receive my photos?',
    answer:
      'The delivery time depends on the type and size of the session. An estimated delivery date will be discussed before your shoot, and standard turnaround is typically 1 to 2 weeks.',
  },
  {
    id: 'photo-delivery',
    question: 'How will my photos be delivered?',
    answer:
      'Your professionally edited, high-resolution photos will be delivered via a secure, private digital gallery where you can download and share your images.',
  },
  {
    id: 'after-booking',
    question: 'What happens after I book?',
    answer:
      'Once your session is booked and deposit confirmed, we will reach out with a prep guide, discuss locations and outfit styling, and confirm all final details for shoot day.',
  },
  {
    id: 'reschedule-cancel',
    question: 'Can I reschedule or cancel my session?',
    answer:
      'Yes. We understand unexpected events happen. You can reschedule your session with advance notice as outlined in our booking policy. Weather-related cancellations for outdoor shoots will be rescheduled at no additional fee.',
  },
  {
    id: 'inquiry-details',
    question: 'What should I include in my inquiry?',
    answer:
      'Please include your preferred date or timeframe, location ideas, the type of session or project scope, and any inspiration or specific goals you have in mind.',
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
