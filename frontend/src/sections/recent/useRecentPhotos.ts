import { useEffect, useState } from 'react'
import { fetchRecentPhotos } from '../../api/client'
import type { PhotoshootPhoto } from '../../types/recentPhotoshoot'

const signature = (photos: readonly PhotoshootPhoto[]) => photos.map(photo => `${photo.id}|${photo.imageUrl}|${photo.alt}`).join('\n')

/**
 * Live list of carousel photos from the admin-managed portfolio.
 * Re-checks whenever the visitor returns to the tab, so uploads or removals
 * made in the admin panel show up without a hard refresh.
 */
export function useRecentPhotos(fallbackPhotos: readonly PhotoshootPhoto[]): readonly PhotoshootPhoto[] {
  const [photos, setPhotos] = useState(fallbackPhotos)

  useEffect(() => {
    let controller: AbortController | null = null

    const load = () => {
      controller?.abort()
      const current = new AbortController()
      controller = current
      void fetchRecentPhotos(fallbackPhotos, current.signal)
        .then(next => {
          if (current.signal.aborted) return
          // Skip identical results so the carousel doesn't reset its animation for nothing
          setPhotos(previous => (signature(previous) === signature(next) ? previous : next))
        })
        .catch(() => {})
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load()
    }

    load()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      controller?.abort()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [fallbackPhotos])

  return photos
}
