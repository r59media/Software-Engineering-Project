import { useMemo, useState } from 'react'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import { PhotoLightbox } from '../recent/PhotoLightbox'
import { useGalleryPhotos } from './useGalleryPhotos'

declare module '../../components/ProtectedCanvasImage' {
  interface ProtectedCanvasImageProps {
    loading?: 'lazy' | 'eager' | string
    decoding?: 'async' | 'sync' | 'auto' | string
  }
}

// Filters shown in the design; they match the categories the admin can assign
const STANDARD_CATEGORIES = ['Portrait', 'Lifestyle', 'Events', 'Extras']

export function PortfolioGallery() {
  const { photos, loading } = useGalleryPhotos()
  const [activeCategory, setActiveCategory] = useState('All')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

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

  return (
    <section id="portfolio" className="portfolio-gallery" aria-labelledby="portfolio-heading">
      <div className="portfolio-gallery__inner">
        <header className="portfolio-gallery__header">
          <p className="portfolio-gallery__eyebrow">
            <span aria-hidden="true" />Portfolio
          </p>
          <h2 id="portfolio-heading" className="portfolio-gallery__title">
            Work Speaks for Itself
          </h2>
          {(
            <div className="portfolio-gallery__filters" role="tablist" aria-label="Filter gallery by category">
              {categories.map(category => (
                <button
                  key={category}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === category}
                  data-active={activeCategory === category ? 'true' : 'false'}
                  className="portfolio-gallery__filter-btn"
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          )}
        </header>

        {loading && photos.length === 0 ? (
          <div className="portfolio-gallery__loading" role="status">
            <span>Loading gallery...</span>
          </div>
        ) : filteredPhotos.length === 0 ? (
          <div className="portfolio-gallery__empty" role="status">
            <p>No photographs found in this category.</p>
          </div>
        ) : (
          <div className="portfolio-gallery__grid">
            {filteredPhotos.map((photo, index) => (
              <button
                key={photo.id || index}
                type="button"
                className="portfolio-gallery__card"
                onClick={() => setSelectedIndex(index)}
                aria-label={`Open ${photo.title || photo.alt} in full screen view`}
              >
                <ProtectedCanvasImage
                  src={photo.src}
                  alt={photo.alt}
                  className="portfolio-gallery__image"
                  loading="lazy"
                  decoding="async"
                />
                <div className="portfolio-gallery__meta" aria-hidden="true">
                  <span className="portfolio-gallery__badge">{photo.category}</span>
                </div>
              </button>
            ))}
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
  )
}
