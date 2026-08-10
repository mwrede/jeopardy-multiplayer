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
): Promise<{ roomCode: string; started: boolean }> {
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
    return { roomCode, started: true }
  }

  return { roomCode, started: false }
}

/**
 * One button: sit down wherever there's room, opening a lobby only if every
 * existing one is full or stale. Tries the fullest first so games start soon.
 */
export async function findOrCreateGame(
  playerName: string,
  userId: string,
): Promise<{ roomCode: string; started: boolean }> {
  if (!userId) throw new Error('Sign in to play Community games.')
  const open = await listCommunityLobbies()

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
