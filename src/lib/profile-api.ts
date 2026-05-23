import { supabase } from './supabase'

export type ProfileStats = {
  gamesPlayed: number
  wins: number
  winRate: number       // 0..1
  totalPoints: number
}

export type OpponentSummary = {
  name: string
  userId: string | null
  encounters: number
}

export type BoardSummary = {
  id: string
  title: string
  is_public: boolean
  created_at: string
}

/**
 * Compute lifetime stats from the players table.
 * A "win" is when this user had the top score in a finished game (ties count as a win).
 * Counts only games that reached game_over so in-progress games don't skew the rate.
 */
export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const empty: ProfileStats = { gamesPlayed: 0, wins: 0, winRate: 0, totalPoints: 0 }
  const { data: myPlayers, error } = await supabase
    .from('players')
    .select('id, game_id, score, games!inner(id, phase)')
    .eq('user_id', userId)
    .eq('games.phase', 'game_over')
  if (error) {
    console.warn('[profile] stats query failed (migration not applied?):', error.message)
    return empty
  }
  if (!myPlayers || myPlayers.length === 0) return empty

  const gameIds = myPlayers.map((p: any) => p.game_id)
  const { data: allPlayers } = await supabase
    .from('players')
    .select('game_id, score')
    .in('game_id', gameIds)

  const maxByGame = new Map<string, number>()
  for (const p of allPlayers || []) {
    const cur = maxByGame.get((p as any).game_id) ?? -Infinity
    if ((p as any).score > cur) maxByGame.set((p as any).game_id, (p as any).score)
  }

  let wins = 0
  let totalPoints = 0
  for (const p of myPlayers as any[]) {
    totalPoints += p.score ?? 0
    if ((p.score ?? -Infinity) === maxByGame.get(p.game_id)) wins += 1
  }

  const gamesPlayed = myPlayers.length
  return {
    gamesPlayed,
    wins,
    winRate: gamesPlayed > 0 ? wins / gamesPlayed : 0,
    totalPoints,
  }
}

/**
 * Returns the names of opponents this user has faced (any phase), sorted by
 * how many games they shared.
 */
export async function getOpponentsPlayed(userId: string, limit: number = 50): Promise<OpponentSummary[]> {
  const { data: myRows, error: myErr } = await supabase
    .from('players')
    .select('game_id')
    .eq('user_id', userId)
  if (myErr) {
    console.warn('[profile] opponents query failed (migration not applied?):', myErr.message)
    return []
  }
  if (!myRows || myRows.length === 0) return []

  const gameIds = Array.from(new Set(myRows.map((r: any) => r.game_id as string)))

  const { data: otherRows } = await supabase
    .from('players')
    .select('game_id, name, user_id')
    .in('game_id', gameIds)
    .neq('user_id', userId)
  if (!otherRows) return []

  type Key = string
  const buckets = new Map<Key, OpponentSummary>()
  for (const row of otherRows as any[]) {
    const key = row.user_id || `name:${row.name}`
    const existing = buckets.get(key)
    if (existing) {
      existing.encounters += 1
    } else {
      buckets.set(key, {
        name: row.name,
        userId: row.user_id || null,
        encounters: 1,
      })
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => b.encounters - a.encounters)
    .slice(0, limit)
}

/**
 * Boards this user authored (public + private), newest first.
 */
export async function getMyBoards(userId: string): Promise<BoardSummary[]> {
  const { data, error } = await supabase
    .from('custom_boards')
    .select('id, title, is_public, created_at')
    .eq('creator_user_id', userId)
    .order('created_at', { ascending: false })
  if (error) {
    console.warn('[profile] my boards query failed (migration not applied?):', error.message)
    return []
  }
  return (data as BoardSummary[]) || []
}
