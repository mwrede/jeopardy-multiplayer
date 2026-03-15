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

/**
 * Start the game: pick random categories from clue_pool, create board, set daily doubles.
 * Also picks a Final Jeopardy clue and stores it on the game row.
 */
export async function startGame(gameId: string) {
  const ROUND_1_VALUES = [200, 400, 600, 800, 1000]
  const ROUND_2_VALUES = [400, 800, 1200, 1600, 2000]

  // Helper: pick N random categories that have at least 5 clues
  async function pickCategories(roundName: string, count: number) {
    const { data: allCats } = await supabase
      .from('clue_pool')
      .select('category')
      .eq('round', roundName)

    if (!allCats || allCats.length === 0) throw new Error(`No clues found for round: ${roundName}`)

    // Count clues per category
    const counts: Record<string, number> = {}
    for (const row of allCats) {
      counts[row.category] = (counts[row.category] || 0) + 1
    }

    // Filter to categories with >= 5 clues, then shuffle and pick
    const eligible = Object.keys(counts).filter(c => counts[c] >= 5)
    if (eligible.length < count) throw new Error(`Not enough categories for ${roundName} (need ${count}, found ${eligible.length})`)

    // Fisher-Yates shuffle
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]]
    }

    return eligible.slice(0, count)
  }

  // Helper: pick 5 random clues from a category
  async function pickClues(categoryName: string, roundName: string) {
    const { data: pool } = await supabase
      .from('clue_pool')
      .select('question, answer')
      .eq('category', categoryName)
      .eq('round', roundName)
      .limit(50)

    if (!pool || pool.length < 5) throw new Error(`Not enough clues for category: ${categoryName}`)

    // Shuffle and take 5
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]]
    }

    return pool.slice(0, 5)
  }

  // --- Round 1 ---
  const round1Cats = await pickCategories('Jeopardy Round', 6)
  const round1ClueIds: string[] = []

  for (let pos = 0; pos < round1Cats.length; pos++) {
    // Create category
    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .insert({ game_id: gameId, name: round1Cats[pos], round_number: 1, position: pos })
      .select('id')
      .single()
    if (catErr || !cat) throw catErr || new Error('Failed to create category')

    // Create 5 clues
    const clueData = await pickClues(round1Cats[pos], 'Jeopardy Round')
    for (let i = 0; i < 5; i++) {
      const { data: clue, error: clueErr } = await supabase
        .from('clues')
        .insert({
          category_id: cat.id,
          value: ROUND_1_VALUES[i],
          question: clueData[i].question,
          answer: clueData[i].answer,
          is_daily_double: false,
        })
        .select('id')
        .single()
      if (clueErr || !clue) throw clueErr || new Error('Failed to create clue')
      round1ClueIds.push(clue.id)
    }
  }

  // --- Round 2 ---
  const round2Cats = await pickCategories('Double Jeopardy', 6)
  const round2ClueIds: string[] = []

  for (let pos = 0; pos < round2Cats.length; pos++) {
    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .insert({ game_id: gameId, name: round2Cats[pos], round_number: 2, position: pos })
      .select('id')
      .single()
    if (catErr || !cat) throw catErr || new Error('Failed to create category')

    const clueData = await pickClues(round2Cats[pos], 'Double Jeopardy')
    for (let i = 0; i < 5; i++) {
      const { data: clue, error: clueErr } = await supabase
        .from('clues')
        .insert({
          category_id: cat.id,
          value: ROUND_2_VALUES[i],
          question: clueData[i].question,
          answer: clueData[i].answer,
          is_daily_double: false,
        })
        .select('id')
        .single()
      if (clueErr || !clue) throw clueErr || new Error('Failed to create clue')
      round2ClueIds.push(clue.id)
    }
  }

  // --- Daily Doubles ---
  // 1 in round 1
  const dd1 = round1ClueIds[Math.floor(Math.random() * round1ClueIds.length)]
  await supabase.from('clues').update({ is_daily_double: true }).eq('id', dd1)

  // 2 in round 2 (different clues)
  const dd2idx = Math.floor(Math.random() * round2ClueIds.length)
  await supabase.from('clues').update({ is_daily_double: true }).eq('id', round2ClueIds[dd2idx])

  let dd3idx = Math.floor(Math.random() * round2ClueIds.length)
  while (dd3idx === dd2idx) dd3idx = Math.floor(Math.random() * round2ClueIds.length)
  await supabase.from('clues').update({ is_daily_double: true }).eq('id', round2ClueIds[dd3idx])

  // --- Final Jeopardy ---
  // Pick a random Final Jeopardy clue from the pool
  let finalCategoryName = 'Final Jeopardy'
  let finalClueText = 'No Final Jeopardy clue available.'
  let finalAnswerText = ''

  const { data: fjCats } = await supabase
    .from('clue_pool')
    .select('category, question, answer')
    .eq('round', 'Final Jeopardy')
    .limit(50)

  if (fjCats && fjCats.length > 0) {
    const pick = fjCats[Math.floor(Math.random() * fjCats.length)]
    finalCategoryName = pick.category
    finalClueText = pick.question
    finalAnswerText = pick.answer
  }

  // --- Pick random first player ---
  const { data: players } = await supabase
    .from('players')
    .select('id')
    .eq('game_id', gameId)

  if (!players || players.length === 0) throw new Error('No players in game')
  const firstPlayer = players[Math.floor(Math.random() * players.length)]

  // --- Activate game ---
  const { error } = await supabase
    .from('games')
    .update({
      status: 'active',
      phase: 'board_selection',
      current_round: 1,
      current_player_id: firstPlayer.id,
      final_category_name: finalCategoryName,
      final_clue_text: finalClueText,
      final_answer: finalAnswerText,
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)

  if (error) throw error
}

/**
 * Check if the current round is complete (all clues answered).
 * If so, advance to the next round or Final Jeopardy.
 */
async function checkRoundComplete(gameId: string, currentRound: number) {
  // Get all categories for the current round
  const { data: roundCats } = await supabase
    .from('categories')
    .select('id')
    .eq('game_id', gameId)
    .eq('round_number', currentRound)

  if (!roundCats || roundCats.length === 0) return false

  const catIds = roundCats.map((c) => c.id)

  // Count unanswered clues
  const { count } = await supabase
    .from('clues')
    .select('*', { count: 'exact', head: true })
    .in('category_id', catIds)
    .eq('is_answered', false)

  if ((count ?? 1) > 0) return false

  // All clues answered — advance!
  if (currentRound === 1) {
    // Move to round_end, then Double Jeopardy
    // Find the player with the lowest score to go first in Double Jeopardy
    const { data: players } = await supabase
      .from('players')
      .select('id, score')
      .eq('game_id', gameId)
      .order('score', { ascending: true })

    const nextPlayer = players?.[0]?.id || null

    await supabase
      .from('games')
      .update({
        phase: 'round_end',
        current_round: 2,
        current_clue_id: null,
        current_player_id: nextPlayer,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
  } else if (currentRound === 2) {
    // Move to Final Jeopardy
    await supabase
      .from('games')
      .update({
        status: 'final_jeopardy',
        phase: 'final_category',
        current_round: 3,
        current_clue_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
  }

  return true
}

/**
 * Advance from round_end splash screen to the board for the next round.
 * Called by the display page after showing the transition screen.
 */
export async function advanceFromRoundEnd(gameId: string) {
  await supabase
    .from('games')
    .update({
      phase: 'board_selection',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)
}

/**
 * Advance Final Jeopardy from category reveal to wager phase.
 */
export async function advanceToFinalWager(gameId: string) {
  // Reset all players' final wager/answer fields
  const { data: players } = await supabase
    .from('players')
    .select('id')
    .eq('game_id', gameId)

  if (players) {
    for (const p of players) {
      await supabase
        .from('players')
        .update({ final_wager: null, final_answer: null, final_correct: null })
        .eq('id', p.id)
    }
  }

  await supabase
    .from('games')
    .update({
      phase: 'final_wager',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)
}

/**
 * Advance Final Jeopardy from wager to showing the clue.
 */
export async function advanceToFinalClue(gameId: string) {
  await supabase
    .from('games')
    .update({
      phase: 'final_clue',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)
}

/**
 * Advance Final Jeopardy from clue to answering phase.
 */
export async function advanceToFinalAnswering(gameId: string) {
  await supabase
    .from('games')
    .update({
      phase: 'final_answering',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)
}

/**
 * Submit a Final Jeopardy wager.
 */
export async function submitFinalWager(playerId: string, wager: number) {
  await supabase
    .from('players')
    .update({ final_wager: wager })
    .eq('id', playerId)
}

/**
 * Submit a Final Jeopardy answer.
 */
export async function submitFinalAnswer(playerId: string, answer: string) {
  await supabase
    .from('players')
    .update({ final_answer: answer })
    .eq('id', playerId)
}

/**
 * Start the Final Jeopardy reveal sequence.
 * Judges all answers and moves to the reveal phase.
 */
export async function startFinalReveal(gameId: string) {
  // Get the game to get the correct answer
  const { data: game } = await supabase
    .from('games')
    .select('final_answer')
    .eq('id', gameId)
    .single()

  if (!game) throw new Error('Game not found')

  const correctAnswer = game.final_answer || ''
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

  // Get all players and judge their answers
  const { data: players } = await supabase
    .from('players')
    .select('id, score, final_wager, final_answer')
    .eq('game_id', gameId)

  if (players) {
    for (const p of players) {
      const playerAnswer = p.final_answer || ''
      const wager = p.final_wager || 0
      const correct =
        normalize(playerAnswer).includes(normalize(correctAnswer)) ||
        normalize(correctAnswer).includes(normalize(playerAnswer))

      const scoreChange = correct ? wager : -wager

      await supabase
        .from('players')
        .update({
          final_correct: correct,
          score: p.score + scoreChange,
        })
        .eq('id', p.id)
    }
  }

  await supabase
    .from('games')
    .update({
      phase: 'final_reveal',
      status: 'finished',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)
}

/**
 * Move to game_over after final reveal.
 */
export async function advanceToGameOver(gameId: string) {
  await supabase
    .from('games')
    .update({
      phase: 'game_over',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)
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
 * After answering, checks if the round is complete and auto-advances.
 */
export async function submitAnswer(gameId: string, clueId: string, playerId: string, answer: string) {
  // Get the correct answer and the game's current round
  const [{ data: clue }, { data: game }] = await Promise.all([
    supabase.from('clues').select('answer, value').eq('id', clueId).single(),
    supabase.from('games').select('current_round').eq('id', gameId).single(),
  ])

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

  // Go to clue_result phase to show the result animation
  // Keep current_clue_id and current_player_id so displays can show who answered
  await supabase
    .from('games')
    .update({
      phase: 'clue_result',
      current_player_id: playerId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)

  return { correct, scoreChange }
}

/**
 * Advance from clue_result to next state.
 * Checks if the round is complete and routes accordingly.
 * Called by the display page after showing the result animation.
 */
export async function advanceFromClueResult(gameId: string) {
  const { data: game } = await supabase
    .from('games')
    .select('current_round')
    .eq('id', gameId)
    .single()

  const currentRound = game?.current_round ?? 1
  const roundComplete = await checkRoundComplete(gameId, currentRound)

  if (!roundComplete) {
    // Round continues — go back to board selection
    await supabase
      .from('games')
      .update({
        current_clue_id: null,
        phase: 'board_selection',
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
  }
  // If roundComplete, checkRoundComplete already set the phase to round_end or final_category
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
