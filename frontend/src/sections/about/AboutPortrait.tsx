import { aboutImages } from '../../config/about'
import { useProtectedImage } from '../../hooks/useProtectedImage'
import { AboutArtwork } from './AboutArtwork'

export function AboutPortrait() {
  const protectedPortraitUrl = useProtectedImage(aboutImages.portrait.imageUrl)
  const portrait = { ...aboutImages.portrait, imageUrl: protectedPortraitUrl }

  return <div className="about__collage" data-about-part="portrait-collage">
    <AboutArtwork image={aboutImages.yellowCard} />
    <AboutArtwork image={aboutImages.redCard} />
    <AboutArtwork image={aboutImages.signature} />
    <div className="about__portrait" data-about-part="portrait-group">
      <div className="about__motion" data-about-motion="portrait-group">
        <div className="about__portrait-pose">
          <div className="about__portrait-shield" aria-hidden="true" />
          <AboutArtwork image={portrait} />
          <AboutArtwork image={aboutImages.portraitFrame} />
        </div>
      </div>
    </div>
  </div>
}
