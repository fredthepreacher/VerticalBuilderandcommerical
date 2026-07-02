import Image from 'next/image'
import Link from 'next/link'
import VideoShot from './VideoShot'

export interface Shot { img: string; alt: string; label?: string; after?: boolean }
export interface Project {
  title: string
  desc: string
  shots: Shot[]
  video?: { src: string; poster: string }
}

const HOME_PROJECTS: Project[] = [
  {
    title: 'Storm Damage to Finished Roof',
    desc: 'From emergency tarp through dry-in and full shingle replacement.',
    shots: [
      { img: '/images/roof-storm-tarp.webp', label: 'Storm Tarp', alt: 'Storm-damaged roof protected with blue tarp before replacement' },
      { img: '/images/roof-crew-progress.webp', label: 'Install', alt: 'Roofing crew installing new roof with underlayment' },
      { img: '/images/roof-finished-aerial.webp', label: 'Completed', after: true, alt: 'Completed new shingle roof, aerial drone view' },
    ],
  },
  {
    title: 'Waterfront Pool & Spa Build',
    desc: 'Gunite shell to finished pool, spa, tile, and coping on the water.',
    video: { src: '/videos/pool-build.mp4', poster: '/images/pool-spa-tile-work.webp' },
    shots: [
      { img: '/images/pool-construction-aerial.webp', label: 'Before', alt: 'Pool shell under construction, aerial view' },
      { img: '/images/pool-spa-finished.webp', label: 'After', after: true, alt: 'Finished waterfront pool and spa with blue mosaic tile' },
    ],
  },
  {
    title: 'Interior Remodels & Finishes',
    desc: 'Kitchens, bathrooms, and interior repairs finished to move-in quality.',
    shots: [
      { img: '/images/kitchen-remodel.webp', alt: 'Remodeled white kitchen with large island' },
      { img: '/images/bathroom-remodel.webp', alt: 'Remodeled bathroom with tiled tub and shower' },
      { img: '/images/lanai-outdoor-living.webp', alt: 'Furnished screened lanai outdoor living space' },
    ],
  },
]

export default function ProjectShowcase() {
  return (
    <section className="section work">
      <div className="container">
        <span className="kicker">Real Projects, Real Proof</span>
        <h2>Featured Work Across Southwest Florida</h2>
        <p className="section-intro">Every photo and video is our own crew&apos;s work — no stock imagery.</p>
        {HOME_PROJECTS.map(p => (
          <div className="project" key={p.title}>
            <div className="project-head">
              <h3>{p.title}</h3>
              <p>{p.desc}</p>
            </div>
            <div className="project-grid">
              {p.shots.map(s => (
                <div className="shot" key={s.img}>
                  {s.label && <span className={`label${s.after ? ' after' : ''}`}>{s.label}</span>}
                  <Image src={s.img} alt={s.alt} fill sizes="(max-width: 960px) 100vw, 33vw" loading="lazy" style={{ objectFit: 'cover' }} />
                </div>
              ))}
              {p.video && <VideoShot src={p.video.src} poster={p.video.poster} title={p.title} />}
            </div>
          </div>
        ))}
        <p style={{ marginTop: 28 }}>
          <Link className="btn btn-dark" href="/gallery">Browse the Full Project Gallery →</Link>
        </p>
      </div>
    </section>
  )
}
