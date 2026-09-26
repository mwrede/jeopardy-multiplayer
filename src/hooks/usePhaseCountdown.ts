'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A countdown for one game phase, anchored on the SERVER's clock.
 *
 * `anchorAt` is games.updated_at, the instant the phase began, so every screen
 * counts down to the same moment and a reload doesn't hand anyone a fresh
 * window. Returns whole seconds remaining, or null when the phase isn't
 * running.
 *
 * `onExpire` fires once per phase. It's held in a ref, so passing a fresh
 * closure on every render — which is unavoidable when it needs the current
 * typed value — doesn't restart the clock.
 */
export function usePhaseCountdown(opts: {
  active: boolean
  /** Epoch ms the phase started, from the server row. */
  anchorAt?: number
  totalMs: number
  onExpire: () => void | Promise<void>
  /** Restarts the clock when it changes — e.g. a new clue in the same phase. */
  key?: string | null
}): number | null {
  const { active, anchorAt, totalMs, onExpire, key } = opts
  const [remaining, setRemaining] = useState<number | null>(null)

  const expireRef = useRef(onExpire)
  useEffect(() => { expireRef.current = onExpire })

  useEffect(() => {
    if (!active) { setRemaining(null); return }

    const started = anchorAt != null && !isNaN(anchorAt) ? anchorAt : Date.now()
    const deadline = started + totalMs
    const left = () => Math.max(0, deadline - Date.now())

    setRemaining(Math.ceil(left() / 1000))
    const tick = setInterval(() => setRemaining(Math.ceil(left() / 1000)), 250)
    const fire = setTimeout(() => { void expireRef.current() }, left())

    return () => { clearInterval(tick); clearTimeout(fire) }
  }, [active, anchorAt, totalMs, key])

  return remaining
}
