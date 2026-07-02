'use client'

import { useRef, useState } from 'react'

interface Props { src: string; poster: string; title: string }

export default function VideoShot({ src, poster, title }: Props) {
  const [playing, setPlaying] = useState(false)
  const ref = useRef<HTMLVideoElement>(null)

  const play = () => {
    if (!playing) {
      setPlaying(true)
      requestAnimationFrame(() => ref.current?.play())
    }
  }

  return (
    <div className="shot shot-video">
      {!playing && (
        <button className="play-btn" aria-label={`Play ${title} video`} onClick={play}>▶</button>
      )}
      <video ref={ref} src={src} poster={poster} preload="none" controls={playing} playsInline onClick={play} />
      <span className="label">Drone Video</span>
    </div>
  )
}
