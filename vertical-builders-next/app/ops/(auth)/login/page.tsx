import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import LoginForm from '@/components/ops/LoginForm'
import { getOptionalUser } from '@/lib/ops/auth/require-user'
import { isOpsConfigured } from '@/lib/ops/supabase/env'

export const dynamic = 'force-dynamic'

const ERROR_MESSAGES: Record<string, string> = {
  'no-profile': 'That account exists but has no Vertical Ops profile yet. Ask an administrator to add you.',
  deactivated: 'That account has been deactivated. Contact an administrator.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string }
}) {
  const configured = isOpsConfigured()

  if (configured) {
    const user = await getOptionalUser()
    if (user) redirect(searchParams.next || '/ops/dashboard')
  }

  const notice = searchParams.error ? ERROR_MESSAGES[searchParams.error] : null

  return (
    <div className="ops-login">
      <aside className="ops-login-aside">
        <div>
          <div className="ops-brand" style={{ padding: 0, border: 0, marginBottom: 34 }}>
            <span className="ops-brand-mark" aria-hidden="true">V</span>
            <span className="ops-brand-text">
              <strong>Vertical Ops</strong>
              <span>CRM + Compliance Center</span>
            </span>
          </div>
          <h2>Every subcontractor,<br />every certificate,<br />audit-ready.</h2>
          <ul>
            {[
              'Website leads land here the moment they are submitted',
              'Certificates tracked policy line by policy line, not one date per PDF',
              'Renewal requests vendors can answer from their phone',
              'Six-month audit package generated as one organized ZIP',
            ].map(item => (
              <li key={item}>
                <CheckCircle2 aria-hidden="true" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <footer>
          Vertical Builders &amp; Commercial · Nokomis, FL<br />
          CGC1528626 · CCC1333649 · 941-877-2009<br />
          <Link href="/" style={{ color: '#8fa0b0', textDecoration: 'underline' }}>
            Back to the public website
          </Link>
        </footer>
      </aside>

      <main className="ops-login-main">
        <div className="ops-login-form">
          <h1>Sign in</h1>
          <p>Internal access for Vertical Builders &amp; Commercial staff.</p>

          {!configured && (
            <div className="ops-banner warn" role="status">
              <div>
                <strong>Vertical Ops is not connected yet</strong>
                Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{' '}
                in the deployment environment, then reload. See <code>docs/DEPLOYMENT.md</code>.
              </div>
            </div>
          )}

          {notice && (
            <div className="ops-banner bad" role="alert">
              <div>{notice}</div>
            </div>
          )}

          {configured && <LoginForm next={searchParams.next} />}

          <p className="ops-hint" style={{ marginTop: 22 }}>
            The public website at verticalbuildersandcommercial.com is unaffected by this login.
          </p>
        </div>
      </main>
    </div>
  )
}
