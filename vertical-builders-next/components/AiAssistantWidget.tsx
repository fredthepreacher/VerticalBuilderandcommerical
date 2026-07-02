'use client'

/**
 * Vertical Project Assistant — AI chat widget.
 *
 * Architecture:
 *  1. Messages POST to /api/chat (OpenAI Responses API, server-side —
 *     the OPENAI_API_KEY never reaches the browser).
 *  2. If the key isn't configured or OpenAI is unavailable (503), the
 *     widget transparently falls back to the local rule engine in
 *     lib/assistant.ts — instant, deterministic, works offline.
 *
 * The visitor always gets an answer either way.
 */

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { BIZ } from '@/lib/data'
import { answer, SUGGESTIONS, type BotReply } from '@/lib/assistant'

interface Msg { from: 'bot' | 'user'; text: string; links?: BotReply['links'] }

const GREETING: Msg = {
  from: 'bot',
  text: '👋 Hi! I’m the Vertical Builders assistant. Ask me about our services, the areas we serve, licensing, financing — anything on the site.',
}

const AI_LINKS = [
  { label: `Call ${BIZ.phone}`, href: BIZ.phoneHref },
  { label: 'Request an Estimate', href: '/contact' },
]

export default function AiAssistantWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, thinking, open])

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || thinking) return
    setInput('')
    const history = [...msgs, { from: 'user' as const, text: trimmed }]
    setMsgs(history)
    setThinking(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history
            .filter(m => m !== GREETING)
            .map(m => ({ role: m.from === 'user' ? 'user' : 'assistant', content: m.text })),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.ok && data.reply) {
          setMsgs(m => [...m, { from: 'bot', text: data.reply, links: AI_LINKS }])
          return
        }
      }
      throw new Error('fallback')
    } catch {
      // Local rule engine — instant, uses the same site data
      const reply = answer(trimmed)
      setMsgs(m => [...m, { from: 'bot', text: reply.text, links: reply.links }])
    } finally {
      setThinking(false)
    }
  }

  return (
    <>
      {open && (
        <div className="ai-panel" role="dialog" aria-label="Project assistant">
          <div className="ai-head">
            <Image src="/brand/logo-mark.png" alt="" width={34} height={34} />
            <div>
              <h3>Vertical Project Assistant</h3>
              <p>Instant answers · humans reply same business day</p>
            </div>
            <button className="ai-close" aria-label="Close chat" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="ai-body" ref={bodyRef}>
            {msgs.map((m, i) => (
              <div className={`ai-msg ${m.from === 'user' ? 'ai-msg-user' : ''}`} key={i}>
                {m.text}
                {m.links && (
                  <span className="ai-links">
                    {m.links.map(l =>
                      l.href.startsWith('/') ? (
                        <Link key={l.href + l.label} href={l.href} onClick={() => setOpen(false)}>{l.label}</Link>
                      ) : (
                        <a key={l.href + l.label} href={l.href} target={l.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">{l.label}</a>
                      )
                    )}
                  </span>
                )}
              </div>
            ))}
            {thinking && <div className="ai-msg ai-typing" aria-live="polite">Typing<span>.</span><span>.</span><span>.</span></div>}
            {msgs.length <= 1 && !thinking && (
              <div className="ai-suggestions">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
          <form className="ai-input" onSubmit={e => { e.preventDefault(); ask(input) }}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about services, areas, permits…"
              aria-label="Ask the assistant a question"
              disabled={thinking}
            />
            <button type="submit" aria-label="Send" disabled={thinking}>➤</button>
          </form>
          <p className="ai-note">
            Automated assistant — for anything specific, call <a href={BIZ.phoneHref}>{BIZ.phone}</a>.
          </p>
        </div>
      )}
      <button className="ai-fab" aria-label={open ? 'Close assistant' : 'Open project assistant'} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? <span style={{ color: '#fff', fontSize: '1.6rem', lineHeight: 1 }}>×</span> : <Image src="/brand/logo-mark.png" alt="" width={34} height={34} />}
      </button>
    </>
  )
}
