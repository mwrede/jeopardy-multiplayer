import { supabase } from './supabase'
import type { Game, Player, Category, Clue, GameSettings } from '@/types/game'

// Generate a 6-character room code
function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 for readability
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export async function createGame(settings: GameSettings) {
  const roomCode = generateRoomCode()

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

  return { game: game as Game }
}

export async function joinGame(roomCode: string, playerName: string) {
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('room_code', roomCode.toUpperCase())
    .eq('status', 'lobby')
    .single()

  if (gameError || !game) {
    throw new Error('Game not found or already started')
  }

  const { count } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', game.id)

  if ((count ?? 0) >= 8) {
    throw new Error('Game is full (max 8 players)')
  }

  const { data: existing } = await supabase
    .from('players')
    .select('id')
    .eq('game_id', game.id)
    .eq('name', playerName)
    .single()

  if (existing) {
    throw new Error('Name already taken in this game')
  }

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

export async function startGame(gameId: string) {
  const { error } = await supabase.rpc('start_game', {
    p_game_id: gameId,
  })

  if (error) throw error
}

/**
 * Select a clue from the board.
 * Updates the game to show the selected clue and changes phase.
 */
export async function selectClue(gameId: string, clueId: string, playerId: string) {
  // Get the clue to check if it's a daily double
  const { data: clue, error: clueError } = await supabase
    .from('clues')
    .select('*')
    .eq('id', clueId)
    .single()

  if (clueError || !clue) throw clueError || new Error('Clue not found')

  // Set the current clue and change phase
  const nextPhase = clue.is_daily_double ? 'daily_double_wager' : 'clue_reading'

  const { error } = await supabase
    .from('games')
    .update({
      current_clue_id: clueId,
      phase: nextPhase,
      current_player_id: playerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)

  if (error) throw error
}

/**
 * Submit a buzz.
 * Records the buzz and sets the player as the current answerer.
 */
export async function submitBuzz(gameId: string, clueId: string, playerId: string) {
  // Record the buzz
  const { error: buzzError } = await supabase
    .from('buzzes')
    .insert({
      game_id: gameId,
      clue_id: clueId,
      player_id: playerId,
      client_timestamp: performance.now(),
    })

  if (buzzError) throw buzzError

  // Set this player as the answerer
  const { error } = await supabase
    .from('games')
    .update({
      current_player_id: playerId,
      phase: 'player_answering',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)

  if (error) throw error
}

/**
 * Submit an answer to a clue.
 * For now, does a simple case-insensitive match.
 * TODO: Add fuzzy/AI answer judging.
 */
export async function submitAnswer(gameId: string, clueId: string, playerId: string, answer: string) {
  // Get the correct answer
  const { data: clue } = await supabase
    .from('clues')
    .select('answer, value')
    .eq('id', clueId)
    .single()

  if (!clue) throw new Error('Clue not found')

  // Simple answer check: normalize and compare
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const correct = normalize(answer).includes(normalize(clue.answer)) ||
                  normalize(clue.answer).includes(normalize(answer))

  const scoreChange = correct ? clue.value : -clue.value

  // Update player score
  const { data: player } = await supabase
    .from('players')
    .select('score')
    .eq('id', playerId)
    .single()

  if (player) {
    await supabase
      .from('players')
      .update({ score: player.score + scoreChange })
      .eq('id', playerId)
  }

  // Mark clue as answered
  await supabase
    .from('clues')
    .update({
      is_answered: true,
      answered_by: correct ? playerId : null,
    })
    .eq('id', clueId)

  // Move to next phase: if correct, this player picks next. If wrong, go back to buzz window or board.
  if (correct) {
    // Correct: this player picks next clue
    await supabase
      .from('games')
      .update({
        current_clue_id: null,
        phase: 'board_selection',
        current_player_id: playerId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
  } else {
    // Wrong: open buzz window for others (or go back to board if no one else can buzz)
    await supabase
      .from('games')
      .update({
        current_clue_id: null,
        phase: 'board_selection',
        // Keep current_player_id as the same player for now
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
  }

  return { correct, scoreChange }
}

/**
 * Submit a Daily Double wager.
 * After wagering, move to the answering phase.
 */
export async function submitWager(gameId: string, playerId: string, wager: number) {
  // Store the wager on the player (reuse final_wager field for DD too)
  await supabase
    .from('players')
    .update({ final_wager: wager })
    .eq('id', playerId)

  // Move to daily double answering phase
  const { error } = await supabase
    .from('games')
    .update({
      phase: 'daily_double_answering',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)

  if (error) throw error
}
