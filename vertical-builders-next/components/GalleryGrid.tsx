'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { CATEGORIES, GALLERY, fullSrc, thumbSrc, type GalleryImage } from '@/lib/gallery'

export default function GalleryGrid() {
  const [cat, setCat] = useState('all')
  const [lightbox, setLightbox] = useState<number | null>(null)

  const images = useMemo(
    () => (cat === 'all' ? GALLERY : GALLERY.filter(g => g.cat === cat)),
    [cat]
  )

  const close = useCallback(() => setLightbox(null), [])
  const step = useCallback(
    (dir: 1 | -1) => setLightbox(i => (i === null ? null : (i + dir + images.length) % images.length)),
    [images.length]
  )

  useEffect(() => {
    if (lightbox === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      if (e.key === 'ArrowRight') step(1)
      if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, close, step])

  const active: GalleryImage | null = lightbox === null ? null : images[lightbox]

  return (
    <>
      <div className="gallery-filters" role="tablist" aria-label="Project categories">
        {CATEGORIES.map(c => (
          <button
            key={c.id}
            role="tab"
            aria-selected={cat === c.id}
            className={cat === c.id ? 'active' : ''}
            onClick={() => { setCat(c.id); setLightbox(null) }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="gallery-count">{images.length} project photos</p>
      <div className="gallery-grid">
        {images.map((img, i) => (
          <button className="gallery-item" key={`${img.cat}/${img.name}`} onClick={() => setLightbox(i)} aria-label={`View larger: ${img.alt}`}>
            <Image src={thumbSrc(img)} alt={img.alt} width={img.tw} height={img.th} loading="lazy" sizes="(max-width: 760px) 50vw, (max-width: 1080px) 33vw, 25vw" />
          </button>
        ))}
      </div>
      {active && (
        <div className="lightbox" onClick={close} role="dialog" aria-modal="true" aria-label={active.alt}>
          <button className="lightbox-close" aria-label="Close" onClick={close}>×</button>
          <button className="lightbox-nav lightbox-prev" aria-label="Previous photo" onClick={e => { e.stopPropagation(); step(-1) }}>‹</button>
          {/* eslint-disable-next-line @next/next/no-img-element -- full-res lightbox image, intentionally unoptimized */}
          <img src={fullSrc(active)} alt={active.alt} onClick={e => e.stopPropagation()} />
          <button className="lightbox-nav lightbox-next" aria-label="Next photo" onClick={e => { e.stopPropagation(); step(1) }}>›</button>
          <p className="lightbox-caption">{active.alt}</p>
        </div>
      )}
    </>
  )
}
