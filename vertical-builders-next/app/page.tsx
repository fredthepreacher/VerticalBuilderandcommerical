import HomeHero from '@/components/HomeHero'
import TrustBar from '@/components/TrustBar'
import PillarCards from '@/components/PillarCards'
import ProjectShowcase from '@/components/ProjectShowcase'
import ProcessSection from '@/components/ProcessSection'
import CtaBand from '@/components/CtaBand'
import ReviewsSection from '@/components/ReviewsSection'
import AreasSection from '@/components/AreasSection'
import FaqSection from '@/components/FaqSection'

export default function HomePage() {
  return (
    <>
      <HomeHero />
      <TrustBar />
      <PillarCards />
      <ProjectShowcase />
      <ProcessSection />
      <CtaBand
        title="Ask About 0% Financing Options"
        text="Financing options are available for qualifying projects, including 0% plans for qualified buyers. Ask us what your project qualifies for."
        cta="Ask About Financing"
      />
      <ReviewsSection />
      <AreasSection />
      <FaqSection />
    </>
  )
}
