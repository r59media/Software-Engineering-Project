import { aboutContent, aboutImages } from '../../config/about'
import type { AboutContent } from '../../types/about'
import { AboutArtwork } from './AboutArtwork'
import { AboutDecorations } from './AboutDecorations'
import { AboutPortrait } from './AboutPortrait'
import { AboutLens } from './AboutLens'
import { useAboutData } from './useAboutData'
import './About.css'

export function About({ content = aboutContent }: { content?: AboutContent }) {
  const { portrait, paragraphs } = useAboutData()

  return (
    <section id="about" className="about" aria-labelledby="about-heading">
      <AboutArtwork image={aboutImages.paper} className="about__paper" />
      <AboutDecorations />
      <div className="about__layout">
        <AboutPortrait portrait={portrait} />
        <div className="about__content">
          <p className="about__eyebrow" data-about-part="eyebrow">
            <span aria-hidden="true" />
            {content.eyebrow}
          </p>
          <h2 id="about-heading" className="about__heading">
            <span data-about-part="heading">{content.heading}</span>
            <span className="about__subheading" data-about-part="subheading">
              {content.subheading}
            </span>
          </h2>
          <div className="about__biography" data-about-part="biography">
            {paragraphs.map((paragraph, index) => (
              <p key={index} className="about__paragraph">
                {paragraph}
              </p>
            ))}
          </div>
          <AboutLens />
        </div>
      </div>
    </section>
  )
}
