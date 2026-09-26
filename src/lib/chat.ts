/**
 * In-game chat.
 *
 * Deliberately small: a room's worth of messages, newest last, no threads, no
 * editing, no reactions. It exists so a table of strangers can say "nice one"
 * and "brutal category", which is most of what makes playing with people
 * different from playing alone.
 *
 * Everything here tolerates the table not existing. supabase-migration-chat.sql
 * is hand-run like every other migration in this repo, and until it is, the
 * chat button simply doesn't appear rather than throwing at people mid-game.
 */

import { supabase } from './supabase'

export const MAX_MESSAGE_LENGTH = 300

/** How far back a room remembers. Plenty for one game; keeps the first load
 *  small on a long one. */
const HISTORY = 200

/** Where a conversation lives: inside one game, or in a standing room such
 *  as the Community lobby. */
export type ChatScope = { gameId: string } | { room: string }

export const scopeKey = (s: ChatScope) => ('gameId' in s ? `game:${s.gameId}` : `room:${s.room}`)

export type ChatMessage = {
  id: string
  game_id: string | null
  room: string | null
  player_id: string | null
  player_name: string
  body: string
  created_at: string
}

/** True when the failure is "chat_messages isn't there yet". */
export function isMissingTable(message: string | undefined): boolean {
  if (!message) return false
  return /chat_messages/i.test(message) && /(does not exist|not find|schema cache)/i.test(message)
}

export type ChatLoad =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; missing: boolean }

export async function loadMessages(scope: ChatScope): Promise<ChatLoad> {
  let q = supabase
    .from('chat_messages')
    .select('id, game_id, room, player_id, player_name, body, created_at')
  q = 'gameId' in scope ? q.eq('game_id', scope.gameId) : q.eq('room', scope.room)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(HISTORY)

  if (error) return { ok: false, missing: isMissingTable(error.message) }
  // Fetched newest-first so the LIMIT keeps the most recent; shown oldest-first.
  return { ok: true, messages: (data ?? []).reverse() as ChatMessage[] }
}

/**
 * Post a message. Returns false if it didn't land, so the composer can put the
 * text back rather than swallowing what someone typed.
 */
export async function sendMessage(
  scope: ChatScope,
  playerId: string | null,
  playerName: string,
  body: string,
): Promise<boolean> {
  const text = body.trim().slice(0, MAX_MESSAGE_LENGTH)
  if (!text) return false

  const { error } = await supabase.from('chat_messages').insert({
    game_id: 'gameId' in scope ? scope.gameId : null,
    room: 'room' in scope ? scope.room : null,
    player_id: playerId,
    player_name: (playerName || 'Player').slice(0, 40),
    body: text,
  })
  if (error) {
    console.warn('[chat] send failed:', error.message)
    return false
  }
  return true
}
