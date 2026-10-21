import { aboutContent, aboutImages } from '../../config/about'
import type { AboutContent } from '../../types/about'
import { AboutArtwork } from './AboutArtwork'
import { AboutDecorations } from './AboutDecorations'
import { AboutPortrait } from './AboutPortrait'
import './About.css'

export function About({ content = aboutContent }: { content?: AboutContent }) {
  return <section id="about" className="about" aria-labelledby="about-heading">
    <AboutArtwork image={aboutImages.paper} className="about__paper" />
    <AboutDecorations />
    <div className="about__layout">
      <AboutPortrait />
      <div className="about__content">
        <p className="about__eyebrow" data-about-part="eyebrow"><span aria-hidden="true" />{content.eyebrow}</p>
        <h2 id="about-heading" className="about__heading">
          <span data-about-part="heading">{content.heading}</span>
          <span className="about__subheading" data-about-part="subheading">{content.subheading}</span>
        </h2>
        <p className="about__biography" data-about-part="biography">{content.biography}</p>
        {/* Static transition artwork. Future scroll motion connects to the next section. */}
        <div className="about__lens" data-about-part="lens-transition" aria-hidden="true">
          <div className="about__motion" data-about-motion="lens-transition">
            <AboutArtwork image={aboutImages.frontLens} />
            <div className="about__lens-center" data-about-part="lens-center">
              <AboutArtwork image={aboutImages.lensInset} />
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
}
