import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2.5" aria-label="Supabase Multitenant home">
      <BrandMark />
      <span className="font-display text-[1.12rem] font-extrabold tracking-tight text-white leading-none">
        supabase
        <span className="text-brand-400">/</span>
        <span className="text-brand-400">multitenant</span>
      </span>
    </Link>
  )
}
