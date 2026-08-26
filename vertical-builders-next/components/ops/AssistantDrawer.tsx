'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Sparkles, Gauge, X, Send, RotateCcw, Trash2, AlertTriangle, Info, Copy, Check,
} from 'lucide-react'
import { suggestedPrompts } from '@/lib/ops/ai/suggestions'
import type { AiProposal } from '@/lib/ops/ai/schemas'
import type { SmartOpsResponse } from '@/lib/ops/smart/types'

/**
 * ============================================================================
 * THE VERTICAL ASSISTANT
 * ----------------------------------------------------------------------------
 * One drawer, two modes, and the badge always says which one you are getting.
 *
 *   Smart Ops    — built-in. Live CRM data and business rules. No AI provider,
 *                  no per-question cost. Always available.
 *   AI Enhanced  — the generative Copilot, for free-form questions. Only when
 *                  an OpenAI key is configured.
 *
 * The rule the UI enforces: never let a deterministic answer look generative,
 * and never let a generative answer look authoritative. A Smart Ops reply is
 * labelled "Built-in"; an AI reply is labelled "AI-generated" and carries the
 * check-before-acting warning. Blurring those two would be the easiest way to
 * lose a compliance client's trust.
 * ============================================================================
 */

interface Turn {
  role: 'user' | 'assistant'
  content: string
  /** A deterministic answer. Mutually exclusive with the AI fields below. */
  smart?: SmartOpsResponse | null
  citedRecords?: { kind: string; id: string; label: string }[]
  proposal?: AiProposal | null
  limitation?: string | null
  failed?: boolean
  /** Which half produced this turn — drives the label. */
  source?: 'smart_ops' | 'ai_enhanced'
}

const RECORD_HREF: Record<string, string> = {
  lead: '/ops/leads', contact: '/ops/contacts', project: '/ops/projects',
  vendor: '/ops/subcontractors', invoice: '/ops/invoices', estimate: '/ops/estimates',
  task: '/ops/tasks',
}

export default function AssistantDrawer({
  aiConfigured,
  aiEnabled,
  canSeeFinancials,
  canWrite,
}: {
  aiConfigured: boolean
  aiEnabled: boolean
  canSeeFinancials: boolean
  canWrite: boolean
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastQuestion, setLastQuestion] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const aiActivated = aiConfigured && aiEnabled
  const chips = suggestedPrompts(pathname ?? '', { canSeeFinancials, canWrite })

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function ask(question: string, preferAi = false) {
    const trimmed = question.trim()
    if (!trimmed || busy) return
    setInput('')
    setLastQuestion(trimmed)
    setTurns(t => [...t, { role: 'user', content: trimmed }])
    setBusy(true)

    try {
      const response = await fetch('/api/ops/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          pageContext: pathname ?? undefined,
          preferAi,
          history: turns.filter(t => !t.failed && !t.smart).slice(-8).map(t => ({ role: t.role, content: t.content })),
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        setTurns(t => [...t, {
          role: 'assistant',
          content: data.error ?? 'The assistant is unavailable.',
          failed: true,
        }])
      } else if (data.mode === 'smart_ops') {
        setTurns(t => [...t, {
          role: 'assistant', content: '', smart: data.smart as SmartOpsResponse, source: 'smart_ops',
        }])
      } else {
        setTurns(t => [...t, {
          role: 'assistant',
          content: data.reply ?? '',
          citedRecords: data.citedRecords ?? [],
          proposal: data.proposal ?? null,
          limitation: data.limitation ?? null,
          source: 'ai_enhanced',
        }])
      }
    } catch {
      setTurns(t => [...t, {
        role: 'assistant',
        content: 'Could not reach the assistant. Your work is unaffected.',
        failed: true,
      }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="ops-btn ops-btn-sm ops-ai-trigger"
        onClick={() => setOpen(true)}
        title="Vertical Assistant"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {aiActivated ? <Sparkles aria-hidden="true" /> : <Gauge aria-hidden="true" />}
        <span className="ops-ai-trigger-label">Vertical Assistant</span>
      </button>

      {open && (
        <>
          <div className="ops-ai-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="ops-ai-drawer" role="dialog" aria-modal="true" aria-label="Vertical Assistant">
            <header className="ops-ai-head">
              {aiActivated
                ? <Sparkles aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-accent)' }} />
                : <Gauge aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--ops-accent)' }} />}
              <div>
                <strong>
                  Vertical Assistant{' '}
                  <ModeBadge activated={aiActivated} />
                </strong>
                <span className="ops-ai-context">{contextLabel(pathname ?? '')}</span>
              </div>
              <div className="ops-ai-head-actions">
                {turns.length > 0 && (
                  <button type="button" className="ops-btn ops-btn-sm ops-btn-ghost"
                    onClick={() => { setTurns([]); setLastQuestion(null) }} title="Clear conversation">
                    <Trash2 aria-hidden="true" />
                  </button>
                )}
                <button type="button" className="ops-btn ops-btn-sm ops-btn-ghost"
                  onClick={() => setOpen(false)} aria-label="Close assistant">
                  <X aria-hidden="true" />
                </button>
              </div>
            </header>

            <p className="ops-ai-mode-note">
              {aiActivated
                ? 'AI-enhanced answers grounded in permitted CRM data. Built-in commands are answered directly, without using the AI service.'
                : 'Built-in · Uses live CRM data and business rules. No AI API usage.'}
            </p>

            <div className="ops-ai-body">
              {turns.length === 0 && (
                <div className="ops-ai-welcome">
                  <p>
                    Ask about compliance, leads, jobs and paperwork — or run a quick calculation.
                    I only see what your account can see.
                  </p>
                  <div className="ops-ai-chips">
                    {chips.map(chip => (
                      <button key={chip} type="button" className="ops-chip ops-chip-link" onClick={() => ask(chip)}>
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map((turn, i) => (
                <div key={i} className={`ops-ai-turn is-${turn.role}${turn.failed ? ' is-failed' : ''}`}>
                  {turn.role === 'assistant' && (
                    <span className={`ops-ai-label${turn.source === 'smart_ops' ? ' is-smart' : ''}`}>
                      {turn.source === 'smart_ops'
                        ? <><Gauge aria-hidden="true" /> Built-in · from your CRM data</>
                        : <><Sparkles aria-hidden="true" /> AI-generated</>}
                    </span>
                  )}

                  {turn.smart
                    ? <SmartAnswer response={turn.smart} onCommand={c => ask(c)} onClose={() => setOpen(false)} />
                    : <div className="ops-ai-text">{turn.content}</div>}

                  {turn.limitation && (
                    <p className="ops-ai-limitation">
                      <Info aria-hidden="true" /> {turn.limitation}
                    </p>
                  )}

                  {turn.citedRecords && turn.citedRecords.length > 0 && (
                    <div className="ops-ai-cites">
                      {turn.citedRecords.map(record => (
                        <Link
                          key={`${record.kind}-${record.id}`}
                          href={`${RECORD_HREF[record.kind] ?? '/ops'}/${record.id}`}
                          className="ops-chip ops-chip-link"
                          onClick={() => setOpen(false)}
                        >
                          {record.label}
                        </Link>
                      ))}
                    </div>
                  )}

                  {turn.proposal && <ProposalCard proposal={turn.proposal} />}
                </div>
              ))}

              {busy && (
                <div className="ops-ai-turn is-assistant">
                  <div className="ops-ai-text ops-ai-thinking">Looking through your records…</div>
                </div>
              )}

              {!busy && lastQuestion && turns[turns.length - 1]?.failed && (
                <button type="button" className="ops-btn ops-btn-sm" onClick={() => ask(lastQuestion)}>
                  <RotateCcw aria-hidden="true" /> Try again
                </button>
              )}

              {/* Offered only when the last answer was the built-in help, so the
                  user has a way through for a question the parser did not know. */}
              {!busy && aiActivated && lastQuestion && turns[turns.length - 1]?.smart?.intent === 'help' && (
                <button type="button" className="ops-btn ops-btn-sm" onClick={() => ask(lastQuestion, true)}>
                  <Sparkles aria-hidden="true" /> Ask AI instead
                </button>
              )}

              <div ref={endRef} />
            </div>

            <footer className="ops-ai-foot">
              <form onSubmit={e => { e.preventDefault(); ask(input) }} className="ops-ai-form">
                <textarea
                  ref={inputRef}
                  className="ops-ai-input"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input) }
                  }}
                  placeholder={aiActivated ? 'Ask anything about your CRM…' : 'Ask a built-in question, or type "help"…'}
                  rows={2}
                  maxLength={4000}
                  disabled={busy}
                  aria-label="Ask the Vertical Assistant"
                />
                <button type="submit" className="ops-btn ops-btn-primary ops-btn-sm"
                  disabled={busy || !input.trim()} aria-label="Send">
                  <Send aria-hidden="true" />
                </button>
              </form>
              <p className="ops-ai-disclaimer">
                <AlertTriangle aria-hidden="true" />
                {aiActivated
                  ? 'AI can be wrong. The CRM records are authoritative — check anything before acting on it.'
                  : 'Built-in answers come straight from your CRM records. Nothing is sent to an AI provider.'}
              </p>
            </footer>
          </aside>
        </>
      )}
    </>
  )
}

function ModeBadge({ activated }: { activated: boolean }) {
  return (
    <span className={`ops-mode-badge${activated ? ' is-ai' : ''}`}>
      {activated ? 'AI Enhanced' : 'Smart Ops'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Deterministic answer rendering
// ---------------------------------------------------------------------------

function SmartAnswer({
  response, onCommand, onClose,
}: {
  response: SmartOpsResponse
  onCommand: (command: string) => void
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="ops-smart-answer">
      <div className="ops-smart-head">{response.title}</div>
      <p className="ops-ai-text">{response.summary}</p>

      {response.facts && response.facts.length > 0 && (
        <div className="ops-smart-facts">
          {response.facts.map(fact => (
            <div key={fact.label} className={`ops-smart-fact tone-${fact.tone ?? 'neutral'}`}>
              <span className="ops-smart-fact-value">{fact.value}</span>
              <span className="ops-smart-fact-label">{fact.label}</span>
            </div>
          ))}
        </div>
      )}

      {response.copyText && (
        <>
          <pre className="ops-smart-copy">{response.copyText}</pre>
          <button
            type="button" className="ops-btn ops-btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(response.copyText ?? '').then(() => {
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }).catch(() => undefined)
            }}
          >
            {copied ? <><Check aria-hidden="true" /> Copied</> : <><Copy aria-hidden="true" /> Copy message</>}
          </button>
        </>
      )}

      {response.items && response.items.length > 0 && (
        <ul className="ops-smart-items">
          {response.items.map((item, i) => (
            <li key={item.id ?? `${item.title}-${i}`}>
              {item.href
                ? <Link href={item.href} className="ops-smart-item-title" onClick={onClose}>{item.title}</Link>
                : <span className="ops-smart-item-title">{item.title}</span>}
              {item.status && <span className="ops-smart-item-status">{item.status}</span>}
              {item.subtitle && <span className="ops-smart-item-sub">{item.subtitle}</span>}
            </li>
          ))}
        </ul>
      )}

      {response.notices?.map(notice => (
        <p key={notice} className="ops-ai-limitation"><Info aria-hidden="true" /> {notice}</p>
      ))}

      {response.suggestedActions && response.suggestedActions.length > 0 && (
        <div className="ops-ai-chips">
          {response.suggestedActions.map(action => (
            action.href
              ? <Link key={action.label} href={action.href} className="ops-chip ops-chip-link" onClick={onClose}>{action.label}</Link>
              : <button key={action.label} type="button" className="ops-chip ops-chip-link"
                  onClick={() => action.command && onCommand(action.command)}>{action.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A proposed write, rendered as something to read rather than something to
 * click. Creating the record is a deliberate trip to the real form — the
 * assistant never gets a one-click path into the database.
 */
function ProposalCard({ proposal }: { proposal: AiProposal }) {
  const [copied, setCopied] = useState(false)

  if (proposal.type === 'draft_message') {
    const text = proposal.subject ? `${proposal.subject}\n\n${proposal.body}` : proposal.body
    return (
      <div className="ops-ai-proposal">
        <div className="ops-ai-proposal-head">Draft message — nothing has been sent</div>
        {proposal.subject && <p className="ops-ai-proposal-subject">{proposal.subject}</p>}
        <p className="ops-ai-proposal-body">{proposal.body}</p>
        <button
          type="button" className="ops-btn ops-btn-sm"
          onClick={() => {
            navigator.clipboard?.writeText(text).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }).catch(() => undefined)
          }}
        >
          {copied ? 'Copied' : 'Copy message'}
        </button>
      </div>
    )
  }

  if (proposal.type === 'create_lead') {
    const entries = Object.entries(proposal.fields).filter(([, v]) => v)
    const query = new URLSearchParams()
    for (const [key, value] of entries) query.set(key, String(value))
    return (
      <div className="ops-ai-proposal">
        <div className="ops-ai-proposal-head">Proposed lead — review before creating</div>
        <dl className="ops-ai-proposal-fields">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key.replace(/_/g, ' ')}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
        {proposal.warnings.length > 0 && (
          <ul className="ops-ai-proposal-warnings">
            {proposal.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        <Link className="ops-btn ops-btn-sm ops-btn-primary" href={`/ops/leads/new?${query.toString()}`}>
          Review &amp; create
        </Link>
        <p className="ops-hint">Opens the normal new-lead form with these values filled in. Nothing is saved until you save it.</p>
      </div>
    )
  }

  return (
    <div className="ops-ai-proposal">
      <div className="ops-ai-proposal-head">Proposed task — review before creating</div>
      <dl className="ops-ai-proposal-fields">
        <div><dt>title</dt><dd>{proposal.title}</dd></div>
        {proposal.due_date && <div><dt>due</dt><dd>{proposal.due_date}</dd></div>}
        <div><dt>priority</dt><dd>{proposal.priority}</dd></div>
        {proposal.notes && <div><dt>notes</dt><dd>{proposal.notes}</dd></div>}
      </dl>
      <Link
        className="ops-btn ops-btn-sm ops-btn-primary"
        href={`/ops/tasks?title=${encodeURIComponent(proposal.title)}&priority=${proposal.priority}${proposal.due_date ? `&due=${proposal.due_date}` : ''}`}
      >
        Create task
      </Link>
      <p className="ops-hint">Opens the task screen with these values. Nothing is saved until you save it.</p>
    </div>
  )
}

function contextLabel(pathname: string): string {
  if (pathname.startsWith('/ops/subcontractors')) return 'Subcontractors'
  if (pathname.startsWith('/ops/compliance')) return 'Compliance'
  if (pathname.startsWith('/ops/audits')) return 'Audit Center'
  if (pathname.startsWith('/ops/leads')) return 'Leads'
  if (pathname.startsWith('/ops/projects')) return 'Jobs'
  if (pathname.startsWith('/ops/schedule')) return 'Schedule'
  if (pathname.startsWith('/ops/estimates')) return 'Estimates'
  if (pathname.startsWith('/ops/invoices')) return 'Invoices'
  if (pathname.startsWith('/ops/tasks')) return 'Tasks'
  return 'Vertical Ops'
}
