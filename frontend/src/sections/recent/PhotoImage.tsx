import { useState } from 'react'
import type { PhotoshootPhoto } from '../../types/recentPhotoshoot'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'

export function PhotoImage({ photo, eager = false }: { photo: PhotoshootPhoto; eager?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = failedUrl === photo.imageUrl

  if (failed) return <span className="photo-unavailable" role="img" aria-label={photo.alt}>Photo unavailable</span>

  return (
    <ProtectedCanvasImage
      src={photo.imageUrl}
      alt={photo.alt}
      className="recent__photo-canvas"
      objectPosition={photo.objectPosition ?? '50% 50%'}
      width={photo.width}
      height={photo.height}
      eager={eager}
      onError={() => setFailedUrl(photo.imageUrl)}
    />
  )
}
