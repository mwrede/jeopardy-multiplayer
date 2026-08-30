/**
 * JEOPARDY CHALLENGE — results, leaderboards and ghost opponents.
 *
 * The boards are fixed (challenge-data.ts); this module is everything that
 * happens around them:
 *
 *   · One play per person per board. The database enforces it with a unique
 *     constraint on (game_key, identity_key), so a second submission is
 *     rejected even from a fresh tab. Signed-in players are keyed by account;
 *     guests by an id minted into their browser — clearing storage does let a
 *     guest start over, which is the honest limit of guest identity.
 *
 *   · Every finished game records HOW it went, clue by clue, not just the
 *     total. That's what makes the ghost race possible: when you play, up to
 *     three real previous players are dealt in beside you, and as you resolve
 *     each clue their recorded result for that same clue lands on their score.
 *     You're genuinely playing against what those people actually did.
 *
 *   · Leaderboards are by money: one per board, and one overall table summing
 *     every board a person has played.
 */

import { supabase } from './supabase'
import { CHALLENGE_GAMES } from './challenge-data'

export type ClueOutcome = 'correct' | 'wrong' | 'pass'

/** One clue of one person's game: category index, row index, what happened. */
export type ClueResult = {
  c: number
  r: number
  outcome: ClueOutcome
  value: number
  /** What they typed, kept so a replayed clue can show it. Optional. */
  answer?: string
}

export type ChallengeResult = {
  id: string
  game_key: string
  identity_key: string
  player_name: string
  score: number
  correct_count: number
  clue_results: ClueResult[]
  created_at: string
}

const GUEST_ID_KEY = 'challengeGuestId'

/**
 * Who this browser is, for the one-play rule and the leaderboard. An account
 * beats a guest id: it survives new devices and cleared storage.
 */
export function getChallengeIdentity(userId?: string | null): string {
  if (userId) return `user:${userId}`
  try {
    let id = localStorage.getItem(GUEST_ID_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      localStorage.setItem(GUEST_ID_KEY, id)
    }
    return `guest:${id}`
  } catch {
    // Storage unavailable (private mode edge cases): a throwaway identity.
    // They can play; the one-play rule just can't recognise them next visit.
    return `guest:${Math.random().toString(36).slice(2)}`
  }
}

function rowFromDb(r: any): ChallengeResult {
  return {
    id: r.id,
    game_key: r.game_key,
    identity_key: r.identity_key,
    player_name: r.player_name,
    score: r.score,
    correct_count: r.correct_count,
    clue_results: Array.isArray(r.clue_results) ? r.clue_results : [],
    created_at: r.created_at,
  }
}

/**
 * Every recorded result, newest capped at a generous limit. The whole feature
 * runs off this one query: the hub computes per-board top lists, the overall
 * table, and your own locked/unlocked states from a single fetch instead of
 * nineteen.
 */
export async function fetchAllChallengeResults(): Promise<ChallengeResult[]> {
  const { data, error } = await supabase
    .from('challenge_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(4000)
  if (error) throw error
  return (data ?? []).map(rowFromDb)
}

/** Results for one board, best money first; ties broken by who got there first. */
export async function fetchGameResults(gameKey: string): Promise<ChallengeResult[]> {
  const { data, error } = await supabase
    .from('challenge_results')
    .select('*')
    .eq('game_key', gameKey)
    .order('score', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) throw error
  return (data ?? []).map(rowFromDb)
}

/** This identity's result for one board, or null if they haven't played it. */
export async function fetchMyResult(
  gameKey: string,
  identityKey: string,
): Promise<ChallengeResult | null> {
  const { data, error } = await supabase
    .from('challenge_results')
    .select('*')
    .eq('game_key', gameKey)
    .eq('identity_key', identityKey)
    .maybeSingle()
  if (error) throw error
  return data ? rowFromDb(data) : null
}

/**
 * Record a finished game. Throws a friendly error if this identity already
 * has a result for the board — the unique constraint is the referee, so even
 * two tabs racing can't score twice.
 */
export async function submitChallengeResult(input: {
  gameKey: string
  identityKey: string
  userId?: string | null
  playerName: string
  score: number
  correctCount: number
  clueResults: ClueResult[]
}): Promise<void> {
  const { error } = await supabase.from('challenge_results').insert({
    game_key: input.gameKey,
    identity_key: input.identityKey,
    user_id: input.userId ?? null,
    player_name: input.playerName.slice(0, 30),
    score: input.score,
    correct_count: input.correctCount,
    clue_results: input.clueResults,
  })
  if (error) {
    if ((error as any).code === '23505') {
      throw new Error('You’ve already played this one — each board is one shot.')
    }
    if (/challenge_results/.test(error.message) && /not exist|schema/i.test(error.message)) {
      throw new Error(
        'The challenge table isn’t set up yet — run supabase-migration-challenge-results.sql in the Supabase dashboard.',
      )
    }
    throw error
  }
}

/**
 * Deal in up to three real previous players as ghost opponents.
 *
 * The current leader is always at the table — the leaderboard chase should be
 * playable, not abstract — and the remaining seats go to a random draw of
 * everyone else, so repeat visitors to different boards don't always face the
 * same trio.
 */
export function pickOpponents(
  results: ChallengeResult[],
  identityKey: string,
  n = 3,
): ChallengeResult[] {
  const others = results.filter((r) => r.identity_key !== identityKey)
  if (others.length <= n) return [...others].sort((a, b) => b.score - a.score)

  const leader = others.reduce((best, r) => (r.score > best.score ? r : best), others[0])
  const rest = others.filter((r) => r.id !== leader.id)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return [leader, ...rest.slice(0, n - 1)].sort((a, b) => b.score - a.score)
}

export type OverallRow = {
  identityKey: string
  name: string
  totalScore: number
  gamesPlayed: number
  bestGame: number
  isGuest: boolean
}

/**
 * The all-boards table: one row per person, ranked by total money across
 * every board they've played. Games-played shown beside it so a huge total
 * from twenty boards reads differently from the same total off five.
 */
export function overallLeaderboard(results: ChallengeResult[]): OverallRow[] {
  const agg = new Map<string, OverallRow>()
  for (const r of results) {
    const row =
      agg.get(r.identity_key) ??
      {
        identityKey: r.identity_key,
        name: '',
        totalScore: 0,
        gamesPlayed: 0,
        bestGame: -Infinity,
        isGuest: r.identity_key.startsWith('guest:'),
      }
    // Most recent name wins — results arrive newest-first from the fetch.
    if (!row.name) row.name = r.player_name
    row.totalScore += r.score
    row.gamesPlayed += 1
    row.bestGame = Math.max(row.bestGame, r.score)
    agg.set(r.identity_key, row)
  }
  return [...agg.values()].sort(
    (a, b) => b.totalScore - a.totalScore || b.gamesPlayed - a.gamesPlayed,
  )
}

/** Group a flat result list by board, each list best-first. */
export function resultsByGame(results: ChallengeResult[]): Map<string, ChallengeResult[]> {
  const map = new Map<string, ChallengeResult[]>()
  for (const g of CHALLENGE_GAMES) map.set(g.key, [])
  for (const r of results) {
    const list = map.get(r.game_key)
    if (list) list.push(r)
  }
  for (const list of map.values()) {
    list.sort((a, b) => b.score - a.score || a.created_at.localeCompare(b.created_at))
  }
  return map
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString()}`
}
