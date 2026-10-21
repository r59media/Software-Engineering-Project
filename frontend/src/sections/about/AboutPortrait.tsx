import { aboutImages } from '../../config/about'
import { AboutArtwork } from './AboutArtwork'

export function AboutPortrait() {
  return <div className="about__collage" data-about-part="portrait-collage">
    <AboutArtwork image={aboutImages.yellowCard} />
    <AboutArtwork image={aboutImages.redCard} />
    <AboutArtwork image={aboutImages.signature} />
    <div className="about__portrait" data-about-part="portrait-group">
      <div className="about__motion" data-about-motion="portrait-group">
        <div className="about__portrait-pose">
          <AboutArtwork image={aboutImages.portrait} />
          <AboutArtwork image={aboutImages.portraitFrame} />
        </div>
      </div>
    </div>
  </div>
}
