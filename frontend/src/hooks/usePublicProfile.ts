import { useEffect, useState } from 'react'
import type { PublicProfileData } from '../api/client'

const PROFILE_CACHE_TTL_MS = 60_000

interface PublicProfileResult {
  profile: PublicProfileData | null
  error: boolean
}

let cachedProfile: PublicProfileData | null = null
let hasCachedProfile = false
let cachedProfileTimestamp = 0
let inFlightProfilePromise: Promise<PublicProfileResult> | null = null

function hasFreshProfileCache(): boolean {
  return hasCachedProfile && Date.now() - cachedProfileTimestamp < PROFILE_CACHE_TTL_MS
}

function invalidateProfileCache(): void {
  cachedProfile = null
  hasCachedProfile = false
  cachedProfileTimestamp = 0
  inFlightProfilePromise = null
}

if (typeof window !== 'undefined') {
  window.addEventListener('portfolio-updated', invalidateProfileCache)
}

async function fetchPublicProfileData(): Promise<PublicProfileResult> {
  try {
    const res = await fetch('/api/profile', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    })
    if (!res.ok) {
      return { profile: null, error: true }
    }
    const json = (await res.json()) as Record<string, unknown>
    if (json.status === 'error') {
      return { profile: null, error: true }
    }

    let val: unknown = json
    if (json.data !== undefined) {
      val = json.data
    }

    if (val && typeof val === 'object') {
      if ('profile' in val && val.profile && typeof val.profile === 'object') {
        return { profile: val.profile as PublicProfileData, error: false }
      }
      return { profile: val as PublicProfileData, error: false }
    }
    return { profile: null, error: false }
  } catch {
    return { profile: null, error: true }
  }
}

function getSharedPublicProfile(forceRefresh = false): Promise<PublicProfileResult> {
  if (!forceRefresh && hasFreshProfileCache()) {
    return Promise.resolve({ profile: cachedProfile, error: false })
  }
  if (!forceRefresh && inFlightProfilePromise) {
    return inFlightProfilePromise
  }

  const request = fetchPublicProfileData()
    .then((result) => {
      if (!result.error) {
        cachedProfile = result.profile
        hasCachedProfile = true
        cachedProfileTimestamp = Date.now()
      }
      return result
    })
    .finally(() => {
      if (inFlightProfilePromise === request) {
        inFlightProfilePromise = null
      }
    })

  inFlightProfilePromise = request
  return request
}

export interface UsePublicProfileResult {
  profile: PublicProfileData | null
  loading: boolean
  error: boolean
}

export function usePublicProfile(): UsePublicProfileResult {
  const [profile, setProfile] = useState<PublicProfileData | null>(() =>
    hasFreshProfileCache() ? cachedProfile : null,
  )
  const [loading, setLoading] = useState<boolean>(() => !hasFreshProfileCache())
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true

    const load = (forceRefresh = false) => {
      void getSharedPublicProfile(forceRefresh)
        .then((result) => {
          if (!active) return
          setProfile(result.profile)
          setError(result.error)
          setLoading(false)
        })
        .catch(() => {
          if (active) {
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
      load(false)
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

  return { profile, loading, error }
}
