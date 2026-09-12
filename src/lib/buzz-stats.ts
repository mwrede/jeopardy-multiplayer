import { supabase } from '@/lib/supabase'

/**
 * THE BUZZER TAPE — what each player actually did, clue by clue, kept for the
 * whole game rather than just the clue on screen.
 *
 * Every buzz already carries the one number that matters: how long that player
 * took to press after their own buzzer armed (buzzes.reaction_ms, written by
 * the device itself so wifi and clock skew can't flatter or punish anybody).
 * Rolled up per player that gives the end-of-game report — who was quickest on
 * the buzzer, who rang in most, and who converted it.
 *
 * Works for every game, whatever board it was built from, because it reads the
 * buzzes rather than anything the board had to record for it.
 */
export type PlayerBuzzStats = {
  player_id: string
  /** Clues this player rang in on (passes don't count). */
  buzzes: number
  /** Races won — clues where they got to answer. */
  won: number
  correct: number
  wrong: number
  /** Mean reaction across their timed buzzes, ms. Null before the migration. */
  avgReactionMs: number | null
  /** Their quickest buzz of the game, ms. */
  bestReactionMs: number | null
}

/**
 * Per-player buzzer stats for a whole game, quickest average first. Players
 * with no timed buzz sort last; players who never buzzed are left out.
 */
export async function getGameBuzzStats(gameId: string): Promise<PlayerBuzzStats[]> {
  const columns = 'player_id, is_winner, is_correct, is_pass, reaction_ms'
  let { data, error } = await supabase
    .from('buzzes')
    .select(columns)
    .eq('game_id', gameId)
    .eq('is_pass', false)

  // reaction_ms only exists once supabase-migration-buzz-reaction.sql is run.
  // Without it the counts are still worth showing, just untimed.
  if (error && /reaction_ms/.test(error.message)) {
    const retry = await supabase
      .from('buzzes')
      .select('player_id, is_winner, is_correct, is_pass')
      .eq('game_id', gameId)
      .eq('is_pass', false)
    data = retry.data as any[]
    error = retry.error
  }
  if (error) {
    console.warn('[getGameBuzzStats] failed:', error.message)
    return []
  }

  const byPlayer = new Map<string, PlayerBuzzStats & { _times: number[] }>()
  for (const row of (data || []) as any[]) {
    let s = byPlayer.get(row.player_id)
    if (!s) {
      s = {
        player_id: row.player_id,
        buzzes: 0,
        won: 0,
        correct: 0,
        wrong: 0,
        avgReactionMs: null,
        bestReactionMs: null,
        _times: [],
      }
      byPlayer.set(row.player_id, s)
    }
    s.buzzes++
    if (row.is_winner) s.won++
    if (row.is_correct === true) s.correct++
    if (row.is_correct === false) s.wrong++
    if (typeof row.reaction_ms === 'number') s._times.push(row.reaction_ms)
  }

  const stats = [...byPlayer.values()].map(({ _times, ...s }) => ({
    ...s,
    avgReactionMs: _times.length
      ? Math.round(_times.reduce((a, b) => a + b, 0) / _times.length)
      : null,
    bestReactionMs: _times.length ? Math.min(..._times) : null,
  }))

  return stats.sort((a, b) => {
    // Quickest average first; anyone untimed drops to the bottom, ranked by
    // how often they got in instead.
    if (a.avgReactionMs !== null && b.avgReactionMs !== null) return a.avgReactionMs - b.avgReactionMs
    if (a.avgReactionMs !== null) return -1
    if (b.avgReactionMs !== null) return 1
    return b.won - a.won
  })
}

/** "0.42s" — the one format reaction times are shown in, everywhere. */
export function formatReaction(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !isFinite(ms)) return '—'
  return `${(ms / 1000).toFixed(2)}s`
}
