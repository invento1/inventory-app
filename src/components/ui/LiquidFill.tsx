import { useEffect, useRef } from 'react'
import { cn } from '../../lib/cn'

// A pool of tinted "liquid" along the bottom of a card (the dashboard stat
// tiles). At rest the surface ripples gently; hovering, moving across, or
// clicking the card sloshes it like a shaken glass, and it settles back.
//
// How it works:
// - One small <canvas> per card, drawn in currentColor. The caller picks the
//   hue with a text colour class, e.g. "text-success-600".
// - The slosh is two damped springs: a tilt mode (the level rises on one side
//   and falls on the other) and a faster centre mode. Pointer events on the
//   parent card kick them. On top of that runs a slow travelling ripple.
// - The loop pauses while the card is off screen or the tab is hidden. Under
//   prefers-reduced-motion it draws a still surface and never animates.
// - The parent must be `relative overflow-hidden` and listens for the pointer
//   events. Content that should sit above the liquid needs `relative z-10`.

interface Spring {
  p: number // displacement, roughly -1..1
  v: number // velocity
}

const TILT = { freq: 1.45, damping: 0.11 } // Hz, damping ratio
const CENTRE = { freq: 2.6, damping: 0.14 }
const LEVEL = 0.42 // resting surface, as a fraction of the canvas height from the top
const TILT_HEIGHT = 0.34 // edge rise at |p| = 1, as a fraction of the canvas height
const CENTRE_HEIGHT = 0.14
const RIPPLE_PX = 1.8 // ambient ripple amplitude, CSS px

function step(s: Spring, { freq, damping }: typeof TILT, dt: number) {
  const w = 2 * Math.PI * freq
  const a = -w * w * s.p - 2 * damping * w * s.v
  s.v += a * dt
  s.p += s.v * dt
  // Keep an over-excited card from sloshing out of the canvas.
  s.p = Math.max(-1.1, Math.min(1.1, s.p))
}

// Resolves any CSS colour (hex, rgb, oklch...) to rgb bytes.
function toRgb(color: string): [number, number, number] {
  const c = document.createElement('canvas')
  c.width = c.height = 1
  const ctx = c.getContext('2d')
  if (!ctx) return [100, 116, 139]
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

export function LiquidFill({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const card = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !card || !ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const [r, g, b] = toRgb(getComputedStyle(canvas).color)
    const rgba = (a: number) => `rgba(${r}, ${g}, ${b}, ${a})`

    const tilt: Spring = { p: 0, v: 0 }
    const centre: Spring = { p: 0, v: 0 }
    // Each card starts at its own point in the ripple, so they don't move in lockstep.
    let time = Math.random() * 100
    let width = 0
    let height = 0
    let frame = 0
    let last = 0
    let visible = true
    let lastPointerX: number | null = null

    function resize() {
      const rect = canvas!.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = rect.width
      height = rect.height
      canvas!.width = Math.max(1, Math.round(width * dpr))
      canvas!.height = Math.max(1, Math.round(height * dpr))
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }

    // Surface height (CSS px from the canvas top) at horizontal position u in 0..1.
    function surface(u: number, layer: 0 | 1) {
      const energy = Math.min(1, Math.abs(tilt.v) * 0.15 + Math.abs(centre.v) * 0.12)
      const ripple = RIPPLE_PX * (1 + energy * 1.8)
      const phase = layer === 0 ? 0 : 2.1
      const wave =
        ripple * Math.sin(2 * Math.PI * u * 1.25 + time * 1.15 + phase) +
        ripple * 0.55 * Math.sin(2 * Math.PI * u * 2.3 - time * 1.7 + phase * 1.6)
      // The back layer trails the front one a little, which reads as depth.
      const lag = layer === 0 ? 1 : 0.75
      const slosh =
        tilt.p * lag * (u - 0.5) * 2 * TILT_HEIGHT * height +
        centre.p * lag * Math.cos(2 * Math.PI * u) * CENTRE_HEIGHT * height
      return LEVEL * height + (layer === 0 ? 0 : -3) - slosh - wave
    }

    function fillLayer(layer: 0 | 1) {
      const steps = Math.max(12, Math.round(width / 6))
      ctx!.beginPath()
      ctx!.moveTo(0, height)
      for (let i = 0; i <= steps; i++) {
        const u = i / steps
        ctx!.lineTo(u * width, surface(u, layer))
      }
      ctx!.lineTo(width, height)
      ctx!.closePath()
    }

    function draw() {
      if (!width || !height) return
      ctx!.clearRect(0, 0, width, height)

      // Back layer: a flat, faint wash.
      fillLayer(1)
      ctx!.fillStyle = rgba(0.07)
      ctx!.fill()

      // Front layer: deeper towards the bottom, like looking into water.
      const top = LEVEL * height - TILT_HEIGHT * height
      const gradient = ctx!.createLinearGradient(0, top, 0, height)
      gradient.addColorStop(0, rgba(0.2))
      gradient.addColorStop(1, rgba(0.09))
      fillLayer(0)
      ctx!.fillStyle = gradient
      ctx!.fill()

      // A thin highlight along the surface.
      const steps = Math.max(12, Math.round(width / 6))
      ctx!.beginPath()
      for (let i = 0; i <= steps; i++) {
        const u = i / steps
        const y = surface(u, 0)
        if (i === 0) ctx!.moveTo(0, y)
        else ctx!.lineTo(u * width, y)
      }
      ctx!.strokeStyle = rgba(0.32)
      ctx!.lineWidth = 1.25
      ctx!.stroke()
    }

    function tick(now: number) {
      frame = 0
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60
      last = now
      time += dt
      step(tilt, TILT, dt)
      step(centre, CENTRE, dt)
      draw()
      if (visible) frame = requestAnimationFrame(tick)
    }

    function start() {
      if (reduceMotion || frame || !visible) return
      last = 0
      frame = requestAnimationFrame(tick)
    }

    function kick(tiltImpulse: number, centreImpulse: number) {
      if (reduceMotion) return
      tilt.v += tiltImpulse
      centre.v += centreImpulse
      start()
    }

    // Entering from the left pushes the liquid right, and vice versa.
    function side(e: PointerEvent) {
      const rect = card!.getBoundingClientRect()
      return e.clientX < rect.left + rect.width / 2 ? 1 : -1
    }
    const onEnter = (e: PointerEvent) => {
      lastPointerX = e.clientX
      kick(side(e) * 4.6, 2.8)
    }
    const onMove = (e: PointerEvent) => {
      // Moving across the card rocks the liquid gently in the same direction.
      if (lastPointerX !== null) {
        const dx = e.clientX - lastPointerX
        kick(Math.max(-0.9, Math.min(0.9, dx * 0.05)), 0)
      }
      lastPointerX = e.clientX
    }
    const onLeave = (e: PointerEvent) => {
      lastPointerX = null
      kick(-side(e) * 1.8, 1)
    }
    const onDown = (e: PointerEvent) => kick(side(e) * -6.5, 5.5)

    card.addEventListener('pointerenter', onEnter)
    card.addEventListener('pointermove', onMove)
    card.addEventListener('pointerleave', onLeave)
    card.addEventListener('pointerdown', onDown)

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) start()
      else if (frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    })
    intersectionObserver.observe(canvas)

    resize()
    start()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      intersectionObserver.disconnect()
      card.removeEventListener('pointerenter', onEnter)
      card.removeEventListener('pointermove', onMove)
      card.removeEventListener('pointerleave', onLeave)
      card.removeEventListener('pointerdown', onDown)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-[46%] w-full print:hidden', className)}
    />
  )
}
