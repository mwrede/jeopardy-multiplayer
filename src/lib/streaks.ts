/**
 * The longest regular-play winning streaks in Jeopardy! history.
 *
 * Hand-kept, because it changes a few times a decade and there's no API for
 * it. Verified 2026-09-26 against reporting from April–May 2026 (Distractify,
 * BroBible, Wikipedia on Ding). Winnings are regular-play only — no
 * tournaments — which is the number a campaign run compares to.
 *
 * Until season 20 (2003) a champion retired after five wins, which is why
 * nothing here predates 2004.
 */

export type RealStreak = {
  rank: number
  name: string
  games: number
  winnings: number
  when: string
}

export const REAL_STREAKS: RealStreak[] = [
  { rank: 1, name: 'Ken Jennings',    games: 74, winnings: 2_520_700, when: '2004' },
  { rank: 2, name: 'Amy Schneider',   games: 40, winnings: 1_382_800, when: '2021–22' },
  { rank: 3, name: 'Matt Amodio',     games: 38, winnings: 1_518_601, when: '2021' },
  { rank: 4, name: 'James Holzhauer', games: 32, winnings: 2_462_216, when: '2019' },
  { rank: 5, name: 'Jamie Ding',      games: 31, winnings:   882_605, when: '2026' },
  { rank: 6, name: 'Mattea Roach',    games: 23, winnings:   560_983, when: '2022' },
  { rank: 7, name: 'Cris Pannullo',   games: 21, winnings:   748_286, when: '2022' },
  { rank: 8, name: 'Julia Collins',   games: 20, winnings:   428_100, when: '2014' },
]

/** Where a streak of `games` would sit among the real ones (1 = the top). */
export function rankAmongReal(games: number): number {
  return REAL_STREAKS.filter((s) => s.games > games).length + 1
}
