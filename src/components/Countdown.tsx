'use client'

/**
 * The seconds left on a phase, in the one treatment used everywhere: quiet
 * until the last five, then red and urgent. Renders nothing when there's no
 * clock running, so callers can drop it in unconditionally.
 */
export function Countdown({
  seconds,
  label,
  className = '',
}: {
  seconds: number | null
  label?: string
  className?: string
}) {
  if (seconds === null) return null
  const urgent = seconds <= 5
  return (
    <p
      className={`text-sm font-bold tabular-nums ${
        urgent ? 'animate-pulse text-red-400' : 'text-jeopardy-gold-light'
      } ${className}`}
    >
      {seconds}s{label ? ` ${label}` : ''}
    </p>
  )
}
