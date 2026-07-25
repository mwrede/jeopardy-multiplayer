'use client'

import { useEffect, useState } from 'react'
import { ClueText } from './ClueText'
import { CLUE_INTRO_MS } from '@/lib/clue-timing'

/**
 * Party-mode clue reveal used on BOTH the TV display and the player phones.
 *
 * Timing is anchored to `phaseStartedAt` (the server-side updated_at when
 * the game entered clue_reading) so every screen animates in lockstep — the
 * TV and every phone see the same character at the same moment, network
 * jitter aside.
 *
 *   [0 → CLUE_INTRO_MS]                   Big category + $ value intro card
 *   [CLUE_INTRO_MS → + revealDurationMs]  Question types out letter-by-letter
 *   after that                             Full question shown, parent flips
 *                                          the game to buzz_window
 */
export function AnimatedClueReveal({
  category,
  value,
  question,
  phaseStartedAt,
  revealDurationMs,
  variant,
}: {
  category: string | null
  value: number
  question: string
  phaseStartedAt: number // milliseconds since epoch (server updated_at parsed)
  revealDurationMs: number
  variant: 'tv' | 'phone'
}) {
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

  const elapsed = now - phaseStartedAt
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
        className={`text-center leading-relaxed font-serif max-w-5xl ${
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
