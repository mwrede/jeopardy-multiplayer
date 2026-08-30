/**
 * JEOPARDY CHALLENGE — the fixed solo boards.
 *
 * Every clue here is a REAL Jeopardy! clue, lifted from the J-Archive pool
 * that also powers the multiplayer game, and every category remembers which
 * episode it aired in — the clue screen shows the date. The boards themselves
 * are frozen in challenge-boards.json (generated once, committed) so every
 * player everywhere sees the exact same clues and the leaderboards mean
 * something. Only RESULTS go to Supabase.
 *
 * Every board is a full miniature game:
 *   · Jeopardy round        — 3 categories × 3 clues at $200/$400/$600
 *   · Double Jeopardy round — 3 × 3 at $400/$800/$1200
 *   · one hidden Daily Double per round (wager up to your total, or the
 *     round's top value if you're below it)
 *   · Final Jeopardy — see the category, wager, then answer
 *
 * Two collections:
 *   · The Lineup — Kids (a real Kids Week game), Teen (1994 Teen Tournament),
 *     College (2022 National College Championship), and five Standard Games,
 *     each from a famous episode: Show #1 (the 1984 premiere), a 1996
 *     classic, Ken Jennings' debut, James Holzhauer's record night, and Amy
 *     Schneider's debut.
 *   · Michael's Jeopardy Challenge — ten all-geography boards whose
 *     categories are drawn from real games across four decades: capitals,
 *     rivers, islands, states, deserts, the lot.
 *
 * NEVER edit a board once scores exist for its key — re-key it instead, or
 * the recorded ghost games stop matching the clues.
 */

import boards from './challenge-boards.json'

export type ChallengeTier = 'kids' | 'teen' | 'college' | 'standard' | 'geography' | 'politics'

export interface ChallengeClue {
  q: string
  a: string
}

export interface ChallengeCategory {
  name: string
  /** Air date (ISO) and show label of the real game this category ran in. */
  airDate: string | null
  show: string | null
  /** Exactly three, easiest first. */
  clues: ChallengeClue[]
}

export interface ChallengeGame {
  /** Stable slug — leaderboard rows key on this, so it must never change. */
  key: string
  title: string
  tier: ChallengeTier
  series: 'lineup' | 'michaels' | 'politics'
  blurb: string
  /** Set when the whole board comes from one episode. */
  episode: { show: string; airDate: string; note: string } | null
  /** [Jeopardy round, Double Jeopardy round] — three categories each. */
  rounds: [ChallengeCategory[], ChallengeCategory[]]
  finalJeopardy: {
    category: string
    q: string
    a: string
    airDate: string | null
    show: string | null
  }
  /** Exactly one per round, positions hidden until hit. */
  dailyDoubles: { rd: number; c: number; r: number }[]
}

export const CHALLENGE_GAMES = boards as unknown as ChallengeGame[]

/** Card values by round: [Jeopardy, Double Jeopardy]. */
export const ROUND_VALUES: [number[], number[]] = [
  [200, 400, 600],
  [400, 800, 1200],
]

/** 9 + 9 + Final Jeopardy. */
export const CLUES_PER_GAME = 19

export const TIER_LABELS: Record<ChallengeTier, string> = {
  kids: 'Kids',
  teen: 'Teen',
  college: 'College',
  standard: 'Standard',
  geography: 'Geography',
  politics: 'Politics',
}

export function getChallengeGame(key: string): ChallengeGame | undefined {
  return CHALLENGE_GAMES.find((g) => g.key === key)
}

export function isDailyDouble(game: ChallengeGame, rd: number, c: number, r: number): boolean {
  return game.dailyDoubles.some((d) => d.rd === rd && d.c === c && d.r === r)
}

/** "1984-09-10" → "Sep 10, 1984". */
export function formatAirDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[m - 1]} ${d}, ${y}`
}

export const LINEUP_GAMES = CHALLENGE_GAMES.filter((g) => g.series === 'lineup')
export const MICHAELS_GAMES = CHALLENGE_GAMES.filter((g) => g.series === 'michaels')
export const POLITICS_GAMES = CHALLENGE_GAMES.filter((g) => g.series === 'politics')
