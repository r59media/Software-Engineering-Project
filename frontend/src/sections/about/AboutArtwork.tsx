import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import type { AboutImage } from '../../types/about'

export function AboutArtwork({ image, className = '' }: { image: AboutImage; className?: string }) {
  return (
    <div
      className={`about__artwork ${className}`}
      data-about-part={image.id}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="about__motion" data-about-motion={image.id}>
        <ProtectedCanvasImage
          src={image.imageUrl}
          alt={image.alt}
          className="about__art"
          containerClassName="about__art-container"
          width={image.width}
          height={image.height}
        />
      </div>
    </div>
  )
}
