import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchDocs } from '../lib/search'

export function SearchBox() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const results = searchDocs(query)
  const navigate = useNavigate()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const go = (slug: string) => {
    setOpen(false)
    setQuery('')
    navigate(`/docs/${slug}`)
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-750 px-3 focus-within:border-brand-400/50">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-dim">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.2-3.2" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search docs…"
          className="h-10 w-full bg-transparent text-sm text-white placeholder:text-dim focus:outline-none"
        />
        <kbd className="hidden shrink-0 items-center gap-0.5 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-dim md:flex">
          ⌘K
        </kbd>
      </div>

      {open && query.trim().length >= 2 && (
        <div className="absolute top-full z-40 mt-2 w-full overflow-hidden rounded-xl border border-line bg-surface-850 shadow-2xl">
          {results.length === 0 ? (
            <div className="px-4 py-4 text-sm text-muted">No matches for “{query.trim()}”.</div>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.slug}>
                  <button
                    type="button"
                    onClick={() => go(r.slug)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-white/5"
                  >
                    <span className="text-sm font-medium text-white">{r.title}</span>
                    <span className="shrink-0 text-xs text-dim">{r.groupLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
