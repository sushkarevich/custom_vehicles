import { useEffect, useRef } from 'react'
import { useDocumentStore } from '../../store/document-store'
import { normalizeNumericInput } from '../../store/operations'

export function Field({
  label,
  hint,
  children,
  className = ''
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint === undefined ? null : <small className="field-hint">{hint}</small>}
    </label>
  )
}

export function TransactionalText({
  label,
  value,
  onChange,
  placeholder,
  hint
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: string
}): React.JSX.Element {
  const begin = useDocumentStore((state) => state.beginTransaction)
  const end = useDocumentStore((state) => state.endTransaction)
  return (
    <Field label={label} {...(hint === undefined ? {} : { hint })}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onFocus={begin}
        onBlur={end}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
  disabled = false
}: {
  label: string
  value: number | null
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}): React.JSX.Element {
  const begin = useDocumentStore((state) => state.beginTransaction)
  const end = useDocumentStore((state) => state.endTransaction)
  return (
    <Field label={label}>
      <input
        type="number"
        value={value !== null && Number.isFinite(value) ? value : ''}
        placeholder={value === null ? 'Смешано' : undefined}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={begin}
        onBlur={end}
        onChange={(event) =>
          onChange(
            normalizeNumericInput(event.target.value, value ?? min ?? 0, {
              ...(min === undefined ? {} : { min }),
              ...(max === undefined ? {} : { max })
            })
          )
        }
      />
    </Field>
  )
}

export function IndeterminateCheckbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel
}: {
  checked: boolean
  indeterminate: boolean
  onChange: (checked: boolean) => void
  ariaLabel?: string
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label={ariaLabel}
      aria-checked={indeterminate ? 'mixed' : checked}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

export function Section({
  title,
  subtitle,
  children,
  actions
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="inspector-section">
      <div className="section-heading">
        <div>
          <h3>{title}</h3>
          {subtitle === undefined ? null : <p>{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}
