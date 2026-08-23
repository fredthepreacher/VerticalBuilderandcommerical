import type { Metadata } from 'next'
import { ShieldCheck } from 'lucide-react'
import { createSupabaseAdminClient } from '@/lib/ops/supabase/admin'
import { isOpsConfigured } from '@/lib/ops/supabase/env'
import { checkTokenState, hashToken } from '@/lib/ops/utils/tokens'
import { getSettings } from '@/lib/ops/services/settings'
import { DOCUMENT_TYPE_LABELS, type DocumentType } from '@/lib/ops/types'
import { formatDate } from '@/lib/ops/utils/dates'
import VendorUploadForm from '@/components/ops/VendorUploadForm'
import '../../../ops/ops.css'

/**
 * Public, unauthenticated upload page.
 *
 * Reached only with a 32-byte random token. It shows the company name and the
 * vendor's own name so the recipient can tell it is legitimate, and nothing
 * else — no other vendor data, no CRM navigation, no way in.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Upload your certificate — Vertical Builders & Commercial',
  robots: { index: false, follow: false, nocache: true },
}

export default async function VendorUploadPage({ params }: { params: { token: string } }) {
  if (!isOpsConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return <Invalid message="This upload service is temporarily unavailable. Please call the office at 941-877-2009." />
  }

  const admin = createSupabaseAdminClient()
  const { data: tokenRow } = await admin
    .from('upload_tokens')
    .select('id, vendor_id, requested_document_type, message, expires_at, used_at, revoked_at')
    .eq('token_hash', hashToken(params.token))
    .maybeSingle()

  const state = checkTokenState(
    tokenRow as { expires_at: string; revoked_at: string | null; used_at: string | null } | null,
  )
  if (!state.valid) return <Invalid message={state.message!} />

  const [{ data: vendor }, settings] = await Promise.all([
    admin.from('vendors').select('legal_name, contact_first_name').eq('id', tokenRow!.vendor_id).maybeSingle(),
    getSettings(admin),
  ])

  const requested = DOCUMENT_TYPE_LABELS[tokenRow!.requested_document_type as DocumentType]
    ?? 'certificate of insurance'

  return (
    <div className="ops">
      <main className="ops-portal">
        <div className="ops-portal-card">
          <header className="ops-portal-head">
            <div className="brand">
              <span className="ops-brand-mark" aria-hidden="true">V</span>
              <span className="ops-brand-text">
                <strong>Vertical Builders &amp; Commercial</strong>
                <span>Licensed General &amp; Roofing Contractor</span>
              </span>
            </div>
            <h1>Upload your {requested.toLowerCase()}</h1>
            <p>
              For <strong style={{ color: '#fff' }}>{vendor?.legal_name ?? 'your company'}</strong>.
              No account or login is needed — this link is just for you.
            </p>
          </header>

          <div className="ops-portal-body">
            {tokenRow!.message && (
              <div className="ops-banner info">
                <div>{tokenRow!.message as string}</div>
              </div>
            )}

            <VendorUploadForm
              token={params.token}
              vendorName={vendor?.legal_name ?? 'your company'}
              maxUploadMb={settings.max_upload_mb}
            />
          </div>

          <footer className="ops-portal-foot">
            <ShieldCheck aria-hidden="true" style={{ width: 15, height: 15, display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
            This link expires {formatDate(tokenRow!.expires_at as string)}. Your file is stored
            privately and is only visible to the Vertical Builders office.
            <br /><br />
            Questions? Call {settings.company_phone} or email {settings.company_email}.
            <br />
            You can forward this link to your insurance agent so they can upload it directly.
          </footer>
        </div>
      </main>
    </div>
  )
}

function Invalid({ message }: { message: string }) {
  return (
    <div className="ops">
      <main className="ops-portal">
        <div className="ops-portal-card">
          <header className="ops-portal-head">
            <div className="brand">
              <span className="ops-brand-mark" aria-hidden="true">V</span>
              <span className="ops-brand-text">
                <strong>Vertical Builders &amp; Commercial</strong>
                <span>Licensed General &amp; Roofing Contractor</span>
              </span>
            </div>
            <h1>This link is not usable</h1>
          </header>
          <div className="ops-portal-body">
            <div className="ops-banner bad" role="alert">
              <div>{message}</div>
            </div>
            <p style={{ fontSize: '.88rem' }}>
              Call the office at <a href="tel:+19418772009" style={{ color: 'var(--ops-accent)' }}>941-877-2009</a>{' '}
              or email <a href="mailto:Office@verticalbc.com" style={{ color: 'var(--ops-accent)' }}>Office@verticalbc.com</a>{' '}
              and we will send a new one.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
