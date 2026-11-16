import { useEffect, useState } from 'react'
import { ActionLink } from '../../components/ActionLink'
import arrowLeft from '../../assets/legal/arrow-left.svg'
import { faqItems } from '../../config/faq'
import { footerContent } from '../../config/footer'
import { usePublicProfile } from '../../sections/about/useAboutData'
import './FaqPage.css'

interface FaqAccordionProps {
  contactHref: string
  contactLabel: string
}

function FaqAccordion({ contactHref, contactLabel }: FaqAccordionProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set<string>())

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
        {faqItems.map((item) => {
          const isOpen = openIds.has(item.id)
          const questionId = `faq-q-${item.id}`
          const answerId = `faq-a-${item.id}`

          return (
            <div
              className={`faq-page__item ${isOpen ? 'faq-page__item--open' : ''}`}
              key={item.id}
            >
              <h2 className="faq-page__question-heading">
                <button
                  type="button"
                  id={questionId}
                  className={`faq-page__question-button ${
                    isOpen ? 'faq-page__question-button--open' : ''
                  }`}
                  aria-expanded={isOpen}
                  aria-controls={answerId}
                  onClick={() => toggleItem(item.id)}
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
              </h2>
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
            </div>
          )
        })}
      </div>

      <div className="faq-page__inquiry">
        <p className="faq-page__inquiry-text">
          Still have questions?{' '}
          <ActionLink
            className="faq-page__contact-link"
            href={contactHref}
          >
            {contactLabel}
          </ActionLink>
        </p>
      </div>
    </>
  )
}

export function FaqSection() {
  return (
    <section id="faq" className="faq-page faq-page--inline" aria-labelledby="faq-heading">
      <div className="faq-page__inner">
        <header className="faq-page__header">
          <h2 id="faq-heading" className="faq-page__title">FAQ</h2>
        </header>

        <FaqAccordion contactHref="#contact" contactLabel="Get in touch →" />
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
