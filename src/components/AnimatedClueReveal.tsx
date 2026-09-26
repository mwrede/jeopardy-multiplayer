'use client'

import { useEffect, useRef, useState } from 'react'
import { ClueText } from './ClueText'
import { CLUE_INTRO_MS } from '@/lib/clue-timing'

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
  anchorAt,
  year,
  skipAnimation = false,
}: {
  category: string | null
  value: number
  question: string
  revealDurationMs: number
  variant: 'tv' | 'phone'
  /** The year this clue originally aired. Null on custom boards. */
  year?: number | null
  /**
   * When the clue actually went up, as epoch ms from the SERVER clock. The
   * buzzers open from that same instant, so without it the two drift apart: a
   * screen that loads a few seconds late starts typing from the beginning
   * while the buzzers open on schedule, leaving the clue half-written when
   * people can already buzz.
   *
   * Read once, at mount. It must NOT be reactive — a wrong answer reopening
   * the buzzers moves the underlying timestamp, and re-reading it would retype
   * a clue the room has already heard.
   */
  anchorAt?: number
  /** Mounted after the reading was over: show the finished clue, no replay. */
  skipAnimation?: boolean
}) {
  const mountedAtRef = useRef<number>(
    typeof anchorAt === 'number' && !isNaN(anchorAt) ? anchorAt : Date.now(),
  )
  const skipRef = useRef<boolean>(skipAnimation)
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

  const elapsed = skipRef.current
    ? Number.MAX_SAFE_INTEGER
    : now - mountedAtRef.current
  const inIntro = elapsed < CLUE_INTRO_MS
  const revealElapsed = Math.max(0, elapsed - CLUE_INTRO_MS)
  const totalChars = question.length
  const visibleChars = Math.min(
    totalChars,
    Math.max(0, Math.floor((revealElapsed / Math.max(1, revealDurationMs)) * totalChars)),
  )

  const isTv = variant === 'tv'

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
        <ClueYear year={year} isTv={isTv} />
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
      <p className={`text-jeopardy-gold font-bold ${isTv ? 'text-4xl' : 'text-2xl'}`}>
        ${value.toLocaleString()}
      </p>
      <ClueYear year={year} isTv={isTv} className={isTv ? 'mb-6' : 'mb-3'} />
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

/**
 * The year the clue first aired. A mashup board is stitched together from
 * many different shows, so this genuinely changes clue to clue — knowing a
 * clue is from 1997 is half of answering it.
 */
function ClueYear({
  year,
  isTv,
  className = '',
}: {
  year?: number | null
  isTv: boolean
  className?: string
}) {
  if (!year) return <span className={className} />
  return (
    <p
      className={`${isTv ? 'text-lg mt-2' : 'text-[11px] mt-1'} uppercase tracking-[0.28em] text-blue-300/70 ${className}`}
    >
      {year}
    </p>
  )
}
