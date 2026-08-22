/**
 * Party-mode timing for a picked clue.
 *
 * Every clue goes through two beats before the buzzer opens:
 *
 *   [ INTRO_MS ]  Category + dollar value only — the "pick" reveal.
 *   [ READ_MS  ]  Question text is visible; buzzers stay off while the
 *                 host would still be reading it aloud.
 *
 * READ_MS scales with question length so a 20-word clue and a 2-word clue
 * don't share the same delay. Clamped so trivial clues still get a full
 * beat and long ones don't stall the whole game.
 */

export const CLUE_INTRO_MS = 1800

const CHAR_MS = 55           // ~18 chars/sec — near TV-host pace
const MIN_READ_MS = 3000
const MAX_READ_MS = 15000

export function computeReadingMs(question: string | null | undefined): number {
  const len = (question ?? '').length
  return Math.max(MIN_READ_MS, Math.min(MAX_READ_MS, len * CHAR_MS))
}

/** Total delay from clue_reading → buzz_window. */
export function computeClueReadingDelay(question: string | null | undefined): number {
  return CLUE_INTRO_MS + computeReadingMs(question)
}

/** Beat between the clue finishing and the buzzers opening. */
const BUZZ_BUFFER_MS = 600

/**
 * How long from now until the buzzers should open, in local milliseconds.
 *
 * Every screen that can flip clue_reading → buzz_window must compute this the
 * SAME way, or the buzzers open whenever the fastest one happens to fire. They
 * didn't: the TV waited for the clue to finish typing, the party phone used its
 * own local estimate, and the multiplayer page used `reading_period_ms ?? 0` —
 * zero for most games. Whichever fired first won, so in practice the buzzers
 * opened the instant the clue appeared, while the TV was still typing it out.
 *
 * Anchored on the server timestamp of the phase change rather than on when each
 * client noticed it, so every device targets the same instant no matter when it
 * loaded or how long its round trip took.
 */
export function buzzOpenDelayMs(opts: {
  question: string | null | undefined
  readingPeriodMs?: number | null
  /** games.updated_at at the moment the clue went up. */
  phaseStartedAt?: string | null
  now?: number
}): number {
  const { question, readingPeriodMs, phaseStartedAt } = opts
  const now = opts.now ?? Date.now()

  // An explicit reading period wins; otherwise scale with the clue's length,
  // which is exactly what the reveal animation uses to pace itself.
  const revealMs =
    typeof readingPeriodMs === 'number' && readingPeriodMs > 0
      ? readingPeriodMs
      : computeReadingMs(question)

  const startedAt = phaseStartedAt ? Date.parse(phaseStartedAt) : NaN
  const anchor = isNaN(startedAt) ? now : startedAt
  const targetAt = anchor + CLUE_INTRO_MS + revealMs + BUZZ_BUFFER_MS

  // Clamped: a client whose clock is badly off shouldn't hang the round, and a
  // client that arrives late should open promptly rather than negatively.
  return Math.max(0, Math.min(30000, targetAt - now))
}
