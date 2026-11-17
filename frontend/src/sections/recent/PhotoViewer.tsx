import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { PhotoshootPhoto } from '../../types/recentPhotoshoot'
import arrowLeft from '../../assets/mrphshImages/photo-arrow-left.svg'
import arrowRight from '../../assets/mrphshImages/photo-arrow-right.svg'
import { ProtectedCanvasImage, preloadProtectedImage } from '../../components/ProtectedCanvasImage'

interface PhotoViewerProps {
  photo: PhotoshootPhoto
  photos?: readonly PhotoshootPhoto[]
  position: number
  total: number
  onStep: (direction: -1 | 1) => void
  onClose: () => void
}

export function PhotoViewer({ photo, photos, position, total, onStep, onClose }: PhotoViewerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (photo.imageUrl) {
      void preloadProtectedImage(photo.imageUrl)
    }
    if (!photos?.length) return
    const indices = new Set([
      position,
      (position + 1) % photos.length,
      (position - 1 + photos.length) % photos.length,
    ])
    for (const idx of indices) {
      const url = photos[idx]?.imageUrl
      if (url) void preloadProtectedImage(url)
    }
  }, [photo.imageUrl, photos, position])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    return () => {
      dialog.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(<dialog ref={dialogRef} className="photo-viewer" aria-label="Photoshoot photo viewer"
    data-recent-part="viewer" onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}
    onKeyDown={event => {
      if (event.key === 'Tab') {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        return
      }
      if (total < 2) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        onStep(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }}>
    <button type="button" className="photo-viewer__close" aria-label="Close photo viewer" onClick={onClose}>×</button>
    <div className="photo-viewer__image" data-recent-part="viewer-image" data-photo-id={photo.id}>
      <ProtectedCanvasImage
        key={photo.id}
        src={photo.imageUrl}
        alt={photo.alt}
        className="photo-viewer__canvas"
        width={photo.width}
        height={photo.height}
        eager
      />
    </div>
    {total > 1 && <>
      <button type="button" className="photo-viewer__previous" aria-label="Previous photo" onClick={() => onStep(-1)}><img src={arrowLeft} alt="" /></button>
      <button type="button" className="photo-viewer__next" aria-label="Next photo" onClick={() => onStep(1)}><img src={arrowRight} alt="" /></button>
    </>}
    <p className="photo-viewer__count" role="status" aria-live="polite">{position + 1} / {total}</p>
  </dialog>, document.body)
}
