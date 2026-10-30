import { aboutImages } from '../../config/about'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import { AboutArtwork } from './AboutArtwork'

export function AboutPortrait() {
  return (
    <div className="about__collage" data-about-part="portrait-collage">
      <AboutArtwork image={aboutImages.yellowCard} />
      <AboutArtwork image={aboutImages.redCard} />
      <AboutArtwork image={aboutImages.signature} />
      <div className="about__portrait" data-about-part="portrait-group">
        <div className="about__motion" data-about-motion="portrait-group">
          <div className="about__portrait-pose">
            <div className="about__artwork" data-about-part="portrait">
              <div className="about__motion" data-about-motion="portrait">
                <ProtectedCanvasImage
                  src={aboutImages.portrait.imageUrl}
                  alt={aboutImages.portrait.alt}
                  className="about__portrait-canvas"
                  width={aboutImages.portrait.width}
                  height={aboutImages.portrait.height}
                />
              </div>
            </div>
            <AboutArtwork image={aboutImages.portraitFrame} />
          </div>
        </div>
      </div>
    </div>
  )
}
