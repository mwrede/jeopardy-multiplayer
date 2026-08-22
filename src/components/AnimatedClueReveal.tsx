'use client'

import { useEffect, useRef, useState } from 'react'
import { ClueText } from './ClueText'
import { CLUE_INTRO_MS } from '@/lib/clue-timing'
import { playTypeSound } from '@/lib/sounds'

/**
 * Party-mode clue reveal used on BOTH the TV display and the player phones.
 *
 * Callers pass a `key={clueId}` so this component remounts fresh on every
 * new clue. Timing anchors to the mount moment (local Date.now()), NOT to
 * game.updated_at — because that timestamp changes on rebuzz phase flips,
 * which would restart the animation and look like a loop.
 *
 *   [0 → CLUE_INTRO_MS]                   Big category + $ value intro card
 *   [CLUE_INTRO_MS → + revealDurationMs]  Question types out letter-by-letter
 *   after that                             Full question shown
 */
export function AnimatedClueReveal({
  category,
  value,
  question,
  revealDurationMs,
  variant,
}: {
  category: string | null
  value: number
  question: string
  revealDurationMs: number
  variant: 'tv' | 'phone'
}) {
  const mountedAtRef = useRef<number>(Date.now())
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    let raf = 0
    const tick = () => {
      setNow(Date.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const elapsed = now - mountedAtRef.current
  const inIntro = elapsed < CLUE_INTRO_MS
  const revealElapsed = Math.max(0, elapsed - CLUE_INTRO_MS)
  const totalChars = question.length
  const visibleChars = Math.min(
    totalChars,
    Math.max(0, Math.floor((revealElapsed / Math.max(1, revealDurationMs)) * totalChars)),
  )

  const isTv = variant === 'tv'

  // Click along with the letters as they appear.
  //
  // Throttled rather than one click per character: this is driven by
  // requestAnimationFrame, so a long clue can add several characters in a
  // single frame and a click each would be a burst of static. Roughly one
  // every 60ms sounds like someone typing at a steady clip.
  //
  // TV only. In party mode the phones are in the same room as the TV and are
  // running this same component, so playing on every device would give you
  // half a dozen out-of-step keyboards at once.
  const lastClickAtRef = useRef(0)
  const lastVisibleRef = useRef(0)
  useEffect(() => {
    const previous = lastVisibleRef.current
    lastVisibleRef.current = visibleChars
    if (!isTv) return
    // Nothing new, or the reveal has finished — silence.
    if (visibleChars <= previous || visibleChars >= totalChars) return
    const at = Date.now()
    if (at - lastClickAtRef.current < 60) return
    lastClickAtRef.current = at
    playTypeSound()
  }, [visibleChars, totalChars, isTv])

  if (inIntro) {
    return (
      <div className="flex flex-col items-center animate-[fadeIn_400ms_ease-out]">
        {category && (
          <p
            className={`${isTv ? 'text-4xl md:text-6xl mb-8' : 'text-lg mb-4'} text-blue-300 font-bold uppercase tracking-wide text-center`}
          >
            {category}
          </p>
        )}
        <p className={`text-jeopardy-gold font-bold ${isTv ? 'text-8xl md:text-9xl' : 'text-5xl'}`}>
          ${value.toLocaleString()}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center w-full">
      {category && (
        <p
          className={`${isTv ? 'text-2xl mb-4' : 'text-xs mb-2'} text-blue-300 font-bold uppercase tracking-wide text-center`}
        >
          {category}
        </p>
      )}
      <p className={`text-jeopardy-gold font-bold mb-6 ${isTv ? 'text-4xl' : 'text-2xl mb-3'}`}>
        ${value.toLocaleString()}
      </p>
      <p
        className={`text-center clue-type max-w-5xl ${
          isTv ? 'text-4xl md:text-6xl' : 'text-xl px-2'
        }`}
      >
        <span className="text-white">
          <ClueText text={question.slice(0, visibleChars)} />
        </span>
        <span className="text-transparent select-none" aria-hidden="true">
          {question.slice(visibleChars)}
        </span>
      </p>
    </div>
  )
}
