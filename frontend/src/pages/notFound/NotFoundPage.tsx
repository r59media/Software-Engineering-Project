import { useEffect, useState } from 'react'
import { NotFoundScene } from './NotFoundScene'
import arrowLeft from '../../assets/legal/arrow-left.svg'
import './NotFoundPage.css'

export function NotFoundPage() {
  const [leftLightOn, setLeftLightOn] = useState(true)
  const [rightLightOn, setRightLightOn] = useState(true)
  const baseUrl = import.meta.env.BASE_URL

  useEffect(() => {
    document.title = '404 - Page Not Found | R59 Media'
  }, [])

  const toggleLeft = () => setLeftLightOn((prev) => !prev)
  const toggleRight = () => setRightLightOn((prev) => !prev)

  return (
    <main id="not-found-content" className="not-found-page">
      <div className="not-found-page__inner">
        {/* Top bar back link */}
        <header className="not-found-page__header">
          <a className="not-found-page__back" href={baseUrl}>
            <img src={arrowLeft} width="16" height="16" alt="" aria-hidden="true" />
            <span>Back to Home</span>
          </a>
          <span className="not-found-page__badge">HTTP 404</span>
        </header>

        {/* 3D Studio Stage */}
        <div className="not-found-page__canvas-wrap">
          <NotFoundScene
            leftOn={leftLightOn}
            rightOn={rightLightOn}
          />
        </div>

        {/* Interactive Studio Light Controls */}
        <section className="not-found-page__controls" aria-label="Studio light controls">
          <p className="not-found-page__controls-hint">
            Interactive Studio · Toggle speedlights:
          </p>
          <div className="not-found-page__buttons">
            <button
              type="button"
              className={`not-found-page__switch ${leftLightOn ? 'not-found-page__switch--on' : ''}`}
              aria-pressed={leftLightOn}
              onClick={toggleLeft}
            >
              <span className="not-found-page__switch-dot" aria-hidden="true" />
              <span>Left Light</span>
              <span className="not-found-page__switch-state">
                {leftLightOn ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              className={`not-found-page__switch ${rightLightOn ? 'not-found-page__switch--on' : ''}`}
              aria-pressed={rightLightOn}
              onClick={toggleRight}
            >
              <span className="not-found-page__switch-dot" aria-hidden="true" />
              <span>Right Light</span>
              <span className="not-found-page__switch-state">
                {rightLightOn ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </section>

        {/* Informative text & navigation links */}
        <div className="not-found-page__info">
          <h1 className="not-found-page__title">Frame Not Found</h1>
          <p className="not-found-page__desc">
            The page or session you're searching for is out of frame or has moved.
            Feel free to adjust the studio lighting above, or jump right back into the main portfolio.
          </p>

          <div className="not-found-page__actions">
            <a href={baseUrl} className="not-found-page__btn not-found-page__btn--primary">
              Return to Home
            </a>
            <a href={`${baseUrl}#portfolio`} className="not-found-page__btn not-found-page__btn--secondary">
              View Portfolio
            </a>
            <a href={`${baseUrl}#booking`} className="not-found-page__btn not-found-page__btn--secondary">
              Book a Session
            </a>
            <a href={`${baseUrl}faq`} className="not-found-page__btn not-found-page__btn--secondary">
              FAQ
            </a>
          </div>
        </div>
      </div>
    </main>
  )
}

export default NotFoundPage
