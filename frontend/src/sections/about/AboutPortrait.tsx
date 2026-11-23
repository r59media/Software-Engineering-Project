import type { PointerEvent } from 'react'
import { aboutImages } from '../../config/about'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import { AboutArtwork } from './AboutArtwork'

export interface AboutPortraitProps {
  portrait?: {
    src: string
    alt: string
  }
}

const defaultPortrait = {
  src: aboutImages.portrait.imageUrl,
  alt: aboutImages.portrait.alt,
}

export function AboutPortrait({ portrait = defaultPortrait }: AboutPortraitProps) {
  const activePortrait = portrait?.src ? portrait : defaultPortrait

  const handleCardPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (
      e.pointerType !== 'mouse' ||
      !window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches
    ) {
      return
    }

    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return

    // Normalized mouse position inside this specific card/element (-1 to 1)
    const normX = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1))
    const normY = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1))
    const part = el.getAttribute('data-about-part')

    let rot = normX * 3.5
    if (part === 'yellow-card') {
      rot = normX * 3.8 + normY * 1.5
    } else if (part === 'red-card') {
      rot = normX * 3.8 - normY * 1.5
    } else if (part === 'portrait-group') {
      rot = normX * 2.8 + normY * 1.2
    }

    const tx = normX * 4
    const ty = normY * 3

    el.style.setProperty('--local-rot', `${rot.toFixed(2)}deg`)
    el.style.setProperty('--local-tx', `${tx.toFixed(1)}px`)
    el.style.setProperty('--local-ty', `${ty.toFixed(1)}px`)
  }

  const handleCardPointerLeave = (e: PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    el.style.removeProperty('--local-rot')
    el.style.removeProperty('--local-tx')
    el.style.removeProperty('--local-ty')
  }

  return (
    <div className="about__collage" data-about-part="portrait-collage">
      <AboutArtwork
        image={aboutImages.yellowCard}
        onPointerMove={handleCardPointerMove}
        onPointerLeave={handleCardPointerLeave}
        onPointerCancel={handleCardPointerLeave}
      />
      <AboutArtwork
        image={aboutImages.redCard}
        onPointerMove={handleCardPointerMove}
        onPointerLeave={handleCardPointerLeave}
        onPointerCancel={handleCardPointerLeave}
      />
      <div
        className="about__portrait"
        data-about-part="portrait-group"
        onPointerMove={handleCardPointerMove}
        onPointerLeave={handleCardPointerLeave}
        onPointerCancel={handleCardPointerLeave}
      >
        <div className="about__motion" data-about-motion="portrait-group">
          <div className="about__portrait-pose">
            <div className="about__artwork" data-about-part="portrait">
              <div className="about__motion" data-about-motion="portrait">
                <ProtectedCanvasImage
                  src={activePortrait.src}
                  alt={activePortrait.alt}
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
