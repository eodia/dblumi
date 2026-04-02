import { useRef, useState, useCallback } from 'react'
import { cn } from '@/lib/utils'

type Props = {
  onConfirm: () => void
  label: string
  confirmLabel?: string
  variant?: 'destructive' | 'default'
  disabled?: boolean
}

export function SlideToConfirm({ onConfirm, label, confirmLabel, variant = 'destructive', disabled }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const [confirmed, setConfirmed] = useState(false)
  const dragging = useRef(false)
  const startX = useRef(0)

  const THUMB_W = 44
  const THRESHOLD = 0.85

  const PAD = 4 // px padding on each side
  const getMaxTravel = () => {
    if (!trackRef.current) return 200
    return trackRef.current.offsetWidth - THUMB_W - PAD * 2
  }

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled || confirmed) return
    dragging.current = true
    startX.current = e.clientX
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
  }, [disabled, confirmed])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const delta = e.clientX - startX.current
    const max = getMaxTravel()
    const p = Math.max(0, Math.min(1, delta / max))
    setProgress(p)
  }, [])

  const handlePointerUp = useCallback(() => {
    if (!dragging.current) return
    dragging.current = false
    if (progress >= THRESHOLD) {
      setConfirmed(true)
      setProgress(1)
      onConfirm()
    } else {
      setProgress(0)
    }
  }, [progress, onConfirm])

  const isDestructive = variant === 'destructive'
  const bgColor = isDestructive ? 'bg-destructive/15' : 'bg-primary/15'
  const thumbColor = isDestructive ? 'bg-destructive' : 'bg-primary'
  const fillColor = isDestructive ? 'bg-destructive/25' : 'bg-primary/25'
  const textColor = isDestructive ? 'text-destructive' : 'text-primary'

  return (
    <div
      ref={trackRef}
      className={cn(
        'relative h-10 rounded-lg border overflow-hidden select-none',
        bgColor,
        isDestructive ? 'border-destructive/30' : 'border-primary/30',
        disabled && 'opacity-50 pointer-events-none',
        confirmed && 'opacity-60',
      )}
    >
      {/* Fill */}
      <div
        className={cn('absolute inset-y-0 left-0 transition-none', fillColor)}
        style={{ width: `${progress * 100}%`, transition: dragging.current ? 'none' : 'width 0.3s ease-out' }}
      />

      {/* Label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className={cn('text-xs font-medium transition-opacity', textColor, progress > 0.3 ? 'opacity-0' : 'opacity-60')}>
          {label}
        </span>
        <span className={cn('text-xs font-semibold absolute transition-opacity', isDestructive ? 'text-destructive-foreground' : 'text-primary-foreground', progress > 0.7 ? 'opacity-100' : 'opacity-0')}>
          {confirmLabel ?? label}
        </span>
      </div>

      {/* Thumb */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={cn(
          'absolute top-1 bottom-1 rounded-md flex items-center justify-center cursor-grab active:cursor-grabbing touch-none ml-1',
          thumbColor,
          'text-white shadow-lg',
        )}
        style={{
          width: THUMB_W,
          left: `${progress * getMaxTravel()}px`,
          transition: dragging.current ? 'none' : 'left 0.3s ease-out',
        }}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  )
}
