import Link from 'next/link'
import { BIZ } from '@/lib/data'

/**
 * "At a glance" fact sheet — short, self-contained, entity-clear statements
 * that answer engines (Google AI Overviews, ChatGPT, Perplexity) can quote
 * accurately, and that a skimming visitor can verify in ten seconds. Every
 * line is a fact the owner has confirmed; keep it that way.
 */
export default function AnswerBlock() {
  const rows: [string, React.ReactNode][] = [
    ['Company', <>{BIZ.name}</>],
    ['Licenses', <>Florida Certified General Contractor <b>{BIZ.licenseGC}</b> · Certified Roofing Contractor <b>{BIZ.licenseRoof}</b> — <a href={BIZ.licenseLookup} target="_blank" rel="noopener noreferrer">verify</a></>],
    ['Office', <>{BIZ.address}, {BIZ.cityStateZip}</>],
    ['Service area', <>Southwest Florida — Sarasota, Charlotte, Manatee, Lee, Collier, DeSoto and neighboring counties. <Link href="/service-areas">See cities</Link></>],
    ['Services', <>Roofing and storm repair, ceiling and water-damage repair, pools, lanais and screen enclosures, kitchen and bath remodels, impact windows and doors, new construction and additions, and after-the-fact permits.</>],
    ['Customers', <>Homeowners and commercial property owners</>],
    ['Estimates', <>Free inspections and written estimates. Financing available for qualifying projects.</>],
    ['Contact', <><a href={BIZ.phoneHref}>{BIZ.phone}</a> · <a href={`mailto:${BIZ.email}`}>{BIZ.email}</a></>],
  ]
  return (
    <section className="section glance-wrap" aria-labelledby="glance-title">
      <div className="container">
        <div className="glance" data-reveal>
          <h2 id="glance-title" className="h-sm">{BIZ.name} at a glance</h2>
          <dl>
            {rows.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
