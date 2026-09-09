import { Link, useParams } from 'react-router-dom'
import { DocsLayout } from '../components/DocsLayout'
import { PAGE_BY_SLUG } from '../lib/docs'

export function DocPage() {
  const { slug } = useParams<{ slug: string }>()
  const page = slug ? PAGE_BY_SLUG.get(slug) : undefined

  if (!page) {
    return (
      <div className="shell flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
        <p className="font-display text-6xl font-extrabold text-white">404</p>
        <p className="mt-4 text-xl text-muted">That doc doesn’t exist.</p>
        <Link
          to="/docs/introduction"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-brand-400 px-5 py-2.5 text-sm font-semibold text-surface-950"
        >
          Back to docs
        </Link>
      </div>
    )
  }

  return <DocsLayout slug={page.slug} />
}
