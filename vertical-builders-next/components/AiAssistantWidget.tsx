'use client'

/**
 * Vertical Project Assistant — knowledge-driven chat widget.
 *
 * Answers questions about services, locations, licensing, financing,
 * reviews, and contact info using a client-side rule engine over the
 * site's own data (lib/assistant.ts). Zero API keys, instant replies,
 * nothing breaks offline.
 *
 * To upgrade to a real AI agent later, see the notes in lib/assistant.ts
 * and the README "AI Assistant" section.
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

export default function AiAssistantWidget() {
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, open])

  function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed) return
    const reply = answer(trimmed)
    setMsgs(m => [...m, { from: 'user', text: trimmed }, { from: 'bot', text: reply.text, links: reply.links }])
    setInput('')
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
            {msgs.length <= 1 && (
              <div className="ai-suggestions">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => ask(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
          <form
            className="ai-input"
            onSubmit={e => { e.preventDefault(); ask(input) }}
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about services, areas, permits…"
              aria-label="Ask the assistant a question"
            />
            <button type="submit" aria-label="Send">➤</button>
          </form>
          <p className="ai-note">
            Automated answers from site info — for anything specific, call <a href={BIZ.phoneHref}>{BIZ.phone}</a>.
          </p>
        </div>
      )}
      <button className="ai-fab" aria-label={open ? 'Close assistant' : 'Open project assistant'} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? <span style={{ color: '#fff', fontSize: '1.6rem', lineHeight: 1 }}>×</span> : <Image src="/brand/logo-mark.png" alt="" width={34} height={34} />}
      </button>
    </>
  )
}
