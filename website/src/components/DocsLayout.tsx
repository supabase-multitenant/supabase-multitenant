import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { docLinks, groupLabel, NAV, PAGE_BY_SLUG } from '../lib/docs'
import { RichText } from './RichText'
import { SearchBox } from './SearchBox'

export function DocsLayout({ slug }: { slug: string }) {
  const page = PAGE_BY_SLUG.get(slug)
  const links = docLinks()
  const index = links.findIndex((l) => l.slug === slug)
  const prev = index > 0 ? links[index - 1] : null
  const next = index >= 0 && index < links.length - 1 ? links[index + 1] : null
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    document.title = page ? `${page.title} · Docs · Supabase Multitenant` : 'Docs · Supabase Multitenant'
  }, [page])

  if (!page) return null

  return (
    <div className="shell flex gap-10 py-10">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-line bg-surface-900 px-4 py-6 transition-transform md:sticky md:top-16 md:z-auto md:max-h-[calc(100vh-4rem)] md:w-64 md:translate-x-0 md:border-r-0 md:bg-transparent md:py-8 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-6">
          <SearchBox />
        </div>

        <nav>
          {NAV.map((group) => (
            <div key={group.id} className="mb-7">
              <h3 className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-widest text-dim">
                {group.label}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((itemSlug) => {
                  const item = PAGE_BY_SLUG.get(itemSlug)
                  if (!item) return null
                  const active = itemSlug === slug
                  return (
                    <li key={itemSlug}>
                      <NavLink
                        to={`/docs/${itemSlug}`}
                        onClick={() => setSidebarOpen(false)}
                        className={`block rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                          active
                            ? 'bg-brand-400/10 font-medium text-brand-300'
                            : 'text-muted hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {item.title}
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="mb-4 md:hidden">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-muted"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            Docs navigation
          </button>
        </div>

        <div className="mb-8 flex items-center gap-2 text-sm text-dim">
          <span>Docs</span>
          <span className="text-line-strong">/</span>
          <span className="text-muted">{groupLabel(page.group)}</span>
        </div>

        <RichText content={page.content} />

        <nav className="mt-16 grid gap-4 border-t border-line pt-10 sm:grid-cols-2">
          {prev ? (
            <NavLink to={`/docs/${prev.slug}`} className="group rounded-xl border border-line p-5 transition-colors hover:border-brand-400/40">
              <span className="text-xs text-dim">Previous</span>
              <span className="mt-1 block font-medium text-white group-hover:text-brand-200">{prev.title}</span>
            </NavLink>
          ) : (
            <span />
          )}
          {next ? (
            <NavLink to={`/docs/${next.slug}`} className="group rounded-xl border border-line p-5 text-right transition-colors hover:border-brand-400/40">
              <span className="text-xs text-dim">Next</span>
              <span className="mt-1 block font-medium text-white group-hover:text-brand-200">{next.title}</span>
            </NavLink>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </div>
  )
}
