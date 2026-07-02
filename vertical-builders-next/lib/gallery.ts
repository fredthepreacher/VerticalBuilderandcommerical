import manifest from './gallery-manifest.json'

export interface GalleryImage {
  cat: string
  name: string
  w: number
  h: number
  tw: number
  th: number
  alt: string
}

export const GALLERY: GalleryImage[] = manifest as GalleryImage[]

export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'all', label: 'All Projects' },
  { id: 'roofing', label: 'Roofing & Storm' },
  { id: 'pools-outdoor', label: 'Pools & Outdoor' },
  { id: 'lanai', label: 'Lanais & Enclosures' },
  { id: 'interior', label: 'Interior Remodels' },
  { id: 'new-construction', label: 'New Construction' },
]

export const fullSrc = (img: GalleryImage) => `/gallery/${img.cat}/full/${img.name}.webp`
export const thumbSrc = (img: GalleryImage) => `/gallery/${img.cat}/thumb/${img.name}.webp`
