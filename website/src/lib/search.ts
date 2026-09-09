import Fuse from 'fuse.js'
import { groupLabel, PAGES } from './docs'

export interface SearchHit {
  slug: string
  title: string
  groupLabel: string
}

interface DocItem {
  slug: string
  title: string
  description: string
  content: string
  groupLabel: string
}

const items: DocItem[] = PAGES.map((p) => ({
  slug: p.slug,
  title: p.title,
  description: p.description,
  content: p.content,
  groupLabel: groupLabel(p.group),
}))

const fuse = new Fuse(items, {
  keys: [
    { name: 'title', weight: 0.5 },
    { name: 'description', weight: 0.3 },
    { name: 'content', weight: 0.2 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 2,
})

export function searchDocs(query: string): SearchHit[] {
  const q = query.trim()
  if (q.length < 2) return []
  return fuse.search(q).slice(0, 8).map((r) => ({
    slug: r.item.slug,
    title: r.item.title,
    groupLabel: r.item.groupLabel,
  }))
}
