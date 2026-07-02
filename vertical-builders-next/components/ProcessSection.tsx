import { STEPS } from '@/lib/data'

export default function ProcessSection() {
  return (
    <section className="section">
      <div className="container">
        <span className="kicker">How It Works</span>
        <h2>A Simple, Permitted, Professional Process</h2>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div className="step" key={s.title}>
              <div className="num">{i + 1}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
