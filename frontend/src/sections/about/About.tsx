import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react'
import { aboutContent, aboutImages } from '../../config/about'
import type { AboutContent } from '../../types/about'
import { AboutArtwork } from './AboutArtwork'
import { AboutDecorations } from './AboutDecorations'
import { AboutPortrait } from './AboutPortrait'
import { AboutLens } from './AboutLens'
import { useAboutData } from './useAboutData'
import './About.css'

const STACKED_ABOUT_QUERY = '(max-width: 1000px)'

function useIsStackedAbout(): boolean {
  const [stacked, setStacked] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(STACKED_ABOUT_QUERY).matches : false,
  )

  useEffect(() => {
    const query = window.matchMedia(STACKED_ABOUT_QUERY)
    const update = () => setStacked(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return stacked
}

export function About({ content = aboutContent }: { content?: AboutContent }) {
  const { portrait, paragraphs, profile } = useAboutData()
  const titleGroupRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const isStacked = useIsStackedAbout()

  const { scrollYProgress } = useScroll({
    target: titleGroupRef,
    offset: isStacked ? ['start 0.92', 'start 0.56'] : ['start 0.9', 'start 0.48'],
  })
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 170,
    damping: 26,
    mass: 0.32,
  })
  const titleX = useTransform(
    smoothProgress,
    [0, 1],
    [isStacked ? '-105vw' : '65vw', '0vw'],
    { clamp: true },
  )

  const location = typeof profile?.location === 'string' ? profile.location.trim() : ''
  const travel = typeof profile?.travel === 'string' ? profile.travel.trim() : profile?.travel ? 'Available for travel' : ''
  const studioNote = [location ? `Based in ${location}` : '', travel].filter(Boolean).join(' · ')

  return (
    <section id="about" className="about" aria-labelledby="about-heading">
      <AboutArtwork image={aboutImages.paper} className="about__paper" />
      <AboutDecorations />
      <div className="about__layout">
        {portrait ? <AboutPortrait portrait={portrait} /> : <div className="about__collage" data-about-part="portrait-collage" aria-hidden="true" />}
        <div className="about__content">
          <motion.div
            ref={titleGroupRef}
            className="about__title-group"
            style={prefersReducedMotion ? undefined : { x: titleX }}
          >
            <p className="about__eyebrow" data-about-part="eyebrow">
              <span aria-hidden="true" />
              {content.eyebrow}
            </p>
            <h2 id="about-heading" className="about__heading">
              <span data-about-part="heading">{content.heading}</span>
              <span className="about__subheading" data-about-part="subheading">
                {content.subheading}
              </span>
            </h2>
          </motion.div>
          <div className="about__biography" data-about-part="biography">
            {paragraphs.map((paragraph, index) => (
              <p key={index} className="about__paragraph">
                {paragraph}
              </p>
            ))}
          </div>
          {studioNote ? (
            <p className="about__paragraph about__travel" style={{ fontStyle: 'italic', marginTop: '1rem' }}>
              {studioNote}
            </p>
          ) : null}
          <AboutLens />
        </div>
      </div>
    </section>
  )
}
