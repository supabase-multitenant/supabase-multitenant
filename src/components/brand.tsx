import Link from 'next/link'

export function BrandMark({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--brand))" />
          <stop offset="100%" stopColor="hsl(var(--brand-strong))" />
        </linearGradient>
      </defs>
      <path
        d="M13.4 1.6 4 13.2c-.5.6-.1 1.5.7 1.5h5.1l-.6 7.7c-.05.9 1.1 1.3 1.6.6L20.2 11c.5-.6.1-1.5-.7-1.5h-5.1l.6-7.3c.06-.9-1.1-1.3-1.6-.6Z"
        fill="url(#brandGrad)"
      />
    </svg>
  )
}

export function BrandLogo({ label = 'supabase-multitenant' }: { label?: string }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <BrandMark />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">{label}</span>
    </Link>
  )
}
