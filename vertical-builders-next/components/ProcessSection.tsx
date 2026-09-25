import { STEPS } from '@/lib/data'

export default function ProcessSection() {
  return (
    <section className="section">
      <div className="container">
        <span className="kicker">How it works</span>
        <h2>Five steps, no surprises</h2>
        <p className="section-intro">Nothing is scheduled or charged until you&rsquo;ve seen a written scope and approved it.</p>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li className="step" key={s.title} data-reveal style={{ ['--d' as string]: `${i * 70}ms` }}>
              <div className="num">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
