import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import { GalleryEmptyState } from './GalleryEmptyState'
import type { GalleryPhoto } from '../../api/client'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import { PhotoLightbox } from '../recent/PhotoLightbox'
import { PortfolioInterlude } from './PortfolioInterlude'
import { PortfolioParticleTitle } from './PortfolioParticleTitle'
import { useGalleryPhotos } from './useGalleryPhotos'

declare module '../../components/ProtectedCanvasImage' {
  interface ProtectedCanvasImageProps {
    loading?: 'lazy' | 'eager' | string
    decoding?: 'async' | 'sync' | 'auto' | string
  }
}

// Filters shown in the design; they match the categories the admin can assign
const STANDARD_CATEGORIES = ['Portrait', 'Lifestyle', 'Events', 'Extras']
const tabId = (category: string) => `portfolio-tab-${category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

function getGridColumns(): number {
  if (typeof window === 'undefined') return 4
  if (window.matchMedia('(max-width: 700px)').matches) return 2
  if (window.matchMedia('(max-width: 1000px)').matches) return 3
  return 4
}

function useGridColumns(): number {
  const [columns, setColumns] = useState(getGridColumns)

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 700px)')
    const tabletQuery = window.matchMedia('(max-width: 1000px)')
    const update = () => setColumns(getGridColumns())

    mobileQuery.addEventListener('change', update)
    tabletQuery.addEventListener('change', update)
    return () => {
      mobileQuery.removeEventListener('change', update)
      tabletQuery.removeEventListener('change', update)
    }
  }, [])

  return columns
}

interface PortfolioFilterTabProps {
  category: string
  index: number
  total: number
  active: boolean
  scrollProgress: MotionValue<number>
  reducedMotion: boolean
  onSelect: (category: string) => void
  onPreload: (category: string) => void
}

/** Category filter pill with scroll-driven sequential stagger matching card reveals. */
function PortfolioFilterTab({
  category,
  index,
  total,
  active,
  scrollProgress,
  reducedMotion,
  onSelect,
  onPreload,
}: PortfolioFilterTabProps) {
  const span = Math.max(0.28, 0.48 - Math.max(0, total - 5) * 0.03)
  const step = total > 1 ? (0.96 - span) / (total - 1) : 0
  const start = index * step
  const end = Math.min(1, start + span)

  const opacity = useTransform(scrollProgress, [start, end], [0, 1], { clamp: true })
  const y = useTransform(scrollProgress, [start, end], [24, 0], { clamp: true })

  return (
    <motion.button
      id={tabId(category)}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls="portfolio-tabpanel"
      data-active={active ? 'true' : 'false'}
      className="portfolio-gallery__filter-btn"
      style={reducedMotion ? undefined : { opacity, y }}
      onClick={() => onSelect(category)}
      onMouseEnter={() => onPreload(category)}
      onFocus={() => onPreload(category)}
    >
      {category}
    </motion.button>
  )
}

interface PortfolioCardSlotProps {
  photo: GalleryPhoto
  index: number
  columns: number
  showBadge: boolean
  onSelect: () => void
}

function PortfolioCardSlot({ photo, index, columns, showBadge, onSelect }: PortfolioCardSlotProps) {
  const slotRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: slotRef,
    offset: ['start 0.98', 'start 0.56'],
  })
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 240,
    damping: 30,
    mass: 0.28,
  })

  const col = columns > 0 ? index % columns : 0
  const span = columns === 2 ? 0.62 : columns === 3 ? 0.52 : 0.48
  const step = columns > 1 ? (0.9 - span) / (columns - 1) : 0
  const start = col * step
  const end = start + span

  const opacity = useTransform(smoothProgress, [start, end], [0, 1], { clamp: true })
  const y = useTransform(smoothProgress, [start, end], [54, 0], { clamp: true })

  return (
    <div ref={slotRef} className="portfolio-gallery__slot">
      <motion.button
        type="button"
        className="portfolio-gallery__card"
        style={prefersReducedMotion ? undefined : { opacity, y }}
        onClick={onSelect}
        aria-label={`Open ${photo.title || photo.alt} in full screen view`}
      >
        <ProtectedCanvasImage
          src={photo.src}
          alt={photo.alt}
          className="portfolio-gallery__image"
          loading="lazy"
          decoding="async"
          eager={false}
        />
        {showBadge && (
          <div className="portfolio-gallery__meta" aria-hidden="true">
            <span className="portfolio-gallery__badge">{photo.category}</span>
          </div>
        )}
      </motion.button>
    </div>
  )
}

export function PortfolioGallery() {
  const { photos, loading } = useGalleryPhotos()
  const columns = useGridColumns()
  const sectionRef = useRef<HTMLElement | null>(null)
  const filtersRef = useRef<HTMLDivElement>(null)
  const prefersReducedMotion = useReducedMotion()
  const [inView, setInView] = useState(false)
  const [activeCategory, setActiveCategory] = useState('All')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [hasVisitedEmpty, setHasVisitedEmpty] = useState(false)

  const { scrollYProgress: filtersProgress } = useScroll({
    target: filtersRef,
    offset: ['start 0.95', 'start 0.56'],
  })
  const smoothFiltersProgress = useSpring(filtersProgress, {
    stiffness: 220,
    damping: 28,
    mass: 0.28,
  })

  useEffect(() => {
    const node = sectionRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const categories = useMemo(() => {
    const found = new Set<string>(STANDARD_CATEGORIES)
    photos.forEach(p => {
      if (p.category && p.category.trim() && p.category.toLowerCase() !== 'all') {
        found.add(p.category.trim())
      }
    })

    const sorted = Array.from(found).sort((a, b) => {
      const idxA = STANDARD_CATEGORIES.indexOf(a)
      const idxB = STANDARD_CATEGORIES.indexOf(b)
      if (idxA !== -1 && idxB !== -1) return idxA - idxB
      if (idxA !== -1) return -1
      if (idxB !== -1) return 1
      return a.localeCompare(b)
    })

    return ['All', ...sorted]
  }, [photos])

  const filteredPhotos = useMemo(() => {
    if (activeCategory === 'All') return photos
    return photos.filter(p => p.category.toLowerCase() === activeCategory.toLowerCase())
  }, [photos, activeCategory])

  useEffect(() => {
    if (inView && !loading && filteredPhotos.length === 0) {
      void import('./MemoryCardScene')
    }
  }, [inView, loading, filteredPhotos.length])

  const preloadMemoryCardIfEmpty = (category: string) => {
    if (!inView || (loading && photos.length === 0)) return
    const count =
      category === 'All'
        ? photos.length
        : photos.filter(p => p.category.toLowerCase() === category.toLowerCase()).length
    if (count === 0) {
      void import('./MemoryCardScene')
    }
  }

  const isEmpty = !(loading && photos.length === 0) && filteredPhotos.length === 0

  if (inView && isEmpty && !hasVisitedEmpty) {
    setHasVisitedEmpty(true)
  }

  return (
    <>
      <section ref={sectionRef} id="portfolio" className="portfolio-gallery" aria-labelledby="portfolio-heading">
      <div className="portfolio-gallery__inner">
        <header className="portfolio-gallery__header">
          <p className="portfolio-gallery__eyebrow">
            <span aria-hidden="true" />Portfolio
          </p>
          <PortfolioParticleTitle
            id="portfolio-heading"
            text="Work Speaks for Itself"
            className="portfolio-gallery__title"
          />
          {(
            <div ref={filtersRef} className="portfolio-gallery__filters" role="tablist" aria-label="Filter gallery by category">
              {categories.map((category, index) => (
                <PortfolioFilterTab
                  key={category}
                  category={category}
                  index={index}
                  total={categories.length}
                  active={activeCategory === category}
                  scrollProgress={smoothFiltersProgress}
                  reducedMotion={Boolean(prefersReducedMotion)}
                  onSelect={setActiveCategory}
                  onPreload={preloadMemoryCardIfEmpty}
                />
              ))}
            </div>
          )}
        </header>

        {loading && photos.length === 0 ? (
          <div className="portfolio-gallery__loading" role="status">
            <span>Loading gallery...</span>
          </div>
        ) : !isEmpty ? (
          <div
            id="portfolio-tabpanel"
            role="tabpanel"
            aria-labelledby={tabId(activeCategory)}
            className="portfolio-gallery__grid"
          >
            {filteredPhotos.map((photo, index) => (
              <PortfolioCardSlot
                key={`${activeCategory}-${photo.id || index}`}
                photo={photo}
                index={index}
                columns={columns}
                showBadge={activeCategory.toLowerCase() === 'all'}
                onSelect={() => setSelectedIndex(index)}
              />
            ))}
          </div>
        ) : null}

        {inView && (hasVisitedEmpty || isEmpty) && (
          <div
            id={isEmpty ? 'portfolio-tabpanel' : undefined}
            role={isEmpty ? 'tabpanel' : undefined}
            aria-labelledby={isEmpty ? tabId(activeCategory) : undefined}
            hidden={!isEmpty}
          >
            <GalleryEmptyState active={isEmpty} />
          </div>
        )}

        {selectedIndex !== null && (
          <PhotoLightbox
            photos={filteredPhotos}
            selectedIndex={selectedIndex}
            onClose={() => setSelectedIndex(null)}
            onSelect={setSelectedIndex}
          />
        )}
      </div>
    </section>
    <PortfolioInterlude />
    </>
  )
}
