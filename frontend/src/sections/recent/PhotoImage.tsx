import { useState } from 'react'
import type { PhotoshootPhoto } from '../../types/recentPhotoshoot'

export function PhotoImage({ photo, eager = false }: { photo: PhotoshootPhoto; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="photo-unavailable" role="img" aria-label={photo.alt}>Photo unavailable</span>
  return <img src={photo.imageUrl} alt={photo.alt} width={photo.width} height={photo.height}
    style={{ objectPosition: photo.objectPosition ?? '50% 50%' }}
    loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} onError={() => setFailed(true)} />
}
