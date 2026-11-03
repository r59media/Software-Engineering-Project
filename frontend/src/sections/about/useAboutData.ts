import { useEffect, useState } from 'react'
import { fetchAboutData, type PublicProfileData } from '../../api/client'
import { aboutContent, aboutImages } from '../../config/about'

export interface AboutPortraitData {
  src: string
  alt: string
}

export interface UseAboutDataResult {
  portrait: AboutPortraitData
  paragraphs: string[]
  profile: PublicProfileData | null
  loading: boolean
}

const FALLBACK_PORTRAIT: AboutPortraitData = (aboutContent as unknown as { portrait?: AboutPortraitData }).portrait || {
  src: aboutImages.portrait.imageUrl,
  alt: aboutImages.portrait.alt,
}

const FALLBACK_PARAGRAPHS: string[] = (aboutContent as unknown as { paragraphs?: string[] }).paragraphs ||
  (aboutContent.biography ? [aboutContent.biography] : [])

export function useAboutData(): UseAboutDataResult {
  const [portrait, setPortrait] = useState<AboutPortraitData>(FALLBACK_PORTRAIT)
  const [paragraphs, setParagraphs] = useState<string[]>(FALLBACK_PARAGRAPHS)
  const [profile, setProfile] = useState<PublicProfileData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let controller: AbortController | null = null

    const load = () => {
      controller?.abort()
      const current = new AbortController()
      controller = current

      void fetchAboutData(current.signal)
        .then(data => {
          if (current.signal.aborted) return

          if (data.portrait?.src) {
            setPortrait(data.portrait)
          } else {
            setPortrait(FALLBACK_PORTRAIT)
          }

          if (data.profile?.bio && typeof data.profile.bio === 'string' && data.profile.bio.trim()) {
            const bioParagraphs = data.profile.bio
              .split(/\r?\n\r?\n+/)
              .map(p => p.trim())
              .filter(Boolean)
            setParagraphs(bioParagraphs.length > 0 ? bioParagraphs : FALLBACK_PARAGRAPHS)
          } else {
            setParagraphs(FALLBACK_PARAGRAPHS)
          }

          setProfile(data.profile)
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

  return { portrait, paragraphs, profile, loading }
}

export function usePublicProfile(): { profile: PublicProfileData | null; loading: boolean } {
  const { profile, loading } = useAboutData()
  return { profile, loading }
}
