import type { PointerEvent } from 'react'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import type { AboutImage } from '../../types/about'

export interface AboutArtworkProps {
  image: AboutImage
  className?: string
  onPointerMove?: (e: PointerEvent<HTMLDivElement>) => void
  onPointerLeave?: (e: PointerEvent<HTMLDivElement>) => void
  onPointerCancel?: (e: PointerEvent<HTMLDivElement>) => void
}

export function AboutArtwork({
  image,
  className = '',
  onPointerMove,
  onPointerLeave,
  onPointerCancel,
}: AboutArtworkProps) {
  return (
    <div
      className={`about__artwork ${className}`}
      data-about-part={image.id}
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onPointerCancel={onPointerCancel}
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
