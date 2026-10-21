import type { AboutImage } from '../../types/about'

export function AboutArtwork({ image, className = '' }: { image: AboutImage; className?: string }) {
  return <div className={`about__artwork ${className}`} data-about-part={image.id}>
    <div className="about__motion" data-about-motion={image.id}>
      <img className="about__art" src={image.imageUrl} alt={image.alt}
        width={image.width} height={image.height} loading="lazy" decoding="async" draggable={false} />
    </div>
  </div>
}
