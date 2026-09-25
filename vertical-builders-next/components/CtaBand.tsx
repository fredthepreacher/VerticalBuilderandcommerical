import Link from 'next/link'
import { BIZ } from '@/lib/data'

interface Props { title: string; text: string; cta: string; href?: string; showPhone?: boolean }

export default function CtaBand({ title, text, cta, href = '/contact', showPhone = true }: Props) {
  return (
    <section className="section financing pitch-top">
      <div className="container" data-reveal>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="cta-band-actions">
          <Link className="btn btn-accent btn-lg" href={href}>{cta}</Link>
          {showPhone && <a className="btn btn-outline btn-lg" href={BIZ.phoneHref}>Call {BIZ.phone}</a>}
        </div>
      </div>
    </section>
  )
}
