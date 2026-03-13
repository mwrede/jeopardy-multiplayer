import { supabase } from './supabase'
import type { Game, Player, Category, Clue, GameSettings, DEFAULT_CASUAL_SETTINGS } from '@/types/game'

// Generate a 6-character room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 for readability
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export async function createGame(playerName: string, settings: GameSettings) {
  const roomCode = generateRoomCode()

  // Create the game
  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      room_code: roomCode,
      status: 'lobby',
      current_round: 1,
      phase: 'lobby',
      settings,
    })
    .select()
    .single()

  if (gameError) throw gameError

  // Add the creating player
  const { data: player, error: playerError } = await supabase
    .from('players')
    .insert({
      game_id: game.id,
      name: playerName,
      join_order: 1,
      is_ready: false,
    })
    .select()
    .single()

  if (playerError) throw playerError

  return { game: game as Game, player: player as Player }
}

export async function joinGame(roomCode: string, playerName: string) {
  // Find the game
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('room_code', roomCode.toUpperCase())
    .eq('status', 'lobby')
    .single()

  if (gameError || !game) {
    throw new Error('Game not found or already started')
  }

  // Check player count
  const { count } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', game.id)

  if ((count ?? 0) >= 8) {
    throw new Error('Game is full (max 8 players)')
  }

  // Check name uniqueness
  const { data: existing } = await supabase
    .from('players')
    .select('id')
    .eq('game_id', game.id)
    .eq('name', playerName)
    .single()

  if (existing) {
    throw new Error('Name already taken in this game')
  }

  // Add the player
  const { data: player, error: playerError } = await supabase
    .from('players')
    .insert({
      game_id: game.id,
      name: playerName,
      join_order: (count ?? 0) + 1,
      is_ready: false,
    })
    .select()
    .single()

  if (playerError) throw playerError

  return { game: game as Game, player: player as Player }
}

export async function setReady(playerId: string, isReady: boolean) {
  const { error } = await supabase
    .from('players')
    .update({ is_ready: isReady })
    .eq('id', playerId)

  if (error) throw error
}

export async function getGameState(gameId: string) {
  const [gameRes, playersRes, categoriesRes, cluesRes] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    supabase.from('players').select('*').eq('game_id', gameId).order('join_order'),
    supabase.from('categories').select('*').eq('game_id', gameId).order('position'),
    supabase
      .from('clues')
      .select('*, categories!inner(game_id)')
      .eq('categories.game_id', gameId),
  ])

  return {
    game: gameRes.data as Game,
    players: playersRes.data as Player[],
    categories: categoriesRes.data as Category[],
    clues: cluesRes.data as Clue[],
  }
}

export async function selectClue(gameId: string, clueId: string, playerId: string) {
  // The server validates that it's this player's turn
  const { data, error } = await supabase.rpc('select_clue', {
    p_game_id: gameId,
    p_clue_id: clueId,
    p_player_id: playerId,
  })

  if (error) throw error
  return data
}

export async function submitBuzz(gameId: string, clueId: string, playerId: string) {
  const clientTimestamp = performance.now()

  const { data, error } = await supabase
    .from('buzzes')
    .insert({
      game_id: gameId,
      clue_id: clueId,
      player_id: playerId,
      client_timestamp: clientTimestamp,
    })
    .select()
    .single()

  if (error) throw error
  return data as Buzz
}

export async function submitAnswer(gameId: string, clueId: string, playerId: string, answer: string) {
  const { data, error } = await supabase.rpc('submit_answer', {
    p_game_id: gameId,
    p_clue_id: clueId,
    p_player_id: playerId,
    p_answer: answer,
  })

  if (error) throw error
  return data
}

export async function submitWager(gameId: string, playerId: string, wager: number) {
  const { error } = await supabase.rpc('submit_wager', {
    p_game_id: gameId,
    p_player_id: playerId,
    p_wager: wager,
  })

  if (error) throw error
}

export async function startGame(gameId: string) {
  const { error } = await supabase.rpc('start_game', {
    p_game_id: gameId,
  })

  if (error) throw error
}

type Buzz = {
  id: string
  game_id: string
  clue_id: string
  player_id: string
  client_timestamp: number
}
