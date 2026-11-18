import { useEffect, useState } from 'react'
import { fetchAboutData, type AboutData, type PublicProfileData } from '../../api/client'
import { aboutContent, aboutImages } from '../../config/about'

const ABOUT_CACHE_TTL_MS = 60_000
let cachedAboutData: AboutData | null = null
let cachedAboutTimestamp = 0
let inFlightAboutPromise: Promise<AboutData> | null = null

function invalidateAboutCache(): void {
  cachedAboutData = null
  cachedAboutTimestamp = 0
  inFlightAboutPromise = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('portfolio-updated', invalidateAboutCache)
}

function getSharedAboutData(forceRefresh = false): Promise<AboutData> {
  if (!forceRefresh && cachedAboutData && Date.now() - cachedAboutTimestamp < ABOUT_CACHE_TTL_MS) {
    return Promise.resolve(cachedAboutData)
  }
  if (!forceRefresh && inFlightAboutPromise) {
    return inFlightAboutPromise
  }

  const request = fetchAboutData()
    .then(data => {
      if (!data.portraitError && !data.profileError) {
        cachedAboutData = data
        cachedAboutTimestamp = Date.now()
      }
      return data
    })
    .finally(() => {
      if (inFlightAboutPromise === request) {
        inFlightAboutPromise = null
      }
    })

  inFlightAboutPromise = request
  return request
}

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
    let active = true

    const load = (forceRefresh = false) => {
      void getSharedAboutData(forceRefresh)
        .then(data => {
          if (!active) return

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
          if (active) {
            setPortrait(FALLBACK_PORTRAIT)
            setParagraphs(FALLBACK_PARAGRAPHS)
            setProfile(null)
            setError(true)
            setLoading(false)
          }
        })
    }

    const onRevalidate = () => {
      if (document.visibilityState === 'visible') load(false)
    }

    const onPortfolioUpdated = () => {
      invalidateAboutCache()
      load(true)
    }

    load(false)
    window.addEventListener('focus', onRevalidate)
    document.addEventListener('visibilitychange', onRevalidate)
    window.addEventListener('portfolio-updated', onPortfolioUpdated)
    return () => {
      active = false
      window.removeEventListener('focus', onRevalidate)
      document.removeEventListener('visibilitychange', onRevalidate)
      window.removeEventListener('portfolio-updated', onPortfolioUpdated)
    }
  }, [])

  return { portrait, paragraphs, profile, loading, error }
}

export function usePublicProfile(): { profile: PublicProfileData | null; loading: boolean; error: boolean } {
  const { profile, loading, error } = useAboutData()
  return { profile, loading, error }
}
