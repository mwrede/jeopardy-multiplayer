'use client'

import { useEffect, useState } from 'react'

/**
 * A clue being written by hand, live, on the Create a Board tile.
 *
 * The hand sits inline at the end of the text, so it travels along the line
 * and wraps with it as the clue is written — rather than floating in a fixed
 * corner. Once the clue lands, the response fades in beneath it in the
 * question form the game expects, then the whole thing wipes and the next
 * clue starts.
 *
 * Type treatment matches gameplay: the same `font-serif` the display and
 * AnimatedClueReveal use for clue text, so what you write here looks like
 * what gets read out.
 *
 * Honors prefers-reduced-motion by showing one finished clue, standing still.
 */

const CLUES: { q: string; a: string }[] = [
  { q: 'In 1969 this astronaut was the first to walk on the Moon', a: 'Who is Neil Armstrong?' },
  { q: 'This planet is known as the Red Planet', a: 'What is Mars?' },
  { q: "This Shakespeare play contains the line 'To be, or not to be'", a: 'What is Hamlet?' },
  { q: 'The Louvre draws millions of visitors to this capital', a: 'What is Paris?' },
]

const TYPE_MS = 52
const HOLD_MS = 1100
const ANSWER_MS = 1700

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
  const writing = !reduced && chars < clue.q.length

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[58%] flex-col justify-center px-6 text-left">
      <p className="font-serif text-[15px] leading-snug text-white md:text-base">
        {visible}
        {writing && (
          <>
            <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.15em] bg-jeopardy-gold-light" />
            {/* The hand rides the end of the line as it writes. */}
            <span className="ml-1 inline-block translate-y-[0.2em] text-lg writing-hand" aria-hidden="true">
              &#9997;
            </span>
          </>
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
