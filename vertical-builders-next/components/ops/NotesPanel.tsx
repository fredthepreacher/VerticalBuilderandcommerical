'use client'

import { ActionForm, SubmitButton } from './Form'
import { addNote } from '@/app/ops/actions/crm'
import { formatDateTime } from '@/lib/ops/utils/dates'

export interface NoteItem {
  id: string
  body: string
  created_at: string
  author: string
}

export default function NotesPanel({
  entityType,
  entityId,
  notes,
}: {
  entityType: string
  entityId: string
  notes: NoteItem[]
}) {
  return (
    <section className="ops-card">
      <div className="ops-card-head"><h2>Notes</h2></div>
      <div className="ops-card-body">
        <ActionForm action={addNote}>
          {state => (
            <>
              <input type="hidden" name="entity_type" value={entityType} />
              <input type="hidden" name="entity_id" value={entityId} />
              <div className="ops-field">
                <label htmlFor={`note-${entityId}`}>Add a note</label>
                <textarea
                  id={`note-${entityId}`}
                  name="body"
                  rows={3}
                  className="ops-textarea"
                  placeholder="Called, left voicemail. Following up Thursday…"
                  aria-invalid={state.fieldErrors?.body ? 'true' : undefined}
                />
                {state.fieldErrors?.body && <p className="ops-error">{state.fieldErrors.body[0]}</p>}
              </div>
              <SubmitButton className="ops-btn ops-btn-sm ops-btn-dark" pendingLabel="Adding…">Add note</SubmitButton>
            </>
          )}
        </ActionForm>

        {notes.length > 0 && (
          <ul style={{ display: 'grid', gap: 12, marginTop: 20 }}>
            {notes.map(note => (
              <li key={note.id} style={{ borderTop: '1px solid var(--ops-line)', paddingTop: 12 }}>
                <p style={{ fontSize: '.86rem', color: 'var(--ops-ink)', whiteSpace: 'pre-wrap' }}>{note.body}</p>
                <p className="ops-hint" style={{ marginTop: 4 }}>
                  {note.author} · {formatDateTime(note.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
