/**
 * Wager rules, in one place.
 *
 * These were spelled out inline in four different files — the two answering
 * screens, the presenter, and the server functions — and had drifted apart:
 * the server hardcoded a $1,000/$2,000 round cap that is wrong on a Rapid or
 * Half board, and Final Jeopardy had no server-side check at all, so whatever
 * number reached submitFinalWager was applied to the score verbatim.
 *
 * The real rules:
 *
 *   Daily Double — at least $5, at most the GREATER of your own score and the
 *   top clue value on the board this round. That second half is what lets a
 *   player sitting on $200 bet $1,000; it is not a bug.
 *
 *   Final Jeopardy — $0 up to your score.
 *
 * One house departure, deliberate: FINAL_WAGER_FLOOR. Under tournament rules a
 * player at $0 or below doesn't play Final at all. In a living room that means
 * someone watches the last clue with nothing to do, so anyone can always wager
 * up to the floor and stay in the game.
 */

import { GAME_LENGTH_CONFIG, type GameLength } from '@/types/game'

export const MIN_DAILY_DOUBLE_WAGER = 5
export const FINAL_WAGER_FLOOR = 1000

/** The largest clue value on the board for this round — the DD's other cap. */
export function topClueValue(gameLength: GameLength | undefined, round: number): number {
  const cfg = GAME_LENGTH_CONFIG[gameLength || 'full']
  const values = round === 2 ? cfg.values2 : cfg.values1
  return values[values.length - 1] || (round === 2 ? 2000 : 1000)
}

/** Most you may bet on a Daily Double. */
export function maxDailyDoubleWager(score: number, topValue: number): number {
  return Math.max(score, topValue)
}

/** Most you may bet in Final Jeopardy, including the house floor. */
export function maxFinalWager(score: number): number {
  return Math.max(score, FINAL_WAGER_FLOOR)
}

/** Force a typed Daily Double wager into the legal range. */
export function clampDailyDoubleWager(raw: number, score: number, topValue: number): number {
  const n = Math.floor(Number(raw))
  const safe = Number.isFinite(n) ? n : MIN_DAILY_DOUBLE_WAGER
  return Math.min(
    Math.max(safe, MIN_DAILY_DOUBLE_WAGER),
    maxDailyDoubleWager(score, topValue),
  )
}

/** Force a typed Final Jeopardy wager into the legal range. */
export function clampFinalWager(raw: number, score: number): number {
  const n = Math.floor(Number(raw))
  const safe = Number.isFinite(n) ? n : 0
  return Math.min(Math.max(safe, 0), maxFinalWager(score))
}
