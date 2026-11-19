import { useEffect, useState } from 'react'
import {
  fetchPortfolioSection,
  resolveMediaUrl,
  type PortfolioApiItem,
  type PublicProfileData,
} from '../../api/client'
import { aboutContent, aboutImages } from '../../config/about'
import { usePublicProfile } from '../../hooks/usePublicProfile'

export { usePublicProfile } from '../../hooks/usePublicProfile'

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

const ABOUT_PORTRAIT_CACHE_TTL_MS = 60_000

interface AboutPortraitResult {
  portrait: AboutPortraitData | null
  error: boolean
}

let cachedPortrait: AboutPortraitData | null = null
let hasCachedPortrait = false
let cachedPortraitTimestamp = 0
let inFlightPortraitPromise: Promise<AboutPortraitResult> | null = null

function hasFreshPortraitCache(): boolean {
  return hasCachedPortrait && Date.now() - cachedPortraitTimestamp < ABOUT_PORTRAIT_CACHE_TTL_MS
}

function invalidateAboutPortraitCache(): void {
  cachedPortrait = null
  hasCachedPortrait = false
  cachedPortraitTimestamp = 0
  inFlightPortraitPromise = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('portfolio-updated', invalidateAboutPortraitCache)
}

function resolveAboutPortraitItem(item: PortfolioApiItem): AboutPortraitData | null {
  const rawUrl = item.url || item.public_url || (item.media_key ? resolveMediaUrl(item.media_key) : '')
  const src = rawUrl.startsWith('https://') || rawUrl.startsWith('/') ? rawUrl : ''
  if (!src) return null
  return {
    src,
    alt: item.alt_text?.trim() || item.title?.trim() || 'Portrait of the photographer',
  }
}

function getSharedAboutPortrait(forceRefresh = false): Promise<AboutPortraitResult> {
  if (!forceRefresh && hasFreshPortraitCache()) {
    return Promise.resolve({ portrait: cachedPortrait, error: false })
  }
  if (!forceRefresh && inFlightPortraitPromise) {
    return inFlightPortraitPromise
  }

  const request = fetchPortfolioSection('about')
    .then((items): AboutPortraitResult => {
      if (items === null) {
        return { portrait: null, error: true }
      }
      if (items.length === 0) {
        return { portrait: null, error: false }
      }
      const active = items.find((item) => item.is_active !== 0) || items[0]
      return { portrait: resolveAboutPortraitItem(active), error: false }
    })
    .then((result) => {
      if (!result.error) {
        cachedPortrait = result.portrait
        hasCachedPortrait = true
        cachedPortraitTimestamp = Date.now()
      }
      return result
    })
    .catch((): AboutPortraitResult => ({ portrait: null, error: true }))
    .finally(() => {
      if (inFlightPortraitPromise === request) {
        inFlightPortraitPromise = null
      }
    })

  inFlightPortraitPromise = request
  return request
}

function deriveParagraphs(
  profile: PublicProfileData | null,
  profileLoading: boolean,
  profileError: boolean,
): string[] {
  if (profileLoading && !profile && !profileError) {
    return FALLBACK_PARAGRAPHS
  }
  if (profileError) {
    return FALLBACK_PARAGRAPHS
  }
  if (profile?.bio && typeof profile.bio === 'string' && profile.bio.trim()) {
    const bioParagraphs = profile.bio
      .split(/\r?\n\r?\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
    return bioParagraphs.length > 0 ? bioParagraphs : []
  }
  return []
}

export function useAboutData(): UseAboutDataResult {
  const { profile, loading: profileLoading, error: profileError } = usePublicProfile()
  const [portrait, setPortrait] = useState<AboutPortraitData | null>(() =>
    hasFreshPortraitCache() ? cachedPortrait : FALLBACK_PORTRAIT,
  )
  const [portraitLoading, setPortraitLoading] = useState<boolean>(() => !hasFreshPortraitCache())

  useEffect(() => {
    let active = true

    const loadPortrait = (forceRefresh = false) => {
      void getSharedAboutPortrait(forceRefresh)
        .then((result) => {
          if (!active) return
          setPortrait(result.error ? FALLBACK_PORTRAIT : result.portrait)
          setPortraitLoading(false)
        })
        .catch(() => {
          if (active) {
            setPortrait(FALLBACK_PORTRAIT)
            setPortraitLoading(false)
          }
        })
    }

    const onRevalidate = () => {
      if (document.visibilityState === 'visible') loadPortrait(false)
    }

    const onPortfolioUpdated = () => {
      loadPortrait(false)
    }

    loadPortrait(false)
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

  const paragraphs = deriveParagraphs(profile, profileLoading, profileError)

  return {
    portrait,
    paragraphs,
    profile,
    loading: portraitLoading || profileLoading,
    error: profileError,
  }
}
