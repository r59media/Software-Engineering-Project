import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import arrowLeft from '../../assets/mrphshImages/photo-arrow-left.svg'
import arrowRight from '../../assets/mrphshImages/photo-arrow-right.svg'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'

export interface LightboxPhoto {
  id: string
  src: string
  alt: string
  title?: string
  category?: string
  width?: number
  height?: number
  imageUrl?: string
}

export interface PhotoLightboxProps {
  photos: readonly LightboxPhoto[]
  selectedIndex: number | null
  onClose: () => void
  onSelect: (index: number) => void
}

export function PhotoLightbox({ photos, selectedIndex, onClose, onSelect }: PhotoLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  const isOpen = selectedIndex !== null && selectedIndex >= 0 && selectedIndex < photos.length
  const photo = isOpen ? photos[selectedIndex] : null

  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    if (!dialog) return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const scrollY = window.scrollY
    const body = document.body
    const previous = {
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
      overflow: body.style.overflow,
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'

    if (!dialog.open) {
      dialog.showModal()
    }

    return () => {
      dialog.close()
      Object.assign(body.style, previous)
      window.scrollTo(0, scrollY)
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [isOpen])

  if (!isOpen || !photo) return null

  const total = photos.length
  const position = selectedIndex

  return createPortal(
    <dialog
      ref={dialogRef}
      className="photo-viewer photo-lightbox"
      aria-label="Portfolio photo viewer"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Tab') {
          const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
          const first = buttons[0]
          const last = buttons[buttons.length - 1]
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
          return
        }
        if (total < 2) return
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onSelect((position - 1 + total) % total)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          onSelect((position + 1) % total)
        }
      }}
    >
      <button
        type="button"
        className="photo-viewer__close"
        aria-label="Close photo viewer"
        onClick={onClose}
      >
        ×
      </button>

      <div className="photo-viewer__image" data-photo-id={photo.id}>
        <ProtectedCanvasImage
          key={photo.id || photo.src}
          src={photo.src || photo.imageUrl || ''}
          alt={photo.alt}
          className="photo-viewer__canvas"
          width={photo.width}
          height={photo.height}
          eager
        />
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            className="photo-viewer__previous"
            aria-label="Previous photo"
            onClick={() => onSelect((position - 1 + total) % total)}
          >
            <img src={arrowLeft} alt="" />
          </button>
          <button
            type="button"
            className="photo-viewer__next"
            aria-label="Next photo"
            onClick={() => onSelect((position + 1) % total)}
          >
            <img src={arrowRight} alt="" />
          </button>
        </>
      )}

      <div className="photo-lightbox__caption">
        {photo.category && (
          <span className="photo-lightbox__category">{photo.category}</span>
        )}
        <span className="photo-lightbox__count" role="status" aria-live="polite">
          {position + 1} / {total}
        </span>
      </div>
    </dialog>,
    document.body
  )
}
