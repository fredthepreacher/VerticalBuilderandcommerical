'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import type { SearchHit } from '@/lib/ops/services/search'

/**
 * Cmd/Ctrl+K global search. Debounced, categorised, keyboard navigable.
 * Results come from /api/ops/search, which runs under the signed-in user's
 * session, so a read-only auditor cannot search their way into anything RLS
 * would not already show them.
 */
export default function GlobalSearch() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(-1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (term.trim().length < 2) {
      setHits([])
      setOpen(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/ops/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
        if (res.ok) {
          const data = (await res.json()) as { hits: SearchHit[] }
          setHits(data.hits ?? [])
          setOpen(true)
          setCursor(-1)
        }
      } catch {
        /* aborted or offline — the input simply shows no results */
      } finally {
        setLoading(false)
      }
    }, 220)

    return () => { controller.abort(); clearTimeout(timer) }
  }, [term])

  const grouped = hits.reduce<Record<string, SearchHit[]>>((acc, hit) => {
    ;(acc[hit.category] ??= []).push(hit)
    return acc
  }, {})

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, hits.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    if (e.key === 'Enter' && cursor >= 0) {
      e.preventDefault()
      router.push(hits[cursor].href)
      setOpen(false)
      setTerm('')
    }
  }

  let index = -1

  return (
    <div className="ops-search" role="search">
      <Search aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={term}
        placeholder="Search customers, projects, subs, policy numbers…"
        aria-label="Global search"
        autoComplete="off"
        onChange={e => setTerm(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => { if (hits.length) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
      />
      {!term && <kbd aria-hidden="true">⌘K</kbd>}

      {open && (
        <div className="ops-search-results" role="listbox" aria-label="Search results">
          {loading && <div className="ops-search-group">Searching…</div>}
          {!loading && hits.length === 0 && (
            <div style={{ padding: '14px 12px', fontSize: '.83rem', color: 'var(--ops-muted)' }}>
              Nothing matched “{term}”. Try a phone number, policy number, or project number.
            </div>
          )}
          {Object.entries(grouped).map(([category, list]) => (
            <div key={category}>
              <div className="ops-search-group">{category}</div>
              {list.map(hit => {
                index += 1
                const active = index === cursor
                return (
                  <a
                    key={`${hit.category}-${hit.id}`}
                    href={hit.href}
                    className="ops-search-hit"
                    role="option"
                    aria-selected={active}
                    style={active ? { background: 'var(--ops-neutral-soft)' } : undefined}
                  >
                    <strong>{hit.title}</strong>
                    <span>{hit.subtitle}</span>
                  </a>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
