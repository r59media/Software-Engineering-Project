import type { ElementType, ReactNode, Ref } from 'react'

/** Shared visual red asterisk matching the R59 brand palette. */
export function RequiredMark() {
  return (
    <span className="r59-form__star" aria-hidden="true">
      *
    </span>
  )
}

/** Shared header legend showing the red asterisk meaning. */
export function RequiredNotice() {
  return (
    <span className="r59-form__required-notice">
      <RequiredMark /> Required fields
    </span>
  )
}

export interface FormHeaderProps {
  title: string
  as?: ElementType
  titleClassName?: string
  titleRef?: Ref<HTMLHeadingElement>
  titleTabIndex?: number
  className?: string
}

/** Shared form header row aligning section/card title with required-fields notice. */
export function FormHeader({
  title,
  as: Heading = 'h3',
  titleClassName = '',
  titleRef,
  titleTabIndex,
  className = '',
}: FormHeaderProps) {
  return (
    <div className={`r59-form__header ${className}`.trim()}>
      <Heading
        ref={titleRef}
        tabIndex={titleTabIndex}
        className={`r59-form__heading ${titleClassName}`.trim()}
      >
        {title}
      </Heading>
      <RequiredNotice />
    </div>
  )
}

export interface FormFieldProps {
  htmlFor: string
  label: string
  required?: boolean
  optional?: boolean
  fullWidth?: boolean
  className?: string
  error?: string
  errorId?: string
  errorNode?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

/** Shared labeled form field with unified spacing, red required mark, and error slot. */
export function FormField({
  htmlFor,
  label,
  required = false,
  optional = false,
  fullWidth = false,
  className = '',
  error,
  errorId,
  errorNode,
  footer,
  children,
}: FormFieldProps) {
  const classes = [
    'r59-form__field',
    fullWidth ? 'r59-form__field--full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <label htmlFor={htmlFor} className="r59-form__label">
        {label}
        {optional && <span className="r59-form__optional"> (optional)</span>}
        {required && (
          <>
            {' '}
            <RequiredMark />
          </>
        )}
      </label>
      {children}
      {footer}
      {error && (
        <span id={errorId} className="r59-form__field-error" aria-live="polite">
          {error}
        </span>
      )}
      {errorNode}
    </div>
  )
}
