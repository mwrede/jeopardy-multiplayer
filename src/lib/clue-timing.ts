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
