import { useState } from 'react'
import type { PhotoshootPhoto } from '../../types/recentPhotoshoot'
import { useProtectedImage } from '../../hooks/useProtectedImage'

export function PhotoImage({ photo, eager = false }: { photo: PhotoshootPhoto; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  const protectedUrl = useProtectedImage(photo.imageUrl)

  if (failed) return <span className="photo-unavailable" role="img" aria-label={photo.alt}>Photo unavailable</span>

  return (
    <div className="photo-shield-container">
      <div className="photo-shield" aria-hidden="true" />
      <img
        src={protectedUrl}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        style={{ objectPosition: photo.objectPosition ?? '50% 50%' }}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
      />
    </div>
  )
}
