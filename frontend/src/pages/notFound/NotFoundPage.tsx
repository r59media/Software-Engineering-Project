import { useCallback, useEffect, useState } from 'react'
import { ActionLink } from '../../components/ActionLink'
import { R59Logo } from '../../components/R59Logo'
import { NotFoundScene } from './NotFoundScene'
import './NotFoundPage.css'

export function NotFoundPage() {
  const [leftLightOn, setLeftLightOn] = useState(true)
  const [rightLightOn, setRightLightOn] = useState(false)
  const baseUrl = import.meta.env.BASE_URL

  useEffect(() => {
    document.title = '404 - Frame Not Found | R59 Media'
  }, [])

  const toggleLeft = useCallback(() => setLeftLightOn((prev) => !prev), [])
  const toggleRight = useCallback(() => setRightLightOn((prev) => !prev), [])

  return (
    <main id="not-found-content" className="not-found-page">
      <div className="not-found-page__shell">
        <header className="not-found-page__topbar">
          <ActionLink href={baseUrl} className="not-found-page__brand" effect="brand-sweep">
            <R59Logo className="not-found-page__brand-logo" cutoutClassName="not-found-page__brand-cutout" />
            <span className="not-found-page__sr-only">R59 Media Home</span>
          </ActionLink>
          <a className="not-found-page__portfolio" href={`${baseUrl}#portfolio`}>
            <span>Portfolio</span>
            <span aria-hidden="true">↗</span>
          </a>
        </header>

        <div className="not-found-page__grid">
          <div className="not-found-page__copy">
            <h1 className="not-found-page__title">
              <span>Frame</span>
              <span>Not</span>
              <span>Found</span>
            </h1>
            <p className="not-found-page__desc">
              That shot isn’t in this roll. Let’s get you back in focus.
            </p>
            <ActionLink href={baseUrl} className="action action--text not-found-page__home-link" effect="red-sweep">
              <span aria-hidden="true">←</span> Go home
            </ActionLink>
          </div>

          <div className="not-found-page__stage-col">
            <div className="not-found-page__stage-wrap">
              <div
                className={`not-found-page__glow not-found-page__glow--left ${leftLightOn ? 'is-on' : ''}`}
                aria-hidden="true"
              />
              <div
                className={`not-found-page__glow not-found-page__glow--right ${rightLightOn ? 'is-on' : ''}`}
                aria-hidden="true"
              />
              <NotFoundScene
                leftOn={leftLightOn}
                rightOn={rightLightOn}
                onToggleLeft={toggleLeft}
                onToggleRight={toggleRight}
              />
            </div>

            <div className="not-found-page__sr-controls">
              <button
                type="button"
                className="not-found-page__sr-toggle"
                aria-pressed={leftLightOn}
                onClick={toggleLeft}
              >
                {leftLightOn ? 'Turn off left studio light' : 'Turn on left studio light'}
              </button>
              <button
                type="button"
                className="not-found-page__sr-toggle"
                aria-pressed={rightLightOn}
                onClick={toggleRight}
              >
                {rightLightOn ? 'Turn off right studio light' : 'Turn on right studio light'}
              </button>
            </div>

            <p className="not-found-page__hint">Tap a cord to toggle its light.</p>
          </div>
        </div>
      </div>
    </main>
  )
}

export default NotFoundPage
