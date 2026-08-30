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
 * Grouped by account, not by name: community play requires signing in, so two
 * people typing "Mike" keep separate records, and changing your display name
 * carries your history with it. Rows with no account are ignored — they'd be
 * unattributable.
 */
/**
 * The winningest player across finished PRIVATE games — the friends-and-
 * family champion, shown on the home page's Play with Friends tile.
 *
 * Private games are mostly played signed-out, so unlike the community
 * standings this groups by account when there is one and by name when there
 * isn't. Between friends that's honest enough — the same crew reuses the
 * same names — and the alternative is a tile that's forever empty.
 */
export async function getFriendsChampion(): Promise<{ name: string; wins: number } | null> {
  const { data: games, error } = await supabase
    .from('games')
    .select('id, settings, status')
    .eq('status', 'finished')
    .order('created_at', { ascending: false })
    .limit(400)
  if (error) throw error

  const privateIds = (games ?? [])
    .filter((g: any) => (g.settings as any)?.community !== true)
    .map((g: any) => g.id)
  if (privateIds.length === 0) return null

  const { data: players } = await supabase
    .from('players')
    .select('game_id, name, score, user_id')
    .in('game_id', privateIds)
  if (!players?.length) return null

  const best = new Map<string, number>()
  for (const p of players as any[]) {
    const cur = best.get(p.game_id)
    if (cur === undefined || p.score > cur) best.set(p.game_id, p.score)
  }

  const agg = new Map<string, { name: string; wins: number }>()
  for (const p of players as any[]) {
    const name = (p.name ?? '').trim()
    if (!name || name === 'Presenter') continue
    const key = p.user_id ? `user:${p.user_id}` : `name:${name.toLowerCase()}`
    const row = agg.get(key) ?? { name, wins: 0 }
    row.name = name
    if ((p.score ?? 0) > 0 && p.score === best.get(p.game_id)) row.wins += 1
    agg.set(key, row)
  }

  const top = [...agg.values()].sort((a, b) => b.wins - a.wins)[0]
  return top && top.wins > 0 ? top : null
}

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
    .select('game_id, name, score, user_id, join_order')
    .in('game_id', communityIds)
  if (!players?.length) return []

  // Top score per game decides that game's winner.
  const best = new Map<string, number>()
  for (const p of players as any[]) {
    const cur = best.get(p.game_id)
    if (cur === undefined || p.score > cur) best.set(p.game_id, p.score)
  }

  const agg = new Map<string, { name: string; games: number; wins: number; total: number }>()
  for (const p of players as any[]) {
    // No account, no ranking — there'd be no way to tell two players apart.
    if (!p.user_id) continue
    const row = agg.get(p.user_id) ?? { name: '', games: 0, wins: 0, total: 0 }
    // Whatever they called themselves most recently is the name shown.
    row.name = (p.name ?? '').trim() || row.name || 'Player'
    row.games += 1
    row.total += p.score ?? 0
    // A tie at the top counts as a win for everyone tied — nobody lost it.
    if (p.score === best.get(p.game_id)) row.wins += 1
    agg.set(p.user_id, row)
  }

  return [...agg.values()]
    .map((r) => ({
      name: r.name,
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
