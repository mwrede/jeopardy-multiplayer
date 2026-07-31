'use client'

import { useEffect, useState } from 'react'

/**
 * A clue being written, live, on the Create a Board tile.
 *
 * Types a clue out character by character, holds it, then reveals the answer
 * underneath before wiping and moving to the next one — the actual loop of
 * authoring a board, shown rather than described.
 *
 * Honors prefers-reduced-motion by rendering the first clue complete and
 * standing still.
 */

const CLUES: { q: string; a: string }[] = [
  { q: 'This Roboflow team ships the most models per sprint', a: 'Who is Engineering?' },
  { q: 'The only planet not named after a god', a: 'What is Earth?' },
  { q: 'It takes 8 minutes for its light to reach us', a: 'What is the Sun?' },
]

const TYPE_MS = 55
const HOLD_MS = 1400
const ANSWER_MS = 1500

export function TypingClue() {
  const [index, setIndex] = useState(0)
  const [chars, setChars] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const clue = CLUES[index]

  useEffect(() => {
    if (reduced) return
    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []

    if (chars < clue.q.length) {
      timers.push(setTimeout(() => { if (!cancelled) setChars((n) => n + 1) }, TYPE_MS))
    } else if (!showAnswer) {
      timers.push(setTimeout(() => { if (!cancelled) setShowAnswer(true) }, HOLD_MS))
    } else {
      timers.push(setTimeout(() => {
        if (cancelled) return
        setShowAnswer(false)
        setChars(0)
        setIndex((i) => (i + 1) % CLUES.length)
      }, ANSWER_MS))
    }

    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [chars, showAnswer, clue.q.length, reduced])

  const visible = reduced ? clue.q : clue.q.slice(0, chars)
  const done = reduced || chars >= clue.q.length

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[58%] flex-col justify-center px-6 text-left">
      <p className="font-serif text-[15px] leading-snug text-white md:text-base">
        {visible}
        {!done && (
          <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] bg-jeopardy-gold-light animate-pulse" />
        )}
      </p>
      <p
        className={`mt-3 text-[13px] font-semibold text-jeopardy-gold-light transition-opacity duration-300 ${
          showAnswer || reduced ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {clue.a}
      </p>
    </div>
  )
}
