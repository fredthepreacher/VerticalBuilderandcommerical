import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import ContactForm from '@/components/ops/ContactForm'

export const dynamic = 'force-dynamic'

export default async function NewContactPage() {
  await requireUser()
  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/contacts">Contacts</Link> / New</div>
          <h1>New contact</h1>
        </div>
      </div>
      <div style={{ maxWidth: 720 }}><ContactForm /></div>
    </>
  )
}
