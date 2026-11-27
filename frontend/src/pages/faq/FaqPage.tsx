import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { ActionLink } from '../../components/ActionLink'
import arrowLeft from '../../assets/legal/arrow-left.svg'
import { faqItems, type FaqItem } from '../../config/faq'
import { footerContent } from '../../config/footer'
import { usePublicProfile } from '../../hooks/usePublicProfile'
import './FaqPage.css'

interface FaqAccordionItemProps {
  item: FaqItem
  isOpen: boolean
  questionHeading: 'h2' | 'h3'
  scrollReveal: boolean
  onToggle: (id: string) => void
}

function FaqAccordionItem({
  item,
  isOpen,
  questionHeading,
  scrollReveal,
  onToggle,
}: FaqAccordionItemProps) {
  const slotRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: slotRef,
    offset: ['start 0.9', 'start 0.62'],
  })
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 200,
    damping: 28,
    mass: 0.32,
  })
  const opacity = useTransform(smoothProgress, [0, 1], [0, 1], { clamp: true })
  const y = useTransform(smoothProgress, [0, 1], [38, 0], { clamp: true })

  const QuestionHeading = questionHeading
  const questionId = `faq-q-${item.id}`
  const answerId = `faq-a-${item.id}`
  const animateRow = scrollReveal && !prefersReducedMotion

  return (
    <div ref={slotRef} className="faq-page__slot">
      <motion.div
        className={`faq-page__item ${isOpen ? 'faq-page__item--open' : ''}`}
        style={animateRow ? { opacity, y } : undefined}
      >
        <QuestionHeading className="faq-page__question-heading">
          <button
            type="button"
            id={questionId}
            className={`faq-page__question-button ${
              isOpen ? 'faq-page__question-button--open' : ''
            }`}
            aria-expanded={isOpen}
            aria-controls={answerId}
            onClick={() => onToggle(item.id)}
          >
            <span className="faq-page__question-text">{item.question}</span>
            <span className="faq-page__indicator" aria-hidden="true">
              <svg
                className={`faq-page__chevron ${
                  isOpen ? 'faq-page__chevron--open' : ''
                }`}
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                focusable="false"
              >
                <path
                  d="M5 7.5L10 12.5L15 7.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>
        </QuestionHeading>
        <div
          id={answerId}
          role="region"
          aria-labelledby={questionId}
          className={`faq-page__answer-panel ${
            isOpen ? 'faq-page__answer-panel--open' : ''
          }`}
          aria-hidden={!isOpen}
        >
          <div className="faq-page__answer-content">
            <p className="faq-page__answer-text">{item.answer}</p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

interface FaqAccordionProps {
  contactHref: string
  contactLabel: string
  questionHeading?: 'h2' | 'h3'
  scrollReveal?: boolean
}

function FaqAccordion({
  contactHref,
  contactLabel,
  questionHeading = 'h2',
  scrollReveal = false,
}: FaqAccordionProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set<string>())
  const inquiryRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress: inquiryProgress } = useScroll({
    target: inquiryRef,
    offset: ['start 0.92', 'start 0.68'],
  })
  const smoothInquiry = useSpring(inquiryProgress, {
    stiffness: 200,
    damping: 28,
    mass: 0.32,
  })
  const inquiryOpacity = useTransform(smoothInquiry, [0, 1], [0, 1], { clamp: true })
  const inquiryY = useTransform(smoothInquiry, [0, 1], [28, 0], { clamp: true })
  const animateInquiry = scrollReveal && !prefersReducedMotion

  const toggleItem = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <>
      <div className="faq-page__list">
        {faqItems.map((item) => (
          <FaqAccordionItem
            key={item.id}
            item={item}
            isOpen={openIds.has(item.id)}
            questionHeading={questionHeading}
            scrollReveal={scrollReveal}
            onToggle={toggleItem}
          />
        ))}
      </div>

      <motion.div
        ref={inquiryRef}
        className="faq-page__inquiry"
        style={animateInquiry ? { opacity: inquiryOpacity, y: inquiryY } : undefined}
      >
        <p className="faq-page__inquiry-text">
          Still have questions?{' '}
          <ActionLink
            className="faq-page__contact-link"
            href={contactHref}
          >
            {contactLabel}
          </ActionLink>
        </p>
      </motion.div>
    </>
  )
}

export function FaqSection() {
  const headerRef = useRef<HTMLElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: headerRef,
    offset: ['start 0.9', 'start 0.56'],
  })
  const smoothHeader = useSpring(scrollYProgress, {
    stiffness: 190,
    damping: 28,
    mass: 0.32,
  })
  const titleX = useTransform(smoothHeader, [0, 1], ['-105vw', '0vw'], { clamp: true })

  return (
    <section id="faq" className="faq-page faq-page--inline" aria-labelledby="faq-heading">
      <div className="faq-page__inner">
        <header ref={headerRef} className="faq-page__header">
          <motion.h2
            id="faq-heading"
            className="faq-page__title"
            style={prefersReducedMotion ? undefined : { x: titleX }}
          >
            FAQ
          </motion.h2>
        </header>

        <FaqAccordion
          contactHref="#contact"
          contactLabel="Get in touch →"
          questionHeading="h3"
          scrollReveal
        />
      </div>
    </section>
  )
}

export function FaqPage() {
  const { profile } = usePublicProfile()

  useEffect(() => {
    document.title = 'FAQ | R59 Media'
  }, [])

  const contactEmail = profile?.email || footerContent.email

  return (
    <main id="faq-content" className="faq-page">
      <div className="faq-page__inner">
        <header className="faq-page__header">
          <a className="faq-page__back" href={import.meta.env.BASE_URL}>
            <img src={arrowLeft} width="16" height="16" alt="" aria-hidden="true" />
            <span>Back to home</span>
          </a>
          <h1 className="faq-page__title">FAQ</h1>
        </header>

        <FaqAccordion
          contactHref={`mailto:${contactEmail}`}
          contactLabel="Contact R59MEDIA →"
        />
      </div>
    </main>
  )
}
