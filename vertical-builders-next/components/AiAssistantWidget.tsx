'use client'

/**
 * AiAssistantWidget — placeholder for the future AI lead assistant.
 *
 * TODAY: a floating brand button that opens a small panel with a friendly
 * greeting and quick actions (call / request estimate). No API keys needed;
 * nothing breaks if none exist.
 *
 * FUTURE AI INTEGRATION (see README "AI Assistant" section):
 *  1. Create app/api/assistant/route.ts that streams chat completions
 *     (e.g. Anthropic Claude) using process.env.ANTHROPIC_API_KEY.
 *  2. Replace the static message list below with a real chat state
 *     (messages[], input box, POST to /api/assistant).
 *  3. Keep the quick-action buttons — "call now" and "request estimate"
 *     are the highest-value conversions even mid-conversation.
 */

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { BIZ } from '@/lib/data'

export default function AiAssistantWidget() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {open && (
        <div className="ai-panel" role="dialog" aria-label="Project assistant">
          <div className="ai-head">
            <Image src="/brand/logo-mark.png" alt="" width={34} height={34} />
            <div>
              <h3>Vertical Project Assistant</h3>
              <p>Typically replies same business day</p>
            </div>
          </div>
          <div className="ai-body">
            <div className="ai-msg">
              👋 Hi! I&apos;m the Vertical Builders assistant. I can help you figure out
              the next step for your roofing, repair, or outdoor project.
            </div>
            <div className="ai-msg">
              Live chat is coming soon. In the meantime, the fastest ways to get help:
            </div>
          </div>
          <div className="ai-actions">
            <a className="primary" href={BIZ.phoneHref}>📞 Call {BIZ.phone}</a>
            <Link className="secondary" href="/contact" onClick={() => setOpen(false)}>Request a Free Estimate</Link>
          </div>
          <p className="ai-note">AI assistant launching soon — no bots were harmed in this preview.</p>
        </div>
      )}
      <button className="ai-fab" aria-label={open ? 'Close assistant' : 'Open project assistant'} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? <span style={{ color: '#fff', fontSize: '1.6rem', lineHeight: 1 }}>×</span> : <Image src="/brand/logo-mark.png" alt="" width={34} height={34} />}
      </button>
    </>
  )
}
