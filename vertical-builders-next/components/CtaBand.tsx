import Link from 'next/link'

interface Props { title: string; text: string; cta: string; href?: string }

export default function CtaBand({ title, text, cta, href = '/contact' }: Props) {
  return (
    <section className="section financing">
      <div className="container">
        <h2>{title}</h2>
        <p>{text}</p>
        <Link className="btn btn-accent" href={href}>{cta}</Link>
      </div>
    </section>
  )
}
