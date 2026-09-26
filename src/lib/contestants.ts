/**
 * What the real contestants did with a board, and what that means as a target.
 *
 * Two problems with just showing the winner's final total:
 *
 *   · A Rapid board holds a fifth of the money a full one does, so $22,400 is
 *     not a score anyone could reach on it. Every figure here is scaled by the
 *     dollars actually on the board being played.
 *   · Shown from the first clue, the final total is a wall. The real player
 *     didn't have it from the first clue either — they had it at the end. So
 *     the target walks up through the game, using the archive's own checkpoints
 *     (end of round one, end of round two, after Final) and interpolating
 *     between them by how much of the current round has been played.
 */

import { GAME_LENGTH_CONFIG, type GameLength } from '@/types/game'

export type Contestant = {
  nickname: string
  afterRound1: number | null
  afterRound2: number | null
  final: number | null
}

/** Total dollars on a board of this size, both rounds. */
export function boardDollars(size: GameLength): number {
  const cfg = GAME_LENGTH_CONFIG[size]
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0)
  return cfg.categories * sum(cfg.values1) + cfg.categories * sum(cfg.values2)
}

const FULL_DOLLARS = boardDollars('full')

/** Scale a real score to the board actually being played, to the nearest $100. */
export function scaleToBoard(score: number, size: GameLength): number {
  if (size === 'full') return score
  return Math.round((score * (boardDollars(size) / FULL_DOLLARS)) / 100) * 100
}

/** The contestant who won the night. */
export function winnerOf(rows: Contestant[]): Contestant | null {
  const scored = rows.filter((r) => r.final != null)
  if (scored.length === 0) return null
  return scored.reduce((a, b) => ((b.final ?? 0) > (a.final ?? 0) ? b : a))
}

/**
 * Where a contestant stood at this point in a game.
 *
 * `round` is 1, 2 or 3 (Final). `progress` is how much of that round is done,
 * 0 to 1. Missing checkpoints fall back to the ones either side, so a game the
 * archive only has a final score for still produces a sensible line.
 */
export function paceAt(
  c: Contestant,
  round: number,
  progress: number,
  size: GameLength,
): number {
  const r1 = c.afterRound1 ?? 0
  const r2 = c.afterRound2 ?? r1
  const fin = c.final ?? r2
  const p = Math.max(0, Math.min(1, progress))

  const raw =
    round <= 1 ? r1 * p
    : round === 2 ? r1 + (r2 - r1) * p
    : r2 + (fin - r2) * p

  return scaleToBoard(Math.round(raw), size)
}

/** Their final total, scaled to this board. */
export function targetFor(c: Contestant, size: GameLength): number {
  return scaleToBoard(c.final ?? 0, size)
}

export const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`

export type EpisodeScores = {
  contestants: Contestant[]
  /** "Thursday, September 24, 2026", as the archive words it. */
  airedOn: string | null
}

/** Fetch a game's contestants. Never throws — a scoreboard is not a reason to
 *  break a game in progress. */
export async function fetchContestants(sourceGameId: number): Promise<EpisodeScores> {
  try {
    const res = await fetch(`/api/game-scores/${sourceGameId}`)
    if (!res.ok) return { contestants: [], airedOn: null }
    const data = await res.json()
    return {
      contestants: (data?.contestants ?? []) as Contestant[],
      airedOn: (data?.airedOn ?? null) as string | null,
    }
  } catch {
    return { contestants: [], airedOn: null }
  }
}
