import { aboutDecorations } from '../../config/about'
import { AboutArtwork } from './AboutArtwork'

export function AboutDecorations() {
  return <div className="about__decorations" aria-hidden="true">
    {aboutDecorations.map(image => <AboutArtwork key={image.id} image={image} />)}
  </div>
}
