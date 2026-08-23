import Link from 'next/link'
import { requireUser } from '@/lib/ops/auth/require-user'
import { createSupabaseServerClient } from '@/lib/ops/supabase/server'
import ProjectForm from '@/components/ops/ProjectForm'

export const dynamic = 'force-dynamic'

export default async function NewProjectPage({ searchParams }: { searchParams: { customer?: string } }) {
  await requireUser()
  const supabase = createSupabaseServerClient()
  const [{ data: customers }, { data: staff }] = await Promise.all([
    supabase.from('contacts').select('id, first_name, last_name, company_name')
      .is('archived_at', null).order('last_name').limit(500),
    supabase.from('profiles').select('id, full_name, email').eq('active', true).order('full_name'),
  ])

  return (
    <>
      <div className="ops-page-head">
        <div className="ops-titles">
          <div className="ops-eyebrow"><Link href="/ops/projects">Projects</Link> / New</div>
          <h1>New project</h1>
        </div>
      </div>
      <div style={{ maxWidth: 820 }}>
        <ProjectForm
          project={searchParams.customer ? { customer_id: searchParams.customer } : undefined}
          customers={(customers ?? []).map(c => ({
            id: c.id as string,
            label: [c.first_name, c.last_name].filter(Boolean).join(' ') || (c.company_name as string) || 'Unnamed',
          }))}
          staff={(staff ?? []).map(s => ({ id: s.id as string, label: (s.full_name as string) || (s.email as string) }))}
        />
      </div>
    </>
  )
}
