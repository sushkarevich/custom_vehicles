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
  step = 0.1
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}): React.JSX.Element {
  const begin = useDocumentStore((state) => state.beginTransaction)
  const end = useDocumentStore((state) => state.endTransaction)
  return (
    <Field label={label}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        onFocus={begin}
        onBlur={end}
        onChange={(event) =>
          onChange(
            normalizeNumericInput(event.target.value, value, {
              ...(min === undefined ? {} : { min }),
              ...(max === undefined ? {} : { max })
            })
          )
        }
      />
    </Field>
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
