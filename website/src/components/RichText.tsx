import { isValidElement, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from 'react-router-dom'

function textOf(node: ReactNode): string {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function heading(Tag: 'h2' | 'h3') {
  return function Heading({ children }: { children?: ReactNode }) {
    const id = slugify(textOf(children))
    return (
      <Tag id={id} className="group relative">
        <a
          href={`#${id}`}
          className="ml-[0.2em] inline-block pr-2 text-transparent no-underline opacity-0 transition-opacity group-hover:opacity-100 hover:text-brand-400"
          aria-hidden="true"
        >
          #
        </a>
        {children}
      </Tag>
    )
  }
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const copy = async (el: HTMLPreElement | null | undefined) => {
    const text = el?.innerText ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="group relative my-5 overflow-hidden rounded-xl border border-line bg-[#080808]">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-[11px] uppercase tracking-widest text-dim">terminal</span>
        <button
          type="button"
          onClick={(e) => copy(e.currentTarget.closest('div')?.querySelector('pre'))}
          className="text-[11px] font-medium text-muted transition-colors hover:text-white"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[0.88rem] leading-relaxed text-[#e6e6e6]">
        {children}
      </pre>
    </div>
  )
}

function DocLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (href && href.startsWith('/')) {
    return <Link to={href}>{children}</Link>
  }
  const external = href?.startsWith('http')
  return (
    <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined}>
      {children}
    </a>
  )
}

const components = {
  h2: heading('h2'),
  h3: heading('h3'),
  pre: ({ children }: { children?: ReactNode }) => <CodeBlock>{children}</CodeBlock>,
  a: DocLink as never,
}

export function RichText({ content }: { content: string }) {
  return (
    <div className="prose-doc">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
