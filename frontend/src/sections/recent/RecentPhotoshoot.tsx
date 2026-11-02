import { useState } from 'react'
import type { PhotoshootPhoto } from '../../types/recentPhotoshoot'
import { recentInitialPhotoId, recentPhotos } from '../../config/recentPhotoshoot'
import { PhotoImage } from './PhotoImage'
import { PhotoViewer } from './PhotoViewer'
import { useRecentPhotos } from './useRecentPhotos'
import './RecentPhotoshoot.css'

interface RecentPhotoshootProps {
  photos?: readonly PhotoshootPhoto[]
  initialPhotoId?: string
}

export function RecentPhotoshoot({ photos: photosOverride, initialPhotoId = recentInitialPhotoId }: RecentPhotoshootProps) {
  // Explicit photos (e.g. tests, previews) win; otherwise show what the admin panel manages
  const livePhotos = useRecentPhotos(recentPhotos)
  const photos = photosOverride ?? livePhotos
  const [activePhotoId, setActivePhotoId] = useState(initialPhotoId)
  const [viewerOpen, setViewerOpen] = useState(false)
  const items = photos.filter((photo, index) => photo.imageUrl.trim() && photos.findIndex(item => item.id === photo.id) === index)
  const activeIndex = Math.max(0, items.findIndex(photo => photo.id === activePhotoId))
  const activePhoto = items[activeIndex]
  const offsets = items.length >= 5 ? [-2, -1, 0, 1, 2] : items.length === 4 ? [-1, 0, 1, 2] : items.length === 3 ? [-1, 0, 1] : items.length === 2 ? [0, 1] : items.length === 1 ? [0] : []
  const step = (direction: -1 | 1) => {
    if (items.length > 1) setActivePhotoId(items[(activeIndex + direction + items.length) % items.length].id)
  }

  return <section id="recent-photoshoot" className="recent" aria-labelledby="recent-heading"
    data-active-photo-id={activePhoto?.id} data-viewer-open={viewerOpen && !!activePhoto}>
    <div className="recent__glow" aria-hidden="true" />
    <div className="recent__composition" data-recent-part="composition">
      <div className="recent__stage" data-recent-part="carousel" role="group" aria-label="Recent photos">
        {offsets.map(offset => {
          const photo = items[(activeIndex + offset + items.length) % items.length]
          return <div className="recent__slot" data-recent-slot={offset} data-photo-id={photo.id} key={offset}>
            <div className="recent__motion" data-recent-motion={photo.id}>
              <button type="button" className="recent__photo" aria-label={`Open photo: ${photo.alt}`}
                onClick={() => { setActivePhotoId(photo.id); setViewerOpen(true) }}>
                <PhotoImage key={`${photo.id}:${photo.imageUrl}`} photo={photo} eager />
              </button>
            </div>
          </div>
        })}
        {!activePhoto && <p className="recent__empty">New photos coming soon.</p>}
      </div>
      {activePhoto && <div className="recent__controls" data-recent-part="controls" role="group" aria-label="Photo controls">
        {items.length > 1 && <button type="button" aria-label="Previous carousel photo" onClick={() => step(-1)}><span className="recent__dot" /></button>}
        <button type="button" aria-label="Open current photo" onClick={() => setViewerOpen(true)}><span className="recent__dot recent__dot--current" /></button>
        {items.length > 1 && <button type="button" aria-label="Next carousel photo" onClick={() => step(1)}><span className="recent__dot" /></button>}
        <span className="recent__sr-only" role="status">Photo {activeIndex + 1} of {items.length}</span>
      </div>}
      <h2 id="recent-heading" className="recent__heading" data-recent-part="heading"><span>MOST RECENT</span><strong>PHOTOSHOOT</strong></h2>
    </div>
    {viewerOpen && activePhoto && <PhotoViewer photo={activePhoto} position={activeIndex} total={items.length} onStep={step} onClose={() => setViewerOpen(false)} />}
  </section>
}
