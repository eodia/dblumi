import { useMemo } from 'react'
import { useI18n } from '@/i18n'

function computeScore(password: string): number {
  let score = 0
  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[a-z]/.test(password)) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++
  return score
}

type Level = 'weak' | 'fair' | 'strong'

function getLevel(score: number): Level {
  if (score <= 2) return 'weak'
  if (score <= 4) return 'fair'
  return 'strong'
}

const COLORS: Record<Level, string> = {
  weak: 'bg-red-500',
  fair: 'bg-orange-500',
  strong: 'bg-green-500',
}

const SEGMENTS = 4

export function PasswordStrengthIndicator({ password }: { password: string }) {
  const { t } = useI18n()

  const { level, filledSegments } = useMemo(() => {
    if (!password) return { level: 'weak' as Level, filledSegments: 0 }
    const score = computeScore(password)
    const lvl = getLevel(score)
    const filled = lvl === 'weak' ? 1 : lvl === 'fair' ? 2 : SEGMENTS
    return { level: lvl, filledSegments: filled }
  }, [password])

  if (!password) return null

  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex gap-1 flex-1">
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i < filledSegments ? COLORS[level] : 'bg-muted'
            }`}
          />
        ))}
      </div>
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${
        level === 'weak' ? 'text-red-500'
        : level === 'fair' ? 'text-orange-500'
        : 'text-green-500'
      }`}>
        {t(`password.strength.${level}` as 'password.strength.weak')}
      </span>
    </div>
  )
}
