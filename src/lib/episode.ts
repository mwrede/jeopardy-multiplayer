/**
 * A real Jeopardy! episode, as the archive recorded it — every clue, who rang
 * in on it and whether they were right, the Daily Double wagers, and how each
 * contestant played Final. This is what lets a campaign game score the real
 * contestants beside you clue by clue, rather than against a total.
 *
 * Produced by /api/episode/[gameId], which reads the J-Archive page. Types
 * live here so the route, the campaign library and the page share one shape.
 */

export type EpisodeContestant = {
  /** Podium position as listed, 0–2. */
  seat: 0 | 1 | 2
  name: string
  /** How the archive refers to them in results — usually the first name. */
  first: string
  occupation: string
  hometown: string
  /** "whose 2-day cash winnings total $40,001", when they're a returning champ. */
  note: string | null
}

export type ClueResponse = { name: string; right: boolean }

export type EpisodeClue = {
  /** 0-based column and row. */
  c: number
  r: number
  /** The cell's face value as aired. */
  value: number
  /** Order it was picked in that night, 1-based; null if unknown. */
  order: number | null
  question: string
  answer: string
  /** Set on a Daily Double: what the contestant who found it wagered. */
  ddWager: number | null
  /** Who rang in, in order. Empty = nobody got it (a "Triple Stumper"). */
  responses: ClueResponse[]
}

export type EpisodeRound = { categories: string[]; clues: EpisodeClue[] }

export type FinalResponse = { name: string; right: boolean; written: string; wager: number }

export type EpisodeFinal = {
  category: string
  question: string
  answer: string
  responses: FinalResponse[]
} | null

export type Episode = {
  gameId: number
  title: string
  airedOn: string | null
  contestants: EpisodeContestant[]
  rounds: [EpisodeRound, EpisodeRound]
  final: EpisodeFinal
}

const cache = new Map<number, Promise<Episode | null>>()

/** Fetch an episode. Cached per tab; never throws. */
export function fetchEpisode(gameId: number): Promise<Episode | null> {
  const hit = cache.get(gameId)
  if (hit) return hit
  const p = (async () => {
    try {
      const res = await fetch(`/api/episode/${gameId}`)
      if (!res.ok) return null
      const data = await res.json()
      return data?.unavailable ? null : (data as Episode)
    } catch {
      cache.delete(gameId)
      return null
    }
  })()
  cache.set(gameId, p)
  return p
}

export const money = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`
