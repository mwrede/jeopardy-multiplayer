/**
 * Pre-game voting for Community Play.
 *
 * Three strangers agree on what they're about to play: board size, difficulty
 * and era. Nobody has authority over anyone else here, so the tally has to be
 * even-handed — see resolveTie below, which is the only interesting part.
 */

import { supabase } from './supabase'
import { searchGames, startGameFromSource, startGame } from './game-api'
import type { GameLength } from '@/types/game'

export type SizeVote = GameLength
export type DifficultyVote = 'kids' | 'teen' | 'college' | 'standard'
export type DecadeVote = 'any' | '1980s' | '1990s' | '2000s' | '2010s' | '2020s'

export const SIZE_OPTIONS: { id: SizeVote; label: string; desc: string }[] = [
  { id: 'full', label: 'Full', desc: '6×5' },
  { id: 'half', label: 'Half', desc: '6×3' },
  { id: 'rapid', label: 'Rapid', desc: '3×3' },
]

export const DIFFICULTY_OPTIONS: { id: DifficultyVote; label: string; notesFilter?: string }[] = [
  { id: 'kids', label: 'Kids', notesFilter: 'Kids Week' },
  { id: 'teen', label: 'Teen', notesFilter: 'Teen Tournament' },
  { id: 'college', label: 'College', notesFilter: 'College' },
  { id: 'standard', label: 'Standard' },
]

export const DECADE_OPTIONS: { id: DecadeVote; label: string; from?: string; to?: string }[] = [
  { id: 'any', label: 'Any era' },
  { id: '1980s', label: "'80s", from: '1984-01-01', to: '1989-12-31' },
  { id: '1990s', label: "'90s", from: '1990-01-01', to: '1999-12-31' },
  { id: '2000s', label: "'00s", from: '2000-01-01', to: '2009-12-31' },
  { id: '2010s', label: "'10s", from: '2010-01-01', to: '2019-12-31' },
  { id: '2020s', label: "'20s", from: '2020-01-01', to: '2029-12-31' },
]

export type Vote = {
  size: SizeVote | null
  difficulty: DifficultyVote | null
  decade: DecadeVote | null
}

export async function castVote(playerId: string, vote: Vote) {
  const { error } = await supabase
    .from('players')
    .update({
      vote_size: vote.size,
      vote_difficulty: vote.difficulty,
      vote_decade: vote.decade,
    })
    .eq('id', playerId)
  if (error) throw error
}

/**
 * Pick a winner from a tally.
 *
 * Plurality, with ties broken at random. Random matters: with three players
 * and four options a 1-1-1 split is ordinary, and any deterministic
 * tiebreak — first option listed, first vote cast, lowest player id — hands
 * the same person the decision every time. A coin flip is the only rule that
 * treats three strangers equally.
 */
function resolveTie<T extends string>(votes: (T | null | undefined)[], fallback: T): T {
  const counts = new Map<T, number>()
  for (const v of votes) {
    if (!v) continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  if (counts.size === 0) return fallback

  const top = Math.max(...counts.values())
  const leaders = [...counts.entries()].filter(([, n]) => n === top).map(([v]) => v)
  return leaders[Math.floor(Math.random() * leaders.length)]
}

export type VoteResult = {
  size: SizeVote
  difficulty: DifficultyVote
  decade: DecadeVote
}

export function tally(
  rows: { vote_size?: string | null; vote_difficulty?: string | null; vote_decade?: string | null }[],
): VoteResult {
  return {
    size: resolveTie(rows.map((r) => r.vote_size as SizeVote), 'half'),
    difficulty: resolveTie(rows.map((r) => r.vote_difficulty as DifficultyVote), 'standard'),
    decade: resolveTie(rows.map((r) => r.vote_decade as DecadeVote), 'any'),
  }
}

/**
 * Close the vote and start the game on a real episode matching what won.
 *
 * Seeding from an actual J-Archive game rather than assembling clues by filter
 * reuses the tested path, and means the difficulty and era are genuinely those
 * of a real broadcast rather than an approximation.
 */
export async function startVotedGame(gameId: string): Promise<VoteResult> {
  const { data: rows } = await supabase
    .from('players')
    .select('vote_size, vote_difficulty, vote_decade')
    .eq('game_id', gameId)

  const result = tally(rows ?? [])

  const diff = DIFFICULTY_OPTIONS.find((d) => d.id === result.difficulty)
  const era = DECADE_OPTIONS.find((d) => d.id === result.decade)

  // Persist what won so every client can show it, and so the board is built
  // at the size the room agreed on.
  const { data: gameRow } = await supabase
    .from('games').select('settings').eq('id', gameId).single()
  const settings = { ...(gameRow?.settings as any), gameLength: result.size, voteResult: result }
  await supabase.from('games').update({ settings }).eq('id', gameId)

  try {
    const matches = await searchGames({
      notesFilter: diff?.notesFilter,
      dateFrom: era?.from,
      dateTo: era?.to,
      limit: 50,
    })
    if (matches.length > 0) {
      const pick = matches[Math.floor(Math.random() * matches.length)]
      await startGameFromSource(gameId, pick.game_id_source)
      return result
    }
  } catch (e) {
    console.warn('[community-vote] episode lookup failed, falling back to random:', e)
  }

  // Nothing matched that combination — a random board still beats no game.
  await startGame(gameId)
  return result
}
