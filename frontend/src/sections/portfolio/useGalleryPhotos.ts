import { useEffect, useState } from 'react'
import { fetchGalleryPhotos, type GalleryPhoto } from '../../api/client'
import { recentPhotos } from '../../config/recentPhotoshoot'

const signature = (photos: readonly GalleryPhoto[]) =>
  photos.map(p => `${p.id}|${p.src}|${p.category}|${p.title || ''}|${p.alt}`).join('\n')

export function useGalleryPhotos(): { photos: GalleryPhoto[]; loading: boolean } {
  const [photos, setPhotos] = useState<GalleryPhoto[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let controller: AbortController | null = null

    const load = () => {
      controller?.abort()
      const current = new AbortController()
      controller = current

      void fetchGalleryPhotos(recentPhotos, current.signal)
        .then(next => {
          if (current.signal.aborted) return
          setPhotos(prev => (signature(prev) === signature(next) ? prev : next))
          setLoading(false)
        })
        .catch(() => {
          if (!current.signal.aborted) {
            setLoading(false)
          }
        })
    }

    const onRevalidate = () => {
      if (document.visibilityState === 'visible') load()
    }

    load()
    window.addEventListener('focus', onRevalidate)
    document.addEventListener('visibilitychange', onRevalidate)
    return () => {
      controller?.abort()
      window.removeEventListener('focus', onRevalidate)
      document.removeEventListener('visibilitychange', onRevalidate)
    }
  }, [])

  return { photos, loading }
}
