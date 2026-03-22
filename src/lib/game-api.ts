import { supabase } from './supabase'
import type { Game, Player, Category, Clue, GameSettings, GameSearchResult, GameSearchFilters } from '@/types/game'
import { GAME_LENGTH_CONFIG } from '@/types/game'

/**
 * Jeopardy answer checker.
 * Handles: case insensitivity, articles (a/an/the), "What is/Who is" prefixes,
 * punctuation, common abbreviations, partial matches, and fuzzy matching.
 */
function checkAnswer(playerAnswer: string, correctAnswer: string): boolean {
  // Strip "What is", "Who is", "Where is", etc. prefixes
  function stripPrefix(s: string): string {
    return s.replace(/^(what|who|where|when|how)\s+(is|are|was|were)\s+/i, '').trim()
  }

  // Normalize: lowercase, strip articles, punctuation, extra spaces
  function normalize(s: string): string {
    return s
      .toLowerCase()
      .replace(/['']/g, "'")         // normalize quotes
      .replace(/[""]/g, '"')         // normalize double quotes
      .replace(/\(.*?\)/g, '')       // remove parenthetical notes
      .replace(/^(a|an|the)\s+/i, '') // strip leading articles
      .replace(/[^a-z0-9\s]/g, '')   // remove punctuation
      .replace(/\s+/g, ' ')          // collapse whitespace
      .trim()
  }

  // Common abbreviations and expansions
  function expandAbbreviations(s: string): string {
    return s
      .replace(/\bst\b/g, 'saint')
      .replace(/\bmt\b/g, 'mount')
      .replace(/\bdr\b/g, 'doctor')
      .replace(/\bmr\b/g, 'mister')
      .replace(/\bmrs\b/g, 'missus')
      .replace(/\bft\b/g, 'fort')
      .replace(/\bnyc\b/g, 'new york city')
      .replace(/\bla\b/g, 'los angeles')
      .replace(/\bdc\b/g, 'district of columbia')
      .replace(/\buk\b/g, 'united kingdom')
      .replace(/\bus\b/g, 'united states')
      .replace(/\busa\b/g, 'united states of america')
  }

  const player = normalize(stripPrefix(playerAnswer))
  const correct = normalize(correctAnswer)

  // Exact match after normalization
  if (player === correct) return true

  // Try with abbreviation expansion
  const playerExp = expandAbbreviations(player)
  const correctExp = expandAbbreviations(correct)
  if (playerExp === correctExp) return true

  // Substring containment (either direction)
  // Handles: player says "Lincoln" for "Abraham Lincoln"
  if (player.length >= 3 && (correct.includes(player) || player.includes(correct))) return true
  if (playerExp.length >= 3 && (correctExp.includes(playerExp) || playerExp.includes(correctExp))) return true

  // Try matching without articles anywhere in the string
  function stripAllArticles(s: string): string {
    return s.replace(/\b(a|an|the)\b/g, '').replace(/\s+/g, ' ').trim()
  }
  if (stripAllArticles(player) === stripAllArticles(correct)) return true

  // Handle answers with "/" alternatives (e.g., "dogs/canines")
  const alternatives = correctAnswer.split(/[\/&]/).map((a) => normalize(a.trim()))
  if (alternatives.some((alt) => alt.length >= 2 && (alt === player || alt.includes(player) || player.includes(alt)))) return true

  // Levenshtein distance for typo tolerance (allow ~15% error rate)
  function levenshtein(a: string, b: string): number {
    const matrix: number[][] = []
    for (let i = 0; i <= a.length; i++) {
      matrix[i] = [i]
      for (let j = 1; j <= b.length; j++) {
        matrix[i][j] = i === 0 ? j : 0
      }
    }
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        )
      }
    }
    return matrix[a.length][b.length]
  }

  const maxLen = Math.max(player.length, correct.length)
  if (maxLen >= 4) {
    const dist = levenshtein(player, correct)
    const threshold = Math.max(1, Math.floor(maxLen * 0.2)) // 20% tolerance
    if (dist <= threshold) return true
  }

  // Number matching: "5" matches "five", etc.
  const numberWords: Record<string, string> = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
    '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen',
    '14': 'fourteen', '15': 'fifteen', '16': 'sixteen', '17': 'seventeen',
    '18': 'eighteen', '19': 'nineteen', '20': 'twenty',
  }
  function replaceNumbers(s: string): string {
    return s.replace(/\d+/g, (match) => numberWords[match] || match)
  }
  if (replaceNumbers(player) === replaceNumbers(correct)) return true

  return false
}

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
  // Find game by room code — allow joining in any non-finished status
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('room_code', roomCode.toUpperCase())
    .neq('phase', 'game_over')
    .single()

  if (gameError || !game) {
    throw new Error('Game not found or already finished')
  }

  // Check if player with this name already exists (reconnect)
  const { data: existing } = await supabase
    .from('players')
    .select('*')
    .eq('game_id', game.id)
    .eq('name', playerName)
    .single()

  if (existing) {
    // Reconnect: update connection status and return existing player
    await supabase
      .from('players')
      .update({ is_connected: true })
      .eq('id', existing.id)

    return { game: game as Game, player: existing as Player }
  }

  // New player joining
  const { count } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', game.id)

  if ((count ?? 0) >= 8) {
    throw new Error('Game is full (max 8 players)')
  }

  // For mid-game joins, auto-set ready and start with 0 score
  const isActive = game.status !== 'lobby'

  const { data: player, error: playerError } = await supabase
    .from('players')
    .insert({
      game_id: game.id,
      name: playerName,
      join_order: (count ?? 0) + 1,
      is_ready: isActive, // auto-ready if game already started
    })
    .select()
    .single()

  if (playerError) throw playerError

  return { game: game as Game, player: player as Player }
}

/**
 * Remove a player from the game (kick from lobby).
 */
export async function removePlayer(playerId: string) {
  await supabase.from('players').delete().eq('id', playerId)
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
 * Respects gameLength setting (full/half/rapid).
 */
export async function startGame(gameId: string) {
  console.log('[startGame] Starting RANDOM game (no sourceGameId)')
  // Get game settings to determine game length
  const { data: gameRow } = await supabase
    .from('games')
    .select('settings')
    .eq('id', gameId)
    .single()

  const settings = gameRow?.settings as GameSettings | null
  const lengthConfig = GAME_LENGTH_CONFIG[settings?.gameLength || 'full']
  const ROUND_1_VALUES = lengthConfig.values1
  const ROUND_2_VALUES = lengthConfig.values2
  const NUM_CATEGORIES = lengthConfig.categories
  const CLUES_PER_CAT = lengthConfig.cluesPerCat

  // Helper: pick N random categories that have enough clues
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

    // Filter to categories with enough clues, then shuffle and pick
    const eligible = Object.keys(counts).filter(c => counts[c] >= CLUES_PER_CAT)
    if (eligible.length < count) throw new Error(`Not enough categories for ${roundName} (need ${count}, found ${eligible.length})`)

    // Fisher-Yates shuffle
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]]
    }

    return eligible.slice(0, count)
  }

  // Helper: pick random clues from a category
  async function pickClues(categoryName: string, roundName: string) {
    const { data: pool } = await supabase
      .from('clue_pool')
      .select('question, answer')
      .eq('category', categoryName)
      .eq('round', roundName)
      .limit(50)

    if (!pool || pool.length < CLUES_PER_CAT) throw new Error(`Not enough clues for category: ${categoryName}`)

    // Shuffle and take CLUES_PER_CAT
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]]
    }

    return pool.slice(0, CLUES_PER_CAT)
  }

  // --- Round 1 ---
  const round1Cats = await pickCategories('Jeopardy Round', NUM_CATEGORIES)
  const round1ClueIds: string[] = []

  for (let pos = 0; pos < round1Cats.length; pos++) {
    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .insert({ game_id: gameId, name: round1Cats[pos], round_number: 1, position: pos })
      .select('id')
      .single()
    if (catErr || !cat) throw catErr || new Error('Failed to create category')

    const clueData = await pickClues(round1Cats[pos], 'Jeopardy Round')
    for (let i = 0; i < CLUES_PER_CAT; i++) {
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
  const round2Cats = await pickCategories('Double Jeopardy', NUM_CATEGORIES)
  const round2ClueIds: string[] = []

  for (let pos = 0; pos < round2Cats.length; pos++) {
    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .insert({ game_id: gameId, name: round2Cats[pos], round_number: 2, position: pos })
      .select('id')
      .single()
    if (catErr || !cat) throw catErr || new Error('Failed to create category')

    const clueData = await pickClues(round2Cats[pos], 'Double Jeopardy')
    for (let i = 0; i < CLUES_PER_CAT; i++) {
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

  // --- Daily Doubles (count based on game length) ---
  // Round 1 DDs
  if (round1ClueIds.length > 0) {
    const dd1 = round1ClueIds[Math.floor(Math.random() * round1ClueIds.length)]
    await supabase.from('clues').update({ is_daily_double: true }).eq('id', dd1)
  }

  // Round 2 DDs
  if (round2ClueIds.length > 0) {
    const dd2idx = Math.floor(Math.random() * round2ClueIds.length)
    await supabase.from('clues').update({ is_daily_double: true }).eq('id', round2ClueIds[dd2idx])

    // Second DD in round 2 only for full games
    if (lengthConfig.dd2 >= 2 && round2ClueIds.length > 1) {
      let dd3idx = Math.floor(Math.random() * round2ClueIds.length)
      while (dd3idx === dd2idx) dd3idx = Math.floor(Math.random() * round2ClueIds.length)
      await supabase.from('clues').update({ is_daily_double: true }).eq('id', round2ClueIds[dd3idx])
    }
  }

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
 * Skip directly to a specific round (for testing).
 * Marks all clues in prior rounds as answered.
 */
export async function skipToRound(gameId: string, targetRound: number) {
  if (targetRound === 2) {
    // Mark all round 1 clues as answered
    const { data: r1Cats } = await supabase
      .from('categories')
      .select('id')
      .eq('game_id', gameId)
      .eq('round_number', 1)

    if (r1Cats) {
      for (const cat of r1Cats) {
        await supabase
          .from('clues')
          .update({ is_answered: true })
          .eq('category_id', cat.id)
      }
    }

    // Get lowest-scoring player for Double Jeopardy
    const { data: pls } = await supabase
      .from('players')
      .select('id')
      .eq('game_id', gameId)
      .order('score', { ascending: true })

    await supabase
      .from('games')
      .update({
        current_round: 2,
        phase: 'board_selection',
        current_clue_id: null,
        current_player_id: pls?.[0]?.id || null,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
  } else if (targetRound === 3) {
    // Mark all round 1 and 2 clues as answered
    const { data: allCats } = await supabase
      .from('categories')
      .select('id')
      .eq('game_id', gameId)

    if (allCats) {
      for (const cat of allCats) {
        await supabase
          .from('clues')
          .update({ is_answered: true })
          .eq('category_id', cat.id)
      }
    }

    await supabase
      .from('games')
      .update({
        current_round: 3,
        phase: 'final_category',
        current_clue_id: null,
        status: 'final_jeopardy',
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
  }
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

  // Get all players and judge their answers
  const { data: players } = await supabase
    .from('players')
    .select('id, score, final_wager, final_answer')
    .eq('game_id', gameId)

  if (players) {
    for (const p of players) {
      const playerAnswer = p.final_answer || ''
      const wager = p.final_wager || 0
      const correct = checkAnswer(playerAnswer, correctAnswer)

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
 * Player passes on a clue ("I don't know").
 * Records the pass in the buzzes table with a special flag.
 * If all players have passed, skips the clue and returns to board.
 */
export async function passOnClue(gameId: string, clueId: string, playerId: string) {
  // Record the pass — use insert first, fall back to update if row exists
  const { error: insertErr } = await supabase
    .from('buzzes')
    .insert({
      game_id: gameId,
      clue_id: clueId,
      player_id: playerId,
      client_timestamp: performance.now(),
      is_pass: true,
    })

  if (insertErr) {
    // Row already exists (player buzzed earlier) — update it to mark as pass
    await supabase
      .from('buzzes')
      .update({ is_pass: true })
      .eq('game_id', gameId)
      .eq('clue_id', clueId)
      .eq('player_id', playerId)
  }

  // Check if all players have passed
  const [{ data: allPlayers }, { data: passes }] = await Promise.all([
    supabase.from('players').select('id').eq('game_id', gameId),
    supabase.from('buzzes').select('player_id').eq('game_id', gameId).eq('clue_id', clueId).eq('is_pass', true),
  ])

  const playerIds = new Set(allPlayers?.map((p) => p.id) || [])
  const passedIds = new Set(passes?.map((b) => b.player_id) || [])
  const allPassed = playerIds.size > 0 && [...playerIds].every((id) => passedIds.has(id))

  if (allPassed) {
    await skipClue(gameId, clueId)
  }
}

/**
 * Skip a clue (no one answered — either timeout or all passed).
 * Marks clue as answered with no answerer, shows result, then moves on.
 */
export async function skipClue(gameId: string, clueId: string) {
  // Mark clue as answered with no one getting it
  await supabase
    .from('clues')
    .update({
      is_answered: true,
      answered_by: null,
    })
    .eq('id', clueId)

  // Go to clue_result phase — keep current_player_id so same player picks next
  await supabase
    .from('games')
    .update({
      phase: 'clue_result',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)
}

/**
 * Submit an answer to a clue.
 * After answering, checks if the round is complete and auto-advances.
 */
export async function submitAnswer(gameId: string, clueId: string, playerId: string, answer: string) {
  // Get the correct answer and the game's current round
  const [{ data: clue }, { data: game }, { data: playerData }] = await Promise.all([
    supabase.from('clues').select('answer, value, is_daily_double').eq('id', clueId).single(),
    supabase.from('games').select('current_round, phase').eq('id', gameId).single(),
    supabase.from('players').select('final_wager').eq('id', playerId).single(),
  ])

  if (!clue) throw new Error('Clue not found')

  const correct = checkAnswer(answer, clue.answer)

  // For Daily Doubles, use the player's wager instead of clue value
  const isDailyDouble = clue.is_daily_double && (game?.phase === 'daily_double_answering')
  const pointValue = isDailyDouble ? (playerData?.final_wager || clue.value) : clue.value
  const scoreChange = correct ? pointValue : -pointValue

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

  // Mark clue as answered — always store who answered and whether correct
  await supabase
    .from('clues')
    .update({
      is_answered: true,
      answered_by: playerId,
      answered_correct: correct,
    })
    .eq('id', clueId)

  // Go to clue_result phase to show the result animation
  // Only change current_player_id to the answerer if they got it right
  // (correct player gets to pick next; wrong answer keeps the previous picker)
  const updateFields: any = {
    phase: 'clue_result',
    updated_at: new Date().toISOString(),
  }
  if (correct) {
    updateFields.current_player_id = playerId
  }
  await supabase
    .from('games')
    .update(updateFields)
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
    .select('current_round, current_player_id')
    .eq('id', gameId)
    .single()

  const currentRound = game?.current_round ?? 1
  const roundComplete = await checkRoundComplete(gameId, currentRound)

  if (!roundComplete) {
    // Ensure there's always a player assigned to pick
    let pickerId = game?.current_player_id
    if (!pickerId) {
      // Fallback: pick the first player
      const { data: pls } = await supabase
        .from('players')
        .select('id')
        .eq('game_id', gameId)
        .order('join_order', { ascending: true })
        .limit(1)
      pickerId = pls?.[0]?.id || null
    }

    // Round continues — go back to board selection
    await supabase
      .from('games')
      .update({
        current_clue_id: null,
        current_player_id: pickerId,
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

/**
 * Player passes after buzzing in ("I Don't Know" during answering phase).
 * No points are deducted. Clue is marked as answered with no answerer.
 */
export async function passAfterBuzz(gameId: string, clueId: string, playerId: string) {
  // Mark clue as answered with no one getting it (no score change)
  await supabase
    .from('clues')
    .update({
      is_answered: true,
      answered_by: null,
    })
    .eq('id', clueId)

  // Go to clue_result phase — keep current_player_id so same player picks next
  await supabase
    .from('games')
    .update({
      phase: 'clue_result',
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)
}

/**
 * Get all distinct seasons. Uses a hardcoded list since J-Archive seasons
 * are known and stable. Much faster than querying 558K rows.
 */
export async function getSeasons(): Promise<string[]> {
  const numeric = Array.from({ length: 42 }, (_, i) => String(i + 1))
  const special = [
    'bbab',
    'cwcpi',
    'goattournament',
    'jm',
    'ncc',
    'pcj',
    'superjeopardy',
    'trebekpilots',
  ]
  return [...numeric, ...special]
}

/**
 * Search J-Archive games with structured filters.
 * For text queries, searches notes and game_title separately then merges
 * (faster than a single OR across 5 ilike columns on 558K rows).
 */
export async function searchGames(filters: GameSearchFilters = {}): Promise<GameSearchResult[]> {
  const { query, season, notesFilter, dateFrom, dateTo, page = 0, limit = 50 } = filters

  function addDateFilters(qb: any) {
    if (season) qb = qb.eq('season', season)
    if (notesFilter) qb = qb.ilike('notes', `%${notesFilter}%`)
    if (dateFrom) qb = qb.gte('air_date', dateFrom)
    if (dateTo) qb = qb.lte('air_date', dateTo)
    return qb
  }

  const cols = 'game_id_source, game_title, air_date, player1, player2, player3, season'
  const fetchLimit = 5000

  let allData: any[] = []

  if (query?.trim()) {
    const trimmed = query.trim()
    const gameIdNum = parseInt(trimmed, 10)

    if (!isNaN(gameIdNum) && String(gameIdNum) === trimmed) {
      // Numeric query — search by game_id_source
      const result = await addDateFilters(
        supabase.from('clue_pool').select(cols)
          .eq('game_id_source', gameIdNum)
      ).order('air_date', { ascending: false }).limit(fetchLimit)

      if (result.error) throw result.error
      allData = result.data || []
    } else {
      // Text search — only search player names (shorter fields, faster)
      // Note: ilike on notes/game_title times out on 558K rows on free Supabase
      const result = await addDateFilters(
        supabase.from('clue_pool').select(cols)
          .or(`player1.ilike.%${trimmed}%,player2.ilike.%${trimmed}%,player3.ilike.%${trimmed}%`)
      ).order('air_date', { ascending: false }).limit(fetchLimit)

      if (result.error) throw result.error
      allData = result.data || []
    }
  } else {
    // No text query — just apply date/season filters
    const result = await addDateFilters(
      supabase.from('clue_pool').select(cols)
    ).order('air_date', { ascending: false }).limit(fetchLimit)

    if (result.error) throw result.error
    allData = result.data || []
  }

  // Group by game_id_source to get distinct games
  const gameMap = new Map<number, GameSearchResult>()
  for (const row of allData) {
    if (!row.game_id_source) continue
    const existing = gameMap.get(row.game_id_source)
    if (existing) {
      existing.clue_count++
    } else {
      gameMap.set(row.game_id_source, {
        game_id_source: row.game_id_source,
        game_title: row.game_title || '',
        air_date: row.air_date,
        player1: row.player1 || '',
        player2: row.player2 || '',
        player3: row.player3 || '',
        season: row.season || '',
        clue_count: 1,
      })
    }
  }

  // Sort by air_date descending and paginate
  const games = Array.from(gameMap.values())
    .sort((a, b) => {
      if (!a.air_date && !b.air_date) return 0
      if (!a.air_date) return 1
      if (!b.air_date) return -1
      return b.air_date.localeCompare(a.air_date)
    })
    .slice(page * limit, (page + 1) * limit)

  return games
}

/**
 * Start a game using clues from a specific J-Archive game (by game_id_source).
 * Preserves the original categories, clue order, and daily doubles.
 */
export async function startGameFromSource(gameId: string, sourceGameId: number) {
  console.log('[startGameFromSource] Starting with sourceGameId:', sourceGameId)
  // Get game settings for game length
  const { data: gameRow } = await supabase
    .from('games')
    .select('settings')
    .eq('id', gameId)
    .single()

  const settings = gameRow?.settings as GameSettings | null
  const lengthConfig = GAME_LENGTH_CONFIG[settings?.gameLength || 'full']
  const ROUND_1_VALUES = lengthConfig.values1
  const ROUND_2_VALUES = lengthConfig.values2

  // Fetch all clues from this source game
  const { data: sourceClues, error: fetchErr } = await supabase
    .from('clue_pool')
    .select('*')
    .eq('game_id_source', sourceGameId)

  if (fetchErr) throw fetchErr
  if (!sourceClues || sourceClues.length === 0) throw new Error('No clues found for this game')

  // Group clues by round and category
  const rounds: Record<string, Record<string, typeof sourceClues>> = {}
  for (const clue of sourceClues) {
    if (!rounds[clue.round]) rounds[clue.round] = {}
    if (!rounds[clue.round][clue.category]) rounds[clue.round][clue.category] = []
    rounds[clue.round][clue.category].push(clue)
  }

  // --- Round 1 ---
  const r1Cats = Object.keys(rounds['Jeopardy Round'] || {})
  const round1ClueIds: string[] = []
  const round1DailyDoubles: Set<string> = new Set()

  for (let pos = 0; pos < r1Cats.length && pos < lengthConfig.categories; pos++) {
    const catName = r1Cats[pos]
    const catClues = rounds['Jeopardy Round'][catName]

    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .insert({ game_id: gameId, name: catName, round_number: 1, position: pos })
      .select('id')
      .single()
    if (catErr || !cat) throw catErr || new Error('Failed to create category')

    catClues.sort((a: any, b: any) => (a.value || 0) - (b.value || 0))
    const cluesForCat = catClues.slice(0, lengthConfig.cluesPerCat)

    for (let i = 0; i < cluesForCat.length; i++) {
      const srcClue = cluesForCat[i]
      const isDd = srcClue.is_daily_double === true
      const { data: clue, error: clueErr } = await supabase
        .from('clues')
        .insert({
          category_id: cat.id,
          value: ROUND_1_VALUES[i] || (i + 1) * 200,
          question: srcClue.question,
          answer: srcClue.answer,
          is_daily_double: isDd,
        })
        .select('id')
        .single()
      if (clueErr || !clue) throw clueErr || new Error('Failed to create clue')
      round1ClueIds.push(clue.id)
      if (isDd) round1DailyDoubles.add(clue.id)
    }
  }

  // If no daily doubles were preserved from source, add 1 random one
  if (round1DailyDoubles.size === 0 && round1ClueIds.length > 0) {
    const dd1 = round1ClueIds[Math.floor(Math.random() * round1ClueIds.length)]
    await supabase.from('clues').update({ is_daily_double: true }).eq('id', dd1)
  }

  // --- Round 2 ---
  const r2Cats = Object.keys(rounds['Double Jeopardy'] || {})
  const round2ClueIds: string[] = []
  const round2DailyDoubles: Set<string> = new Set()

  for (let pos = 0; pos < r2Cats.length && pos < lengthConfig.categories; pos++) {
    const catName = r2Cats[pos]
    const catClues = rounds['Double Jeopardy'][catName]

    const { data: cat, error: catErr } = await supabase
      .from('categories')
      .insert({ game_id: gameId, name: catName, round_number: 2, position: pos })
      .select('id')
      .single()
    if (catErr || !cat) throw catErr || new Error('Failed to create category')

    catClues.sort((a: any, b: any) => (a.value || 0) - (b.value || 0))
    const cluesForCat = catClues.slice(0, lengthConfig.cluesPerCat)

    for (let i = 0; i < cluesForCat.length; i++) {
      const srcClue = cluesForCat[i]
      const isDd = srcClue.is_daily_double === true
      const { data: clue, error: clueErr } = await supabase
        .from('clues')
        .insert({
          category_id: cat.id,
          value: ROUND_2_VALUES[i] || (i + 1) * 400,
          question: srcClue.question,
          answer: srcClue.answer,
          is_daily_double: isDd,
        })
        .select('id')
        .single()
      if (clueErr || !clue) throw clueErr || new Error('Failed to create clue')
      round2ClueIds.push(clue.id)
      if (isDd) round2DailyDoubles.add(clue.id)
    }
  }

  // If no daily doubles were preserved, add random ones based on game length
  if (round2DailyDoubles.size === 0 && round2ClueIds.length > 0) {
    const dd2idx = Math.floor(Math.random() * round2ClueIds.length)
    await supabase.from('clues').update({ is_daily_double: true }).eq('id', round2ClueIds[dd2idx])

    if (lengthConfig.dd2 >= 2 && round2ClueIds.length > 1) {
      let dd3idx = Math.floor(Math.random() * round2ClueIds.length)
      while (dd3idx === dd2idx) dd3idx = Math.floor(Math.random() * round2ClueIds.length)
      await supabase.from('clues').update({ is_daily_double: true }).eq('id', round2ClueIds[dd3idx])
    }
  }

  // --- Final Jeopardy ---
  let finalCategoryName = 'Final Jeopardy'
  let finalClueText = 'No Final Jeopardy clue available.'
  let finalAnswerText = ''

  const fjClues = rounds['Final Jeopardy']
  if (fjClues) {
    const fjCats = Object.keys(fjClues)
    if (fjCats.length > 0) {
      const fjCat = fjCats[0]
      const fjClue = fjClues[fjCat][0]
      if (fjClue) {
        finalCategoryName = fjCat
        finalClueText = fjClue.question
        finalAnswerText = fjClue.answer
      }
    }
  }

  // --- Pick random first player ---
  const { data: gamePlayers } = await supabase
    .from('players')
    .select('id')
    .eq('game_id', gameId)

  if (!gamePlayers || gamePlayers.length === 0) throw new Error('No players in game')
  const firstPlayer = gamePlayers[Math.floor(Math.random() * gamePlayers.length)]

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
