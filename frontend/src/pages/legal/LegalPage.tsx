import { ActionLink } from '../../components/ActionLink'
import arrowLeft from '../../assets/legal/arrow-left.svg'
import { legalContent } from './legalContent'
import { footerContent } from '../../config/footer'
import { usePublicProfile } from '../../hooks/usePublicProfile'
import './LegalPage.css'

export function LegalPage({ page }: { page: 'privacy' | 'terms' }) {
  const { profile } = usePublicProfile()
  const content = legalContent[page]
  const contactEmail = profile?.email?.trim() || footerContent.email

  return (
    <main id="legal-content" className={`legal-page legal-page--${page}`}>
      <div className="legal-page__inner">
        <div className="legal-page__intro">
          <a className="legal-page__back" href={import.meta.env.BASE_URL}>
            <img src={arrowLeft} width="16" height="16" alt="" />
            Back to home
          </a>
          <h1>{content.title}</h1>
          <p>{content.introduction}</p>
          <p><strong>{content.metaLabel}</strong> {content.metaValue}</p>
        </div>
        <div className="legal-page__sections">
          {content.sections.map((section) => (
            <section className="legal-page__section" key={section.heading}>
              <h2>{section.heading}</h2>
              <div className="legal-page__blocks">
                {section.blocks.map((block, index) => block.type === 'list' ? (
                  <ul key={index}>{block.items.map((item) => <li key={item}>{item}</li>)}</ul>
                ) : <p key={index}>{block.text}</p>)}
              </div>
            </section>
          ))}
        </div>
        <section className="legal-page__questions">
          <h2>{content.questionHeading}</h2>
          <p>{content.questionText}</p>
          <ActionLink className="legal-page__contact" href={`mailto:${contactEmail}`}>Contact R59MEDIA →</ActionLink>
        </section>
      </div>
    </main>
  )
}
