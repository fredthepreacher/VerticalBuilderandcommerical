import type { Metadata } from 'next'
import HomeHero from '@/components/HomeHero'
import TrustBar from '@/components/TrustBar'
import OneContractor from '@/components/OneContractor'
import PillarCards from '@/components/PillarCards'
import AnswerBlock from '@/components/AnswerBlock'
import ProjectShowcase from '@/components/ProjectShowcase'
import PermitSpotlight from '@/components/PermitSpotlight'
import ProcessSection from '@/components/ProcessSection'
import CtaBand from '@/components/CtaBand'
import ReviewsSection from '@/components/ReviewsSection'
import AreasSection from '@/components/AreasSection'
import FaqSection from '@/components/FaqSection'
import { pageMeta } from '@/lib/seo'

export const metadata: Metadata = pageMeta({
  title: 'Vertical Builders & Commercial | Roofing & General Contractor, SW Florida',
  absoluteTitle: true,
  description:
    'Licensed roofing and general contractor in Nokomis, FL. Roofs, storm and ceiling repair, pools, lanais, remodels and permit help across Southwest Florida. Free estimates.',
  path: '/',
})

// Funnel: understand (hero) → trust (licenses) → differentiate (one contractor)
// → explore (services) → prove (projects, permits, reviews) → reassure
// (process, financing) → local relevance → quotable facts → objections (FAQ).
export default function HomePage() {
  return (
    <>
      <HomeHero />
      <TrustBar />
      <OneContractor />
      <PillarCards />
      <ProjectShowcase />
      <PermitSpotlight />
      <ReviewsSection />
      <ProcessSection />
      <CtaBand
        title="Ask about 0% financing options"
        text="Financing options are available for qualifying projects, including 0% plans for qualified buyers. Ask us what your project qualifies for."
        cta="Ask About Financing"
      />
      <AreasSection />
      <AnswerBlock />
      <FaqSection />
    </>
  )
}
