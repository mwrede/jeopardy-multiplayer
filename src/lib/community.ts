/**
 * Community Play — drop-in games with strangers.
 *
 * Three players to a game; it starts the moment the third joins, so nobody
 * waits on a host.
 *
 * Lobbies are made on demand rather than kept open in a pool. Holding five
 * empty rooms sounds tidier but goes wrong quickly: every visitor would have
 * to top the pool up, so ten simultaneous visitors each creating five leaves
 * fifty rooms, and nothing ever cleans up the ones no one joined. Creating a
 * lobby only when someone actually needs a seat means the list only ever shows
 * real people waiting, and there's nothing to reap.
 *
 * Lobbies are ordinary games flagged with settings.community, so a private
 * game can never surface here.
 */

import { supabase } from './supabase'
import { createGame, joinGame } from './game-api'
import { DEFAULT_CASUAL_SETTINGS } from '@/types/game'

export const LOBBY_SEATS = 3

/**
 * A hung Supabase call leaves the UI spinning with nothing to show for it —
 * no result, no error. Everything here races a timeout so a stall surfaces as
 * a message instead of a button stuck on "Finding a game…".
 */
const TIMEOUT_MS = 12_000

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out. Check your connection and try again.`)), TIMEOUT_MS),
    ),
  ])
}

/** Ignore lobbies left sitting this long — the people in them are long gone. */
const STALE_MINUTES = 45

export type CommunityLobby = {
  id: string
  roomCode: string
  playerCount: number
  createdAt: string
}

/**
 * Games with someone waiting, fullest first — a lobby needing one more player
 * should fill before an empty one.
 */
export async function listCommunityLobbies(): Promise<CommunityLobby[]> {
  const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString()

  const { data: games, error } = await supabase
    .from('games')
    .select('id, room_code, created_at, settings')
    .eq('status', 'lobby')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw error

  const community = (games ?? []).filter((g: any) => (g.settings as any)?.community === true)
  if (community.length === 0) return []

  // One query for all the counts rather than one per lobby.
  const { data: players } = await supabase
    .from('players')
    .select('game_id')
    .in('game_id', community.map((g: any) => g.id))

  const counts = new Map<string, number>()
  for (const p of players ?? []) {
    counts.set((p as any).game_id, (counts.get((p as any).game_id) ?? 0) + 1)
  }

  return community
    .map((g: any) => ({
      id: g.id,
      roomCode: g.room_code,
      playerCount: counts.get(g.id) ?? 0,
      createdAt: g.created_at,
    }))
    .filter((l) => l.playerCount > 0 && l.playerCount < LOBBY_SEATS)
    .sort((a, b) => b.playerCount - a.playerCount)
}

/** Open a fresh community lobby and return its room code. */
async function createCommunityLobby(): Promise<string> {
  const settings: any = {
    ...DEFAULT_CASUAL_SETTINGS,
    gameMode: 'multiplayer',
    gameLength: 'half',
    community: true,
  }
  const { game } = await createGame(settings, true)
  return game.room_code
}

/**
 * Take a seat in a specific lobby. Returns whether this join filled it and
 * started the game.
 *
 * The seat check isn't atomic — two people can clear it in the same instant
 * and make a table of four. The cost is a roomier game rather than a broken
 * one; making it airtight would need a Postgres function like resolve_buzz.
 */
export async function joinCommunityLobby(
  roomCode: string,
  playerName: string,
  userId: string,
): Promise<{ roomCode: string; started: boolean; playerId: string }> {
  // An account is required here, unlike everywhere else in the app: results
  // are ranked, and without one there's no way to tell two players apart or
  // to credit a win to anyone.
  if (!userId) throw new Error('Sign in to play Community games.')

  const { player, game } = await joinGame(roomCode, playerName, userId)

  localStorage.setItem('playerId', player.id)
  localStorage.setItem('playerName', player.name)

  const { count } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', game.id)

  if ((count ?? 0) >= LOBBY_SEATS) {
    // Full: open the vote rather than starting. Three strangers should agree
    // on what they're playing before a board appears.
    await supabase
      .from('games')
      .update({ phase: 'game_voting', updated_at: new Date().toISOString() })
      .eq('id', game.id)
      .eq('phase', 'lobby')
    return { roomCode, started: true, playerId: player.id }
  }

  return { roomCode, started: false, playerId: player.id }
}

/**
 * Get up from a table, from the waiting page or mid-vote or mid-game.
 *
 * Three-handed is the format, so losing a player means the others can't carry
 * on — the game rewinds to waiting and everyone left keeps their seat while a
 * replacement is found. Votes are cleared so the next round starts clean.
 */
export async function leaveCommunityLobby(playerId: string, gameId?: string): Promise<void> {
  await supabase.from('players').delete().eq('id', playerId)
  if (!gameId) return

  const { data: game } = await supabase
    .from('games').select('phase, status, settings').eq('id', gameId).maybeSingle()
  if (!game || (game.settings as any)?.community !== true) return
  // A finished game keeps its result — the leaderboard needs it.
  if (game.status === 'finished') return

  const { count } = await supabase
    .from('players').select('id', { count: 'exact', head: true }).eq('game_id', gameId)

  if ((count ?? 0) < LOBBY_SEATS) {
    // Clear votes so the next full table decides fresh, and drop any board
    // that was already dealt.
    await supabase
      .from('players')
      .update({ vote_size: null, vote_difficulty: null, vote_decade: null, score: 0 })
      .eq('game_id', gameId)

    await supabase
      .from('games')
      .update({
        phase: 'lobby',
        status: 'lobby',
        current_clue_id: null,
        current_player_id: null,
        buzz_window_open: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
  }
}

/** Current state of one lobby — used to watch a seat fill in real time. */
export async function getLobbyState(roomCode: string): Promise<{
  gameId: string
  phase: string
  players: { id: string; name: string }[]
} | null> {
  const { data: game } = await supabase
    .from('games').select('id, phase').eq('room_code', roomCode).maybeSingle()
  if (!game) return null

  const { data: players } = await supabase
    .from('players').select('id, name').eq('game_id', game.id).order('join_order')

  return { gameId: game.id, phase: (game as any).phase, players: (players ?? []) as any }
}

/**
 * One button: sit down wherever there's room, opening a lobby only if every
 * existing one is full or stale. Tries the fullest first so games start soon.
 */
export async function findOrCreateGame(
  playerName: string,
  userId: string,
): Promise<{ roomCode: string; started: boolean; playerId: string }> {
  if (!userId) throw new Error('Sign in to play Community games.')
  return withTimeout(findOrCreateGameInner(playerName, userId), 'Finding a game')
}

async function findOrCreateGameInner(
  playerName: string,
  userId: string,
): Promise<{ roomCode: string; started: boolean; playerId: string }> {
  const open = await listCommunityLobbies().catch(() => [])

  for (const lobby of open) {
    try {
      return await joinCommunityLobby(lobby.roomCode, playerName, userId)
    } catch (e) {
      // Someone took the last seat between listing and joining — try the next.
      console.warn('[community] lobby full, trying another:', e)
    }
  }

  const roomCode = await createCommunityLobby()
  return joinCommunityLobby(roomCode, playerName, userId)
}
