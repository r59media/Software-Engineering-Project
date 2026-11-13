import { useEffect, useState } from 'react'
import { fetchAboutData, type PublicProfileData } from '../../api/client'
import { aboutContent, aboutImages } from '../../config/about'

export interface AboutPortraitData {
  src: string
  alt: string
}

export interface UseAboutDataResult {
  portrait: AboutPortraitData | null
  paragraphs: string[]
  profile: PublicProfileData | null
  loading: boolean
  error: boolean
}

const FALLBACK_PORTRAIT: AboutPortraitData = (aboutContent as unknown as { portrait?: AboutPortraitData }).portrait || {
  src: aboutImages.portrait.imageUrl,
  alt: aboutImages.portrait.alt,
}

const FALLBACK_PARAGRAPHS: string[] = (aboutContent as unknown as { paragraphs?: string[] }).paragraphs ||
  (aboutContent.biography ? [aboutContent.biography] : [])

export function useAboutData(): UseAboutDataResult {
  const [portrait, setPortrait] = useState<AboutPortraitData | null>(FALLBACK_PORTRAIT)
  const [paragraphs, setParagraphs] = useState<string[]>(FALLBACK_PARAGRAPHS)
  const [profile, setProfile] = useState<PublicProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let controller: AbortController | null = null

    const load = () => {
      controller?.abort()
      const current = new AbortController()
      controller = current

      void fetchAboutData(current.signal)
        .then(data => {
          if (current.signal.aborted) return

          if (data.portraitError) {
            setPortrait(FALLBACK_PORTRAIT)
          } else {
            setPortrait(data.portrait)
          }

          if (data.profileError) {
            setParagraphs(FALLBACK_PARAGRAPHS)
          } else if (data.profile?.bio && typeof data.profile.bio === 'string' && data.profile.bio.trim()) {
            const bioParagraphs = data.profile.bio
              .split(/\r?\n\r?\n+/)
              .map(p => p.trim())
              .filter(Boolean)
            setParagraphs(bioParagraphs.length > 0 ? bioParagraphs : [])
          } else {
            setParagraphs([])
          }

          setProfile(data.profile)
          setError(Boolean(data.profileError))
          setLoading(false)
        })
        .catch(() => {
          if (!current.signal.aborted) {
            setPortrait(FALLBACK_PORTRAIT)
            setParagraphs(FALLBACK_PARAGRAPHS)
            setProfile(null)
            setError(true)
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

  return { portrait, paragraphs, profile, loading, error }
}

export function usePublicProfile(): { profile: PublicProfileData | null; loading: boolean; error: boolean } {
  const { profile, loading, error } = useAboutData()
  return { profile, loading, error }
}
