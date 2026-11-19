import { useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { FormEvent } from 'react'
import { ProtectedCanvasImage } from '../../components/ProtectedCanvasImage'
import { contactPhotos } from '../../config/contact'
import { inquiryTypes } from '../../types/contact'
import type { ContactInquiry, ContactSectionProps, InquiryType } from '../../types/contact'
import camera from '../../assets/aboutMeImages/r59media-dslr.webp'
import lens from '../../assets/aboutMeImages/r59media-large-lens.webp'
import seal from '../../assets/aboutMeImages/kevin_Logo_IMG.webp'
import { FormField, FormHeader } from '../../components/FormField'
import '../../components/FormField.css'
import './ContactSection.css'
import { extractPhoneDigits, formatPhoneInput } from '../../utils/phone'

type Field = 'name' | 'email' | 'phone' | 'message' | 'location' | 'eventDate'
const limits = { name: 100, email: 254, phone: 30, message: 2000, location: 200 }

/** Inline R59 Media logo SVG allowing clean color & counter inversion on hover. */
function BrandBadgeLogo() {
  return (
    <svg className="contact-section__brand-logo" viewBox="0 0 81 50" fill="none" aria-hidden="true">
      <path d="M17.9574 5.98615C18.8105 5.14473 20.1585 5.14871 21.2958 5.1882C22.3661 5.22529 23.7456 5.14533 24.7788 5.2177C24.746 9.32676 24.8139 13.4673 24.7681 17.5618C23.1431 17.7509 21.8549 17.7474 20.2501 18.3084C19.8429 18.4507 18.2746 19.2318 18.1006 19.2637C14.8759 21.1807 12.6929 23.8821 11.7602 27.5388C10.8702 30.9659 11.3899 34.6046 13.2042 37.6495C13.4361 38.0355 13.7797 38.5838 14.0575 38.9195C11.943 39.2187 8.99636 38.924 6.81775 38.9724C5.42049 39.0035 2.85389 39.1712 1.67557 38.5821C1.12214 38.3549 0.385697 37.642 0.25868 37.0915C-0.0952011 35.5575 0.0335517 33.2091 0.0332499 31.6543L0.0336276 24.2504L0.0271372 17.8027C0.0245712 16.4114 -0.139427 13.7406 0.370226 12.5677C1.31851 10.2912 4.50639 10.7918 6.53014 10.7923L14.9167 10.8059C15.196 10.4061 15.4237 9.96328 15.7254 9.53788C16.184 8.68753 17.3416 6.6193 17.9574 5.98615ZM11.1044 16.2276C11.4414 16.2059 11.3657 16.2613 11.5767 16.0814C11.8645 15.4675 11.706 14.3759 11.6578 13.6752C10.8924 13.5997 10.0074 13.5901 9.2344 13.6138C7.66483 13.6619 6.0238 13.5643 4.46186 13.6375C4.13425 13.6668 4.10134 13.6192 3.85365 13.7933C3.70256 14.198 3.71984 15.6023 3.9064 16.0409C4.27772 16.3519 10.1768 16.2268 11.1044 16.2276Z" fill="currentColor" />
      <path d="M34.5042 25.9641C34.4322 25.0311 34.4922 23.3155 34.492 22.3255L34.4901 14.8146L34.4903 8.65288C34.4906 7.62856 34.4335 5.84976 34.6027 4.92425C35.0549 4.73805 38.2506 4.81809 38.9345 4.82485C40.9192 4.84422 44.4316 4.56822 45.9614 5.9084C47.1802 6.83969 47.7983 8.04833 47.9515 9.55204C48.2572 12.5646 47.7674 14.5077 45.0656 15.9432L45.7206 16.2521C48.4097 17.3182 47.6414 21.9727 47.9915 24.2441C48.0429 24.5777 48.2768 25.6652 48.2504 25.906C47.9319 26.1243 44.5018 26.0921 44.1878 25.7948C43.2324 23.6693 44.6346 19.0692 42.4739 18.0931C41.7237 17.7541 39.6234 17.9965 38.6252 17.8837L38.61 18.0847C38.6915 19.1172 38.7046 25.188 38.5106 25.9164C38.0994 26.1187 35.1091 26.0137 34.5042 25.9641ZM38.6247 14.5114C40.1268 14.5496 40.9939 14.5965 42.489 14.4096C43.1509 14.0357 43.2837 13.9709 43.6444 13.3058C44.0399 11.5406 44.3516 8.77834 41.9645 8.36622C40.9834 8.19669 39.6332 8.28183 38.6221 8.3265C38.5868 10.3718 38.5391 12.4677 38.6247 14.5114Z" fill="currentColor" />
      <path d="M69.455 4.54616C74.0919 4.34314 76.1847 6.72731 76.6277 11.1862C77.0322 15.2653 77.2798 20.7489 74.7621 24.2505C73.0278 26.6626 68.4271 26.9242 66.2226 25.0672C64.8203 23.901 64.3977 22.155 64.2611 20.4184L64.9502 20.3948C65.812 20.4449 66.8113 20.3952 67.7237 20.4293C67.8301 21.0294 67.9984 21.9133 68.3924 22.374C69.4437 23.6018 71.5727 23.2396 72.2663 21.8251C73.0489 20.2292 73.0889 18.3979 73.184 16.6756C72.3772 17.6864 71.4708 18.4595 70.1531 18.642C66.5705 19.1382 64.3879 16.8512 63.9788 13.4281C63.7079 11.1636 63.8362 8.57998 65.2618 6.65974C66.3109 5.24673 67.7645 4.76975 69.455 4.54616Z" fill="currentColor" />
      <path className="contact-section__brand-cutout" d="M72.5787 13.0939C72.4708 14.3203 71.7818 15.4646 70.4807 15.6762C69.9426 15.7682 69.3894 15.64 68.9479 15.3209C67.369 14.1811 67.2437 9.83168 68.3788 8.43091C69.7697 6.71548 72.2927 7.5575 72.572 9.96645C72.7025 10.7907 72.7554 12.2797 72.5787 13.0939Z" fill="var(--badge-cutout, var(--color-brand-red))" />
      <path d="M51.3691 4.85147C52.7699 4.7607 54.8853 4.82249 56.3276 4.82316C57.9607 4.82392 60.0996 4.75942 61.6762 4.86326C61.7388 5.7956 61.7184 7.45029 61.689 8.39089C59.6958 8.52311 56.7653 8.4029 54.6664 8.43158C54.5034 9.98574 54.36 11.5419 54.2363 13.0998C54.5593 12.8289 54.6589 12.7626 55.0287 12.5588C57.4951 11.3673 60.5026 12.1748 61.6505 14.7693C62.9939 17.8064 62.9146 23.6257 59.6113 25.3962C57.7389 26.8401 53.5412 26.5624 51.8189 24.9128C50.3495 23.5048 49.9782 21.8031 49.8809 19.8618C50.8016 19.7847 52.7042 19.8462 53.6702 19.8632C53.7759 20.518 53.8114 21.0689 54.0929 21.688C54.7895 23.2164 56.3948 23.3617 57.5049 22.5542C58.1746 22.067 58.3034 21.4628 58.4392 20.656C58.8354 18.3081 58.5698 14.1911 55.0929 15.2043C54.3412 15.4233 53.9623 16.2516 53.6853 16.8963C53.1329 16.9655 50.6182 17.0298 50.1669 16.9107C50.1692 15.8537 50.4718 13.6493 50.5963 12.504L51.3691 4.85147Z" fill="currentColor" />
      <path d="M73.0118 28.4578C74.0351 28.4071 75.8374 28.3544 76.8275 28.47C77.2004 29.4597 78.1422 33.0088 78.2864 34.0432C78.3513 34.2837 78.6653 35.3778 78.6811 35.5554C79.0041 36.4345 79.3113 37.722 79.5649 38.668L81.0003 44.0332C80.075 44.1235 78.7853 44.0898 77.8441 44.0503C77.6758 43.2812 77.2795 41.1041 77.1098 40.8917C76.9552 40.7814 76.9552 40.7814 76.7119 40.7371C76.4686 40.6929 73.5702 40.7052 73.2759 40.7371C72.9816 40.7691 72.9197 40.862 72.9197 40.862C72.6261 41.2152 72.1974 43.4888 72.0661 44.0628C70.1363 44.1324 67.9069 44.0754 65.9545 44.0641C65.8609 42.2205 65.9341 39.6395 65.9402 37.7516L65.9349 28.4619C66.8428 28.4037 68.0601 28.3821 68.962 28.4458C69.0405 30.1331 68.9809 32.2894 68.9778 34.0127C68.9703 37.2293 68.9801 40.4461 69.0073 43.6626C69.6058 41.9491 70.0684 39.9728 70.5333 38.1941L73.0118 28.4578ZM74.9906 38.2215L76.497 38.2224C75.9906 36.0844 75.4774 33.9619 75.063 31.8042C75.0381 31.6733 75.0117 31.6003 74.9083 31.5147C74.4615 33.7352 73.8721 36.0021 73.451 38.1589C73.9438 38.1802 74.5031 38.218 74.9906 38.2215Z" fill="currentColor" />
      <path d="M30.9048 28.4602C31.9267 28.4292 34.1988 28.3487 35.1632 28.4626C35.6128 30.1668 35.968 32.0279 36.3797 33.7522C36.5131 34.3113 36.9667 36.2249 37.0001 36.6951C37.03 37.1884 37.5158 39.1202 37.6786 39.5999C38.0854 36.8664 38.9858 33.3395 39.5894 30.5901C39.6483 29.9898 39.8588 29.0273 40.0339 28.4559C40.7297 28.4234 43.7297 28.3356 44.2384 28.5068L44.3116 28.6608L44.3048 38.9446C44.304 40.5516 44.3493 42.4494 44.2806 44.0369C43.9304 44.1192 41.9818 44.0771 41.4995 44.0726C41.3924 43.0125 41.4709 40.6025 41.4807 39.4501C41.498 37.4036 41.4331 35.1767 41.5078 33.1518C41.4867 32.9721 41.5184 32.9579 41.4173 32.861L41.3622 33.0721C41.3003 34.0535 40.6437 36.6666 40.3818 37.7578L38.8815 44.0685C38.0382 44.0736 37.1369 44.0944 36.2997 44.0551C35.706 41.3249 35.0152 38.6652 34.3802 35.9476C34.2581 35.4253 33.8794 33.7845 33.8875 33.3119L33.7712 33.2471C33.5978 33.8866 33.7874 35.7621 33.7556 36.5298C33.6521 39.0274 33.7572 41.5776 33.7194 44.0675C32.7803 44.0769 31.8412 44.0767 30.9021 44.0667C30.8712 40.8109 30.8649 37.5549 30.8833 34.2989C30.8846 32.5986 30.8029 30.0835 30.9048 28.4602Z" fill="currentColor" />
      <path d="M54.6388 28.4628C56.4667 28.367 61.0569 28.1361 62.4901 29.2841C63.9195 30.2104 64.7195 31.67 65.0296 33.3199C65.6138 36.4317 65.607 41.3436 62.5534 43.1911C61.1806 44.3525 56.5332 44.1327 54.6245 44.0428C54.6924 40.4419 54.5845 36.7582 54.626 33.1528C54.6434 31.6351 54.5604 29.9609 54.6388 28.4628ZM57.7256 41.3131C59.0659 41.3574 59.7942 41.4824 60.9731 40.8022C61.1716 40.6262 61.3142 40.4406 61.484 40.2375C62.3799 38.1362 62.9731 32.6169 60.2886 31.4107C59.6305 31.1149 58.4494 31.1474 57.7158 31.2011C57.6139 32.8501 57.6463 34.6129 57.6471 36.2745C57.6479 37.9183 57.6139 39.6828 57.7256 41.3131Z" fill="currentColor" />
      <path d="M19.3022 20.8428C19.9372 20.195 23.7903 19.1508 24.6758 19.4651C24.8226 19.897 24.8018 21.5708 24.7419 22.0484C23.8931 22.1309 23.2333 22.2097 22.3951 22.3568C24.1494 24.1128 24.8457 26.3997 22.9366 28.5093C22.7709 28.6922 22.5503 28.8681 22.3268 28.9766L22.2374 29.039C20.2545 30.4132 17.8336 29.7031 16.4983 27.7995C15.2236 30.6574 16.1731 34.6118 18.3671 36.7787C20.2925 38.6804 22.0648 39.395 24.711 39.4714C24.7195 40.3406 24.7397 41.2382 24.7103 42.1044C23.6557 42.0087 22.9098 41.948 21.8791 41.6821C18.9694 40.956 16.4737 39.1001 14.95 36.5293C13.4154 33.9109 12.9881 30.7937 13.7618 27.862C14.5842 24.7705 16.5506 22.4325 19.3022 20.8428Z" fill="currentColor" />
      <path d="M45.3371 28.4641C46.5069 28.3675 48.4284 28.4212 49.6669 28.4088C50.8223 28.3972 52.9559 28.3417 54.0298 28.4642C54.0608 29.0845 54.1649 30.6264 53.9453 31.155C53.4993 31.366 48.8835 31.3006 48.3507 31.1961C48.3174 32.4132 48.2948 33.5618 48.3439 34.7834C50.0299 34.8272 51.7159 34.841 53.4027 34.8248C53.4042 35.6753 53.4238 36.5941 53.4042 37.4387C51.7989 37.443 49.9536 37.3956 48.3688 37.4473C48.2925 38.7385 48.2918 40.0331 48.368 41.3244C49.4631 41.3082 52.1144 41.2104 53.0781 41.3049C53.3672 41.2808 53.7498 41.224 53.9898 41.3684C54.0781 41.9141 54.0374 43.4477 54.0343 44.074L45.3379 44.0807C45.1748 41.9577 45.2903 38.3379 45.2828 36.107C45.276 34.0962 45.1741 30.3602 45.3371 28.4641Z" fill="currentColor" />
      <path d="M27.3959 0.00271895C27.6851 -0.00815201 28.0087 0.0161725 28.3007 0.0299372C28.3625 3.33033 28.3136 6.81912 28.3175 10.1419L28.3099 34.171L28.3375 45.0631C28.3395 46.0367 28.3877 49.2792 28.2836 49.9964C28.0199 50.0089 27.6662 49.9854 27.3954 49.9792C27.282 47.0112 27.3712 42.7899 27.3717 39.7615L27.3764 20.2674L27.3789 6.68812C27.3783 4.9964 27.2932 1.56603 27.3959 0.00271895Z" fill="currentColor" />
    </svg>
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

export function ContactSection({ photos = contactPhotos, onSendInquiry }: ContactSectionProps) {
  const reduced = useReducedMotion()
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

  return <section id="contact" className="contact-section" data-step={step} aria-labelledby="contact-title">
    <div className="contact-section__art" aria-hidden="true">
      <div className="contact-section__camera">
        <ProtectedCanvasImage src={camera} alt="" className="contact-section__art-image" containerClassName="contact-section__art-container" width={1100} height={1247} />
      </div>
      <div className="contact-section__lens">
        <ProtectedCanvasImage src={lens} alt="" className="contact-section__art-image" containerClassName="contact-section__art-container" width={640} height={1038} />
      </div>
      <div className="contact-section__seal">
        <ProtectedCanvasImage src={seal} alt="" className="contact-section__art-image" containerClassName="contact-section__art-container" width={700} height={703} />
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
      <header className="contact-section__header"><p className="contact-section__eyebrow"><span />Get in touch</p><h2 id="contact-title">READY TO CREATE<br />SOMETHING?</h2></header>
      <div className="contact-section__body">
        <div className="contact-section__collage" aria-hidden="true">
          {photos.slice(0, 3).map((photo, index) => <div className={`contact-section__photo contact-section__photo--${index + 1}`} key={photo.id}><ProtectedCanvasImage src={photo.imageUrl} alt="" className="contact-section__photo-image" containerClassName="contact-section__photo-container" width={300} height={400} objectPosition={photo.objectPosition} /></div>)}
        </div>
        <div className="contact-section__flow">
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
                <button className="contact-section__send" type="submit" disabled={busy || !onSendInquiry}>{busy ? 'Sending…' : 'Send inquiry →'}</button>
                <p className="contact-section__privacy">Your details will be used to respond to your inquiry. <a href={`${import.meta.env.BASE_URL}privacy-policy`}>Privacy Policy</a></p>
              </form>
            </motion.div> : <motion.div key="success" {...formPanelMotion} onAnimationComplete={() => formHeading.current?.focus({ preventScroll: true })} className="contact-section__form-panel contact-section__success"><p className="contact-section__step">Message sent</p><h3 ref={formHeading} tabIndex={-1}>Thanks! Your inquiry has been sent.</h3><p>I’ll reply to the email address you provided.</p><a href="#portfolio">Explore the portfolio →</a></motion.div>}
          </AnimatePresence>
        </div>
      </div>
    </div>
  </section>
}
