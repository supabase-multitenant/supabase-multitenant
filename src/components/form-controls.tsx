import type { ReactNode } from 'react'

/** Form row used by the create-organization / create-project dialogs. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[120px_1fr] sm:items-start sm:gap-4">
      <span className="pt-2 text-sm text-foreground">{label}</span>
      <div>
        {children}
        {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  )
}

/** Native select styled to match the mockup. */
export function Select({
  value,
  onChange,
  options,
  render,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  render?: (v: string) => string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full appearance-none rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {render ? render(o) : o}
        </option>
      ))}
    </select>
  )
}
