import { LEGACY_REDIRECTS } from './lib/redirects.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  async redirects() {
    return LEGACY_REDIRECTS.map(r => ({ ...r, permanent: true }))
  },
}
export default nextConfig
