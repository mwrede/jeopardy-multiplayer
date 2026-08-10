/**
 * Community Play leaderboard.
 *
 * Ranking three-handed games fairly is the whole problem here:
 *
 *   · Rank by WINS and it's a measure of how much free time you have. Someone
 *     playing all evening beats a better player who played twice.
 *   · Rank by WIN RATE and one lucky game puts you at 100%, above everyone
 *     who has played enough for their number to mean anything.
 *
 * So: rate, but with the sample size folded in. Each player's rate is pulled
 * toward the 1-in-3 you'd expect from chance, by an amount that shrinks as
 * they play more — the Bayesian version of "come back when you've played a
 * few". Two wins from three games reads as promising, not as dominance;
 * twenty from sixty reads as real. A minimum of MIN_GAMES keeps one-offs off
 * the board entirely, and wins are shown alongside so the raw number is never
 * hidden.
 */

import { supabase } from './supabase'

/** Below this, a rate says more about luck than the player. */
export const MIN_GAMES = 3

/** Strength of the pull toward chance — worth this many "average" games. */
const PRIOR_GAMES = 4
/** Expected win rate with three players and no skill involved. */
const PRIOR_RATE = 1 / 3

export type LeaderboardRow = {
  name: string
  games: number
  wins: number
  winRate: number
  /** Sample-adjusted rate — what the table is actually sorted on. */
  rating: number
  totalScore: number
}

/**
 * Standings across finished Community Play games.
 *
 * Players are grouped by name, since community play needs no account. Two
 * people using the same name share a row — the honest trade for not making
 * anyone sign up.
 */
export async function getCommunityLeaderboard(limit = 25): Promise<LeaderboardRow[]> {
  const { data: games, error } = await supabase
    .from('games')
    .select('id, settings, status')
    .eq('status', 'finished')
    .order('created_at', { ascending: false })
    .limit(400)
  if (error) throw error

  const communityIds = (games ?? [])
    .filter((g: any) => (g.settings as any)?.community === true)
    .map((g: any) => g.id)
  if (communityIds.length === 0) return []

  const { data: players } = await supabase
    .from('players')
    .select('game_id, name, score')
    .in('game_id', communityIds)
  if (!players?.length) return []

  // Top score per game decides that game's winner.
  const best = new Map<string, number>()
  for (const p of players as any[]) {
    const cur = best.get(p.game_id)
    if (cur === undefined || p.score > cur) best.set(p.game_id, p.score)
  }

  const agg = new Map<string, { games: number; wins: number; total: number }>()
  for (const p of players as any[]) {
    const key = (p.name ?? '').trim() || 'Player'
    const row = agg.get(key) ?? { games: 0, wins: 0, total: 0 }
    row.games += 1
    row.total += p.score ?? 0
    // A tie at the top counts as a win for everyone tied — nobody lost it.
    if (p.score === best.get(p.game_id)) row.wins += 1
    agg.set(key, row)
  }

  return [...agg.entries()]
    .map(([name, r]) => ({
      name,
      games: r.games,
      wins: r.wins,
      winRate: r.games ? r.wins / r.games : 0,
      // Shrink toward chance; the prior's weight fades as games accumulate.
      rating: (r.wins + PRIOR_RATE * PRIOR_GAMES) / (r.games + PRIOR_GAMES),
      totalScore: r.total,
    }))
    .filter((r) => r.games >= MIN_GAMES)
    .sort((a, b) => b.rating - a.rating || b.wins - a.wins)
    .slice(0, limit)
}
