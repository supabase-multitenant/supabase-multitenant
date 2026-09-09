import { useEffect } from 'react'
import { Link } from 'react-router-dom'

export function NotFound() {
  useEffect(() => {
    document.title = 'Not found · Supabase Multitenant'
  }, [])

  return (
    <div className="shell flex min-h-[70vh] flex-col items-center justify-center py-24 text-center">
      <p className="font-display text-7xl font-extrabold text-white">404</p>
      <h1 className="mt-4 font-display text-2xl font-bold text-white">Page not found</h1>
      <p className="mt-3 max-w-md text-muted">
        The page you're looking for doesn't exist or has moved.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-lg bg-brand-400 px-5 py-2.5 text-sm font-semibold text-surface-950"
        >
          Go home
        </Link>
        <Link
          to="/docs/introduction"
          className="inline-flex items-center justify-center rounded-lg border border-line px-5 py-2.5 text-sm font-semibold text-white"
        >
          Read the docs
        </Link>
      </div>
    </div>
  )
}
