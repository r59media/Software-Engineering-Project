import { useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'motion/react'
import type { FormEvent } from 'react'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import { contactPhotos } from '../../config/contact'
import { inquiryTypes } from '../../types/contact'
import type { ContactInquiry, ContactSectionProps, InquiryType } from '../../types/contact'
import camera from '../../assets/aboutMeImages/r59media-dslr.webp'
import lens from '../../assets/aboutMeImages/r59media-large-lens.webp'
import { FormField, FormHeader } from '../../components/FormField'
import { R59Logo } from '../../components/R59Logo'
import '../../components/FormField.css'
import './ContactSection.css'
import { extractPhoneDigits, formatPhoneInput } from '../../utils/phone'

type Field = 'name' | 'email' | 'phone' | 'message' | 'location' | 'eventDate'
const limits = { name: 100, email: 254, phone: 30, message: 2000, location: 200 }

function BrandBadgeLogo() {
  return (
    <R59Logo
      className="contact-section__brand-logo"
      cutoutClassName="contact-section__brand-cutout"
      cutoutFill="var(--badge-cutout, var(--color-brand-red))"
    />
  )
}
function validate(draft: ContactInquiry): Partial<Record<Field, string>> {
  const errors: Partial<Record<Field, string>> = {}
  if (!draft.name.trim()) errors.name = 'Please enter your name.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = 'Please enter a valid email address.'
  if (draft.phone.trim() && extractPhoneDigits(draft.phone).length !== 10) errors.phone = 'Please enter a valid 10-digit phone number or leave this blank.'
  if (!draft.message.trim()) errors.message = 'Please tell me a little about your idea or question.'
  for (const key of Object.keys(limits) as (keyof typeof limits)[]) {
    if ((draft[key] ?? '').length > limits[key]) errors[key] = `Please use ${limits[key]} characters or fewer.`
  }
  return errors
}

interface ContactPhotoProps {
  id: string
  index: number
  imageUrl: string
  objectPosition?: string
  progress: MotionValue<number>
  reducedMotion: boolean
}

const PHOTO_SCROLL_MOTION = [
  { range: [0.64, 0.78] as [number, number], fromTranslate: '-150px 70px' },
  { range: [0.74, 0.88] as [number, number], fromTranslate: '-160px 30px' },
  { range: [0.84, 0.98] as [number, number], fromTranslate: '-180px -20px' },
] as const

function ContactCollagePhoto({
  index,
  imageUrl,
  objectPosition,
  progress,
  reducedMotion,
}: ContactPhotoProps) {
  const config = PHOTO_SCROLL_MOTION[index] ?? PHOTO_SCROLL_MOTION[2]
  const [start, end] = config.range
  const translate = useTransform(progress, [start, end], [config.fromTranslate, '0px 0px'], { clamp: true })
  const opacity = useTransform(progress, [start, start + 0.06], [0, 1], { clamp: true })

  return (
    <motion.div
      className={`contact-section__photo contact-section__photo--${index + 1}`}
      style={reducedMotion ? undefined : { opacity, translate }}
    >
      <ProtectedCanvasImage
        src={imageUrl}
        alt=""
        className="contact-section__photo-image"
        containerClassName="contact-section__photo-container"
        width={300}
        height={400}
        minDpr={2}
        eager
        objectPosition={objectPosition}
      />
    </motion.div>
  )
}

export function ContactSection({ photos = contactPhotos, onSendInquiry }: ContactSectionProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start 0.88', 'end 1.06'],
  })
  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 26,
    mass: 0.34,
  })

  // Phase 1: Side-entering elements start completely off-edge so nothing peeks
  // prematurely; the camera enters when scrolled into view, followed by the Polaroids.
  const headerX = useTransform(smoothProgress, [0.06, 0.44], ['-105vw', '0vw'], { clamp: true })
  const lensX = useTransform(smoothProgress, [0.08, 0.46], ['42vw', '0vw'], { clamp: true })
  const lensY = useTransform(smoothProgress, [0.08, 0.46], [-24, 0], { clamp: true })
  const lensRotate = useTransform(smoothProgress, [0.08, 0.46], [14, 0], { clamp: true })
  const flowX = useTransform(smoothProgress, [0.12, 0.5], ['105vw', '0vw'], { clamp: true })

  const cameraX = useTransform(smoothProgress, [0.3, 0.62], ['-55vw', '0vw'], { clamp: true })
  const cameraY = useTransform(smoothProgress, [0.3, 0.62], [110, 0], { clamp: true })
  const cameraRotate = useTransform(smoothProgress, [0.3, 0.62], [-14, 0], { clamp: true })
  const [step, setStep] = useState<'idea' | 'details' | 'success'>('idea')
  const [draft, setDraft] = useState<ContactInquiry>({ name: '', email: '', phone: '', inquiryType: 'portrait', message: '', eventDate: '', eventDateUndecided: false, location: '' })
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState('')
  const lock = useRef(false)
  const formHeading = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef(false)
  const choices = useRef<HTMLDivElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const errors = validate(draft)
  const isFormComplete = Boolean(
    draft.name.trim() &&
      draft.email.trim() &&
      draft.message.trim() &&
      Object.keys(errors).length === 0
  )
  const change = <K extends keyof ContactInquiry>(key: K, value: ContactInquiry[K]) => setDraft(previous => ({ ...previous, [key]: value }))
  const select = (type: InquiryType) => { change('inquiryType', type); setStep('details'); setSendError('') }
  const fieldProps = (field: Field) => ({ id: `contact-${field}`, name: field, onBlur: () => setTouched(previous => ({ ...previous, [field]: true })), 'aria-invalid': Boolean(touched[field] && errors[field]), 'aria-describedby': touched[field] && errors[field] ? `contact-${field}-error` : undefined })
  const error = (field: Field) => touched[field] && errors[field] ? <span id={`contact-${field}-error`} className="contact-section__field-error">{errors[field]}</span> : null
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (lock.current) return
    setTouched({ name: true, email: true, phone: true, message: true, location: true })
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0]
      form.current?.querySelector<HTMLElement>(`#contact-${first}`)?.focus()
      return
    }
    if (!onSendInquiry) { setSendError('Online inquiries are not available yet. Please try again later.'); return }
    lock.current = true; setBusy(true); setSendError('')
    const payload: ContactInquiry = { name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim(), inquiryType: draft.inquiryType, message: draft.message.trim() }
    if (draft.inquiryType === 'event') { payload.eventDate = draft.eventDateUndecided ? '' : draft.eventDate; payload.eventDateUndecided = draft.eventDateUndecided; payload.location = draft.location?.trim() }
    try { await onSendInquiry(payload); setStep('success') }
    catch { setSendError('We couldn’t send your inquiry. Your details are still here. Please try again.') }
    finally { lock.current = false; setBusy(false) }
  }
  const choicesMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, x: -24 },
        animate: { opacity: 1, x: 0, transition: { duration: 0.34, delay: 0.14, ease: [0.22, 1, 0.36, 1] as const } },
        exit: { opacity: 0, x: -48, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const } },
      }
  const formPanelMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 1, x: '115%' },
        animate: { opacity: 1, x: 0, transition: { duration: 0.52, ease: [0.22, 1, 0.36, 1] as const } },
        exit: { opacity: 1, x: '115%', transition: { duration: 0.44, ease: [0.22, 1, 0.36, 1] as const } },
      }
  const badgeMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0 } }, exit: { opacity: 0, transition: { duration: 0 } } }
    : {
        initial: { x: '100%', opacity: 0 },
        animate: {
          x: 0,
          opacity: 1,
          transition: {
            x: { delay: 0.56, duration: 0.42, ease: [0.22, 1, 0.36, 1] as const },
            opacity: { delay: 0.56, duration: 0.06 },
          },
        },
        exit: {
          x: '100%',
          opacity: 0,
          transition: {
            x: { duration: 0.25, ease: [0.22, 1, 0.36, 1] as const },
            opacity: { duration: 0.2 },
          },
        },
      }

  return <section ref={sectionRef} id="contact" className="contact-section" data-step={step} aria-labelledby="contact-title">
    <div className="contact-section__art" aria-hidden="true">
      <div className="contact-section__camera">
        <motion.div
          className="contact-section__art-motion"
          style={reduced ? undefined : { x: cameraX, y: cameraY, rotate: cameraRotate }}
        >
          <ProtectedCanvasImage src={camera} alt="" className="contact-section__art-image" containerClassName="contact-section__art-container" width={1100} height={1247} />
        </motion.div>
      </div>
      <div className="contact-section__lens">
        <motion.div
          className="contact-section__art-motion"
          style={reduced ? undefined : { x: lensX, y: lensY, rotate: lensRotate }}
        >
          <ProtectedCanvasImage src={lens} alt="" className="contact-section__art-image" containerClassName="contact-section__art-container" width={640} height={1038} />
        </motion.div>
      </div>
    </div>
    <AnimatePresence>
      {step === 'details' && (
        <motion.a
          key="contact-brand-badge"
          href="#top"
          aria-label="R59 Media — Back to top"
          className="contact-section__brand-badge"
          {...badgeMotion}
        >
          <BrandBadgeLogo />
        </motion.a>
      )}
    </AnimatePresence>
    <div className="contact-section__inner">
      <motion.header
        className="contact-section__header"
        style={reduced ? undefined : { x: headerX }}
      >
        <p className="contact-section__eyebrow"><span />Get in touch</p>
        <h2 id="contact-title">READY TO CREATE<br />SOMETHING?</h2>
      </motion.header>
      <div className="contact-section__body">
        <div className="contact-section__collage" aria-hidden="true">
          {photos.slice(0, 3).map((photo, index) => (
            <ContactCollagePhoto
              key={photo.id}
              id={photo.id}
              index={index}
              imageUrl={photo.imageUrl}
              objectPosition={photo.objectPosition}
              progress={smoothProgress}
              reducedMotion={Boolean(reduced)}
            />
          ))}
        </div>
        <motion.div
          className="contact-section__flow"
          style={reduced ? undefined : { x: flowX }}
        >
          <AnimatePresence initial={false}>
            {step === 'idea' ? <motion.div key="idea" {...choicesMotion} onAnimationComplete={() => { if (!returnFocus.current) return; returnFocus.current = false; choices.current?.querySelector<HTMLButtonElement>(`[data-type="${draft.inquiryType}"]`)?.focus({ preventScroll: true }) }} className="contact-section__choices" ref={choices}>
              <p className="contact-section__description">Have a project in mind or a question about a session? Let’s talk about it.</p>
              <h3>What are you looking for?</h3>
              <div className="contact-section__options">{inquiryTypes.map(type => <button key={type.id} data-type={type.id} type="button" onClick={() => select(type.id)}>{type.label}</button>)}</div>
              <p className="contact-section__booking-link">Ready to book a session? <a href="#booking">Explore booking →</a></p>
            </motion.div> : step === 'details' ? <motion.div key="details" {...formPanelMotion} onAnimationComplete={() => formHeading.current?.focus({ preventScroll: true })} className="contact-section__form-panel r59-form r59-form--yellow">
              <div className="contact-section__form-nav"><button type="button" disabled={busy} onClick={() => { returnFocus.current = true; setStep('idea') }}>← Change inquiry type</button></div>
              <FormHeader title="Tell me about your idea." as="h3" titleRef={formHeading} titleTabIndex={-1} className="contact-section__form-header" />
              <p className="contact-section__description">Share a few details and I’ll get back to you by email.</p>
              <form ref={form} onSubmit={event => void submit(event)} noValidate aria-busy={busy}>
                <fieldset disabled={busy} className="contact-section__fields r59-form__grid"><legend className="contact-section__sr-only">Inquiry details</legend>
                  <FormField htmlFor="contact-name" label="Name" required errorNode={error('name')}>
                    <input {...fieldProps('name')} autoComplete="name" required maxLength={limits.name} placeholder="Alex Morgan" className="r59-form__control" value={draft.name} onChange={e => change('name', e.target.value)} />
                  </FormField>
                  <FormField htmlFor="contact-email" label="Email" required errorNode={error('email')}>
                    <input {...fieldProps('email')} type="email" autoComplete="email" required maxLength={limits.email} placeholder="alex.morgan@example.com" className="r59-form__control" value={draft.email} onChange={e => change('email', e.target.value)} />
                  </FormField>
                  <FormField htmlFor="contact-phone" label="Phone number" optional errorNode={error('phone')}>
                    <input {...fieldProps('phone')} type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} placeholder="(212) 555-0148" className="r59-form__control" value={draft.phone} onChange={e => change('phone', formatPhoneInput(e.target.value))} />
                  </FormField>
                  <FormField htmlFor="contact-type" label="Inquiry type" required>
                    <select id="contact-type" className="r59-form__control r59-form__select" value={draft.inquiryType} onChange={e => change('inquiryType', e.target.value as InquiryType)}>{inquiryTypes.map(type => <option key={type.id} value={type.id}>{type.label}</option>)}</select>
                  </FormField>
                  {draft.inquiryType === 'event' && <>
                    <FormField htmlFor="contact-date" label="Event date" optional footer={<label className="contact-section__check"><input type="checkbox" checked={draft.eventDateUndecided} onChange={e => change('eventDateUndecided', e.target.checked)} />Not decided yet</label>}>
                      <input id="contact-date" type="date" className="r59-form__control" disabled={draft.eventDateUndecided} value={draft.eventDate ?? ''} onChange={e => change('eventDate', e.target.value)} />
                    </FormField>
                    <FormField htmlFor="contact-location" label="Location" optional errorNode={error('location')}>
                      <input {...fieldProps('location')} maxLength={limits.location} placeholder="City or venue" className="r59-form__control" value={draft.location ?? ''} onChange={e => change('location', e.target.value)} />
                    </FormField>
                  </>}
                  <FormField
                    htmlFor="contact-message"
                    label={draft.inquiryType === 'question' ? 'What would you like to know?' : 'Tell me about your idea'}
                    required
                    fullWidth
                    className="contact-section__message"
                    errorNode={error('message')}
                    footer={<div className="r59-form__footer"><p id="contact-message-help" className="r59-form__help">Share any details about the session, location, or timing.</p><span className="contact-section__count">{draft.message.length} / {limits.message}</span></div>}
                  >
                    <textarea {...fieldProps('message')} aria-describedby={`contact-message-help${touched.message && errors.message ? ' contact-message-error' : ''}`} required rows={3} maxLength={limits.message} placeholder="Share any details about the session, location, or timing." className="r59-form__textarea" value={draft.message} onChange={e => change('message', e.target.value)} />
                  </FormField>
                </fieldset>
                {sendError && <p className="contact-section__send-error" role="alert">{sendError}</p>}
                {!onSendInquiry && <p className="contact-section__availability">Online inquiries are not available yet.</p>}
                <button className="contact-section__send" type="submit" disabled={!isFormComplete || busy || !onSendInquiry}>{busy ? 'Sending…' : 'Send inquiry →'}</button>
                <p className="contact-section__privacy">Your details will be used to respond to your inquiry. <a href={`${import.meta.env.BASE_URL}privacy-policy`}>Privacy Policy</a></p>
              </form>
            </motion.div> : <motion.div key="success" {...formPanelMotion} onAnimationComplete={() => formHeading.current?.focus({ preventScroll: true })} className="contact-section__form-panel contact-section__success"><p className="contact-section__step">Message sent</p><h3 ref={formHeading} tabIndex={-1}>Thanks! Your inquiry has been sent.</h3><p>I’ll reply to the email address you provided.</p><a href="#portfolio">Explore the portfolio →</a></motion.div>}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  </section>
}
