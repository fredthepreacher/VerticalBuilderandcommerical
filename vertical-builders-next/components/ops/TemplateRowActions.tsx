'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, Copy, RotateCcw } from 'lucide-react'
import {
  archiveProposalTemplateAction, duplicateProposalTemplateAction,
} from '@/app/ops/actions/proposal-templates'

/** Edit / Duplicate / Archive for one template row. */
export default function TemplateRowActions({
  templateId,
  archived,
}: {
  templateId: string
  archived: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <Link className="ops-btn ops-btn-sm" href={`/ops/estimates/templates/${templateId}`}>Edit</Link>

      <button
        type="button" className="ops-btn ops-btn-sm" disabled={pending}
        title="Make an independent copy to adjust"
        onClick={() => start(async () => {
          const result = await duplicateProposalTemplateAction(templateId)
          if (result.ok === false) { setError(result.error ?? 'Could not duplicate.'); return }
          const id = result.data?.templateId
          if (typeof id === 'string' && id) router.push(`/ops/estimates/templates/${id}`)
          else router.refresh()
        })}
      >
        <Copy aria-hidden="true" /> Duplicate
      </button>

      <button
        type="button" className="ops-btn ops-btn-sm" disabled={pending}
        title={archived
          ? 'Bring this template back into the list'
          : 'Hide it from the picker. Estimates already built from it are unaffected.'}
        onClick={() => start(async () => {
          const result = await archiveProposalTemplateAction(templateId, archived)
          if (result.ok === false) { setError(result.error ?? 'Could not archive.'); return }
          router.refresh()
        })}
      >
        {archived
          ? <><RotateCcw aria-hidden="true" /> Restore</>
          : <><Archive aria-hidden="true" /> Archive</>}
      </button>

      {error && <span className="ops-error" style={{ display: 'block' }}>{error}</span>}
    </>
  )
}
