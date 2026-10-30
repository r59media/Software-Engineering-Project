import { useState, type CSSProperties } from 'react'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import type { FooterSlide } from '../../types/footer'

export function FooterBackground({ slide }: { slide?: FooterSlide }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  return (
    <div
      className="site-footer__background"
      data-footer-part="background"
      data-footer-slide-id={slide?.id}
      data-embedded-overlay={slide?.hasEmbeddedOverlay === true}
      aria-hidden="true"
    >
      {slide && failedUrl !== slide.imageUrl && (
        <ProtectedCanvasImage
          src={slide.imageUrl}
          alt=""
          className="site-footer__image"
          onError={() => setFailedUrl(slide.imageUrl)}
          style={{
            '--footer-image-position': slide.objectPosition ?? '50% 50%',
            '--footer-image-position-mobile': slide.mobileObjectPosition ?? slide.objectPosition ?? '50% 50%',
          } as CSSProperties}
        />
      )}
    </div>
  )
}
