import { supabase } from './supabase'
import type { Game, Player, Category, Clue, GameSettings, GameSearchResult, GameSearchFilters, CustomBoard } from '@/types/game'
import { GAME_LENGTH_CONFIG, DEFAULT_CASUAL_SETTINGS } from '@/types/game'

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

export async function createGame(settings: GameSettings, isPublic: boolean = false) {
  const roomCode = generateRoomCode()

  const { data: game, error: gameError } = await supabase
    .from('games')
    .insert({
      room_code: roomCode,
      status: 'lobby',
      current_round: 1,
      phase: 'lobby',
      settings,
      is_public: isPublic,
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
  const isFirstPlayer = (count ?? 0) === 0

  const { data: player, error: playerError } = await supabase
    .from('players')
    .insert({
      game_id: game.id,
      name: playerName,
      join_order: (count ?? 0) + 1,
      is_ready: isActive, // auto-ready if game already started
      is_creator: isFirstPlayer, // first player to join is the creator
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
  // Get game settings to determine game length and game type
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

  // Determine which game IDs to pull from based on gameType
  const gameType = (settings as any)?.gameType as string | undefined
  const GAME_TYPE_TO_IDS: Record<string, string> = {
    kids: 'Kids Week',
    teen: 'Teen Tournament',
    toc: 'Tournament of Champions',
  }
  const tournamentKey = gameType ? GAME_TYPE_TO_IDS[gameType] : undefined
  const allowedGameIds = tournamentKey ? TOURNAMENT_GAME_IDS[tournamentKey] : undefined

  // Category theme uses the pre-computed category_type column (indexed)
  const categoryTheme = (settings as any)?.categoryTheme as string | undefined

  // Helper: pick N random categories that have enough clues
  async function pickCategories(roundName: string, count: number) {
    let query = supabase.from('clue_pool').select('category').eq('round', roundName)

    // Filter by game IDs (tournament type) or category_type (theme)
    if (allowedGameIds) {
      // Batch game IDs to avoid URL length limits
      let allCats: Array<{ category: string }> = []
      for (let i = 0; i < allowedGameIds.length; i += 100) {
        const batch = allowedGameIds.slice(i, i + 100)
        const { data } = await supabase.from('clue_pool').select('category')
          .eq('round', roundName).in('game_id_source', batch)
        if (data) allCats.push(...data)
      }
      const counts: Record<string, number> = {}
      for (const row of allCats) counts[row.category] = (counts[row.category] || 0) + 1
      const eligible = Object.keys(counts).filter(c => counts[c] >= CLUES_PER_CAT)
      if (eligible.length < count) throw new Error(`Not enough categories for ${roundName} (need ${count}, found ${eligible.length})`)
      for (let i = eligible.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [eligible[i], eligible[j]] = [eligible[j], eligible[i]] }
      return eligible.slice(0, count)
    }

    // Use indexed category_type column for theme filtering
    if (categoryTheme) {
      query = query.eq('category_type', categoryTheme)
    }

    const { data: allCats } = await query.limit(10000)

    if (!allCats || allCats.length === 0) throw new Error(`No clues found for round: ${roundName}`)

    // Count clues per category
    const counts: Record<string, number> = {}
    for (const row of allCats) {
      counts[row.category] = (counts[row.category] || 0) + 1
    }

    const eligible = Object.keys(counts).filter(c => counts[c] >= CLUES_PER_CAT)
    if (eligible.length < count) throw new Error(`Not enough categories for ${roundName} (need ${count}, found ${eligible.length})`)

    // Fisher-Yates shuffle
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]]
    }

    return eligible.slice(0, count)
  }

  // Helper: pick random clues from a category (returns null if not enough)
  async function pickClues(categoryName: string, roundName: string) {
    let clueQuery = supabase
      .from('clue_pool')
      .select('question, answer')
      .eq('category', categoryName)
      .eq('round', roundName)

    if (allowedGameIds) {
      clueQuery = clueQuery.in('game_id_source', allowedGameIds.slice(0, 100))
    }

    const { data: pool } = await clueQuery.limit(50)

    if (!pool || pool.length < CLUES_PER_CAT) return null // not enough clues, skip this category

    // Shuffle and take CLUES_PER_CAT
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]]
    }

    return pool.slice(0, CLUES_PER_CAT)
  }

  // Helper: pick categories and build clues, skipping any that don't have enough clues
  async function buildRound(roundName: string, roundNumber: number, values: number[]) {
    const candidates = await pickCategories(roundName, NUM_CATEGORIES * 3) // get extra candidates
    const clueIds: string[] = []
    let pos = 0

    for (const catName of candidates) {
      if (pos >= NUM_CATEGORIES) break

      const clueData = await pickClues(catName, roundName)
      if (!clueData) continue // skip categories without enough clues

      const { data: cat, error: catErr } = await supabase
        .from('categories')
        .insert({ game_id: gameId, name: catName, round_number: roundNumber, position: pos })
        .select('id')
        .single()
      if (catErr || !cat) continue

      for (let i = 0; i < CLUES_PER_CAT; i++) {
        const { data: clue } = await supabase
          .from('clues')
          .insert({
            category_id: cat.id,
            value: values[i],
            question: clueData[i].question,
            answer: clueData[i].answer,
            is_daily_double: false,
          })
          .select('id')
          .single()
        if (clue) clueIds.push(clue.id)
      }
      pos++
    }

    if (pos < NUM_CATEGORIES) throw new Error(`Not enough valid categories for ${roundName} (found ${pos}, need ${NUM_CATEGORIES})`)
    return clueIds
  }

  // --- Round 1 ---
  const round1ClueIds = await buildRound('Jeopardy Round', 1, ROUND_1_VALUES)

  // --- Round 2 ---
  const round2ClueIds = await buildRound('Double Jeopardy', 2, ROUND_2_VALUES)

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

  let fjQuery = supabase
    .from('clue_pool')
    .select('category, question, answer')
    .eq('round', 'Final Jeopardy')

  if (categoryTheme) {
    fjQuery = fjQuery.eq('category_type', categoryTheme)
  }
  if (allowedGameIds) {
    fjQuery = fjQuery.in('game_id_source', allowedGameIds.slice(0, 100))
  }

  const { data: fjCats } = await fjQuery.limit(50)

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
 * Sends a high-resolution client timestamp so the server can break ties
 * when two players buzz at nearly the same instant.
 */
export async function submitBuzz(gameId: string, clueId: string, playerId: string) {
  // Capture client time as early as possible (milliseconds since page load — monotonic, high-res)
  const clientTimestamp = performance.now()

  // Use atomic DB function to prevent race conditions in multiplayer
  const { data, error } = await supabase.rpc('resolve_buzz', {
    p_game_id: gameId,
    p_clue_id: clueId,
    p_player_id: playerId,
    p_client_timestamp: clientTimestamp,
  })

  if (error) throw error
  // data is true if this player won the buzz, false if someone else beat them
  return data as boolean
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

  // Check if all players have passed (with retry to handle concurrent pass race condition)
  const checkAllPassed = async (): Promise<boolean> => {
    const [{ data: allPlayers }, { data: passes }] = await Promise.all([
      supabase.from('players').select('id').eq('game_id', gameId),
      supabase.from('buzzes').select('player_id').eq('game_id', gameId).eq('clue_id', clueId).eq('is_pass', true),
    ])

    const playerIds = new Set(allPlayers?.map((p) => p.id) || [])
    const passedIds = new Set(passes?.map((b) => b.player_id) || [])
    return playerIds.size > 0 && [...playerIds].every((id) => passedIds.has(id))
  }

  let allPassed = await checkAllPassed()
  // Retry once after a short delay to handle near-simultaneous passes
  if (!allPassed) {
    await new Promise((r) => setTimeout(r, 500))
    allPassed = await checkAllPassed()
  }

  if (allPassed) {
    // All passed — skip clue and go straight to board selection (no result screen)
    await supabase.from('clues').update({ is_answered: true, answered_by: null }).eq('id', clueId)

    // Check if round is complete
    const { data: gameRow } = await supabase.from('games').select('current_round').eq('id', gameId).single()
    const roundComplete = await checkRoundComplete(gameId, gameRow?.current_round || 1)

    if (!roundComplete) {
      // Round continues — go back to board selection
      await supabase.from('games').update({
        current_clue_id: null,
        phase: 'board_selection',
        updated_at: new Date().toISOString(),
      }).eq('id', gameId)
    }
  }
}

/**
 * Skip a clue (no one answered — either timeout or all passed).
 * Marks clue as answered with no answerer, shows result, then moves on.
 */
export async function skipClue(gameId: string, clueId: string) {
  // Guard: only skip if we're still in buzz_window (avoid overwriting a phase
  // transition that already happened, e.g. passOnClue → board_selection or final_category)
  const { data: gameRow } = await supabase
    .from('games')
    .select('phase')
    .eq('id', gameId)
    .single()

  if (gameRow?.phase !== 'buzz_window') return

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

  // Save the player's typed answer to their buzz record for display on result screen
  await supabase
    .from('buzzes')
    .update({ answer, is_correct: correct })
    .eq('game_id', gameId)
    .eq('clue_id', clueId)
    .eq('player_id', playerId)

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
    .select('current_round, current_player_id, phase')
    .eq('id', gameId)
    .single()

  // Guard: if we're already past clue_result (e.g. race with passOnClue setting
  // final_category or board_selection), don't overwrite
  if (game?.phase !== 'clue_result') return

  const currentRound = game?.current_round ?? 1

  // If current_round is already 3, we're heading to Final Jeopardy — don't
  // fall through to board_selection (checkRoundComplete won't find round 3 categories)
  if (currentRound >= 3) {
    await supabase.from('games').update({
      status: 'final_jeopardy',
      phase: 'final_category',
      current_clue_id: null,
      updated_at: new Date().toISOString(),
    }).eq('id', gameId)
    return
  }

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

// Pre-computed tournament game IDs (from notes field in j-archive data)
// Using hardcoded IDs avoids ilike queries on 558K rows which timeout on free Supabase
const TOURNAMENT_GAME_IDS: Record<string, number[]> = {
  'Kids Week': [31,32,33,34,35,816,819,1120,1121,1122,1123,1124,1341,2105,2107,2109,2122,2123,2588,2590,2594,2679,2680,2681,2685,2686,3064,3066,3095,3096,3098,3100,3102,3105,3107,3111,3112,3113,3191,3192,3428,3430,3431,3432,3433,3690,3691,3692,3693,3694,3964,3965,3966,3967,3969,4278,4280,4285,4287,4294,4738,4739,4740,4741,4742],
  'Teen Tournament': [120,122,123,127,129,130,132,133,135,139,141,315,316,320,481,482,483,484,485,657,659,660,663,664,667,668,670,672,673,765,767,769,772,774,778,779,782,784,787,1151,1152,1259,1260,1261,1264,1265,1267,1268,1269,1270,1271,1306,1412,1413,1414,1415,1416,1417,1418,1419,1420,1421,1529,1530,1531,1532,1533,1534,1535,1536,1537,1538,1690,1698,1699,1700,1701,1715,1716,1717,1754,1755,1756,1971,1972,1973,1981,1983,1984,1986,1987,1988,1989,2325,2326,2327,2329,2330,2343,2344,2345,2346,2347,2456,2457,2458,2459,2460,2461,2462,2463,2464,2472,2473,2474,2475,2476,2477,2478,2479,2480,2481,2771,2772,2773,2774,2788,2789,2790,2791,2792,2793,2918,2919,2920,2921,2922,2923,2924,2925,2926,2927,3198,3200,3201,3203,3204,3206,3209,3210,3212,3213,3578,3579,3580,3581,3582,3583,3584,3586,3587,3588,3885,3886,3887,3888,3889,3890,3891,3892,3893,3894,3970,4068,4069,4070,4071,4072,4073,4074,4075,4076,4077,4182,4183,4188,4189,4486,4487,4512,4513,4515,4518,4520,4522,4524,4525,4573,4574,4576,4578,4579,4582,4584,4586,4588,4589,4591,4743,4751,4757,4758,4759,4760,4763,4764,4765,4766,4767,4791,4793,4796,4799,4802,4804,4808,4973,5153,5163,5323,5324,5454,5455,5456,5457,5458,5459,5460,5461,5462,5463,5819,6142,6143,6144,6145,6146,6147,6148,6149,6150,6151,6294,6296,6299,6301,6305,6306,6308,6310,6312,6319,6325,6326,6327,6328,6330,6332,6333,6335,6338,6339,6342,6344,6367,6373,6377,6383,6385,6390,6392,6397,6400,6656,6658,6660,6673,6674,6675,6676,6688,6689,6710,6711,6712,6713,6714,6715,6721,6724,6725,6726,6727,6728,6729,6730,6731,6732,6754,6755,6756,6757,6759,6760,6761,6768,6769,6988,7589,7593,8187],
  'College': [48,49,50,51,52,53,54,55,56,57,263,317,318,598,599,601,603,605,608,610,613,615,616,788,827,1028,1029,1030,1031,1032,1033,1034,1035,1036,1037,1461,1462,1470,1471,1472,1473,1474,1475,1476,1477,1679,1680,1682,1683,1684,1685,1686,1687,1688,1689,1828,1829,1832,1835,1838,1842,1844,1846,1850,1851,2129,2131,2132,2133,2135,2136,2137,2138,2139,2140,2290,2291,2292,2293,2294,2295,2296,2297,2298,2378,2380,2381,2383,2384,2385,2386,2387,2388,2389,2453,2454,2455,2465,2466,2467,2468,2469,2470,2471,2527,2528,2529,2530,2531,2532,2533,2534,2535,2536,2941,2942,2943,2944,2945,2946,2947,2948,2949,2950,2999,3000,3001,3002,3003,3004,3005,3006,3007,3008,3094,3124,3125,3300,3301,3303,3305,3306,3307,3309,3311,3312,3314,3498,3499,3500,3502,3503,3504,3505,3506,3507,3508,3819,3820,3821,3822,3823,3824,3825,3826,3827,3828,4115,4117,4172,4173,4176,4177,4178,4180,4181,4184,4185,4186,4410,4418,4422,4423,4424,4425,4426,4428,4429,4430,4431,4432,4498,4632,4782,4964,4965,4966,4967,4968,4969,4970,5180,5181,5183,5184,5185,5187,5188,5189,5192,5193,5399,5416,5522,5523,5524,5526,5527,5529,5530,5531,5532,5533,5760,5761,5952,5953,5954,5955,5956,5957,5958,5960,5961,5962,6095,6315,6317,6334,6336,6348,6353,6355,6363,6365,6370,6375,6380,6387,6393,6395,6398,6405,6406,6596,6597,6598,6599,6600,6601,6602,6603,6604,6605,6661,6662,6663,6665,6668,6669,6671,6677,6679,6681,6683,6685,6687,6690,6692,6693,6696,6698,6705,6706,6707,6708,6709,6716,6717,6722,6723,6733,6734,6735,6736,6738,6739,6740,6741,6742,6743,7264,7266,7269,7270,7272,7273,7276,7277,7280,7281,7283,7284,7286,7287,7289,7290,7293,7294],
  'Tournament of Champions': [11,12,13,14,15,16,17,18,19,20,81,83,84,85,92,93,101,105,112,115,119,121,124,125,126,134,142,144,146,149,151,153,155,158,159,160,161,162,163,164,166,167,168,169,170,171,172,175,176,178,181,182,183,185,189,190,193,195,197,198,200,202,207,208,219,221,225,227,233,235,237,238,242,243,245,248,250,255,258,259,260,262,266,267,268,271,272,273,279,280,281,282,283,284,285,286,287,288,289,290,291,292,293,296,298,299,300,301,302,303,304,305,306,308,309,310,311,312,313,314,319,321,322,323,324,325,326,327,328,329,330,332,333,335,343,371,372,376,383,384,386,389,392,395,412,413,415,417,419,420,499,500,626,629,685,695,709,712,715,724,728,731,736,737,742,900,902,954,956,958,959,962,965,966,968,969,971,1007,1008,1009,1010,1020,1021,1109,1112,1113,1115,1117,1119,1126,1127,1128,1129,1186,1187,1189,1190,1293,1295,1297,1298,1300,1302,1303,1304,1305,1352,1353,1354,1355,1356,1357,1358,1359,1360,1361,1408,1410,1411,1422,1423,1426,1427,1428,1429,1430,1439,1440,1990,1993,1996,1997,1998,1999,2159,2160,2162,2163,2170,2171,2172,2173,2174,2175,2482,2554,2555,2556,2557,2558,2562,2563,2564,2567,2568,2569,2570,2613,2955,2957,2958,2959,2960,2961,2962,2963,2965,2966,3051,3053,3060,3061,3062,3065,3067,3069,3135,3387,3388,3389,3390,3391,3392,3393,3394,3395,3396,3665,3666,3670,3671,3674,3676,3679,3680,3681,3683,3751,3752,3753,3754,3755,3756,3757,3758,3759,3760,4078,4079,4081,4082,4084,4086,4087,4088,4090,4092,4305,4720,4721,4722,4724,4725,4726,4728,4729,4730,4731,5092,5093,5095,5097,5098,5099,5100,5101,5103,5104,5825,5826,5827,5828,5829,5831,5832,5833,5834,5835,6459,6460,6461,6462,6463,6464,6465,6466,6467,6468,7024,7025,7026,7027,7028,7029,7030,7031,7032,7033,7491,7492,7494,7495,7497,7499,7501,7503,7505,7507,7511,7512,7513,7515,7516,7518,8830,8831,8832,8833,8834,8835,8836,8837,8838,8839,8840,8841,8842,8843,8844,8845,8846,8848,9105,9106,9107,9108,9110,9111,9112,9113,9114,9115,9117,9118,9119,9120,9121,9360,9361,9362,9363,9364,9365,9366,9367,9368,9369,9370,9371,9372],
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
    if (dateFrom) qb = qb.gte('air_date', dateFrom)
    if (dateTo) qb = qb.lte('air_date', dateTo)
    return qb
  }

  const cols = 'game_id_source, game_title, air_date, player1, player2, player3, season'
  const fetchLimit = 5000

  let allData: any[] = []

  if (notesFilter && TOURNAMENT_GAME_IDS[notesFilter]) {
    // Tournament filter — use pre-computed game IDs (fast, avoids ilike timeout)
    const gameIds = TOURNAMENT_GAME_IDS[notesFilter]
    // Query in batches of 200 to avoid URL length limits
    for (let i = 0; i < gameIds.length; i += 200) {
      const batch = gameIds.slice(i, i + 200)
      const result = await addDateFilters(
        supabase.from('clue_pool').select(cols)
          .in('game_id_source', batch)
      ).order('air_date', { ascending: false }).limit(fetchLimit)

      if (result.error) throw result.error
      allData.push(...(result.data || []))
    }
  } else if (query?.trim()) {
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

/**
 * Start a game with a custom board (user-created categories/clues).
 */
export async function startCustomGame(gameId: string, board: CustomBoard) {
  for (let roundIdx = 0; roundIdx < board.rounds.length; roundIdx++) {
    const round = board.rounds[roundIdx]
    const roundNumber = roundIdx + 1

    for (let catIdx = 0; catIdx < round.categories.length; catIdx++) {
      const cat = round.categories[catIdx]
      const { data: catRow, error: catErr } = await supabase
        .from('categories')
        .insert({ game_id: gameId, name: cat.name, round_number: roundNumber, position: catIdx })
        .select('id')
        .single()
      if (catErr || !catRow) throw catErr || new Error('Failed to create category')

      for (const clue of cat.clues) {
        await supabase.from('clues').insert({
          category_id: catRow.id,
          value: clue.value,
          question: clue.question,
          answer: clue.answer,
          is_daily_double: clue.isDailyDouble || false,
        })
      }
    }
  }

  // Pick random first player
  const { data: players } = await supabase
    .from('players')
    .select('id')
    .eq('game_id', gameId)
  if (!players || players.length === 0) throw new Error('No players in game')
  const firstPlayer = players[Math.floor(Math.random() * players.length)]

  // Activate game
  await supabase.from('games').update({
    status: 'active',
    phase: 'board_selection',
    current_round: 1,
    current_player_id: firstPlayer.id,
    final_category_name: board.finalJeopardy?.categoryName || null,
    final_clue_text: board.finalJeopardy?.question || null,
    final_answer: board.finalJeopardy?.answer || null,
    updated_at: new Date().toISOString(),
  }).eq('id', gameId)
}

/**
 * Save a custom board to the custom_boards table.
 */
export async function saveCustomBoard(title: string, boardData: CustomBoard, isPublic: boolean = true) {
  const { data, error } = await supabase
    .from('custom_boards')
    .insert({ title, board_data: boardData, is_public: isPublic })
    .select('id, title')
    .single()
  if (error) throw error
  return data
}

/**
 * List public custom boards for browsing.
 */
export async function listCustomBoards(search?: string) {
  let query = supabase
    .from('custom_boards')
    .select('id, title, is_public, created_at')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(50)

  if (search) {
    query = query.ilike('title', `%${search}%`)
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

/**
 * Update an existing custom board.
 */
export async function updateCustomBoard(boardId: string, title: string, boardData: CustomBoard, isPublic: boolean = true) {
  const { data, error } = await supabase
    .from('custom_boards')
    .update({ title, board_data: boardData, is_public: isPublic })
    .eq('id', boardId)
    .select('id, title')
    .single()
  if (error) throw error
  return data
}

/**
 * Delete a custom board by ID.
 */
export async function deleteCustomBoard(boardId: string) {
  const { error } = await supabase
    .from('custom_boards')
    .delete()
    .eq('id', boardId)
  if (error) throw error
}

/**
 * Load a custom board by ID.
 */
export async function loadCustomBoard(boardId: string) {
  const { data, error } = await supabase
    .from('custom_boards')
    .select('*')
    .eq('id', boardId)
    .single()
  if (error) throw error
  return data as { id: string; title: string; board_data: CustomBoard; is_public: boolean; created_at: string }
}

/**
 * Start the voting phase: pick 3 random games from clue_pool for players to vote on.
 */
export async function startVoting(gameId: string) {
  const { data: randomGames } = await supabase
    .from('clue_pool')
    .select('game_id_source, game_title, air_date, season')
    .not('game_id_source', 'is', null)
    .limit(3000)

  if (!randomGames || randomGames.length === 0) throw new Error('No games in clue pool')

  const gameMap = new Map<number, { sourceGameId: number; title: string; airDate: string | null; season: string }>()
  for (const row of randomGames) {
    if (!gameMap.has(row.game_id_source)) {
      gameMap.set(row.game_id_source, {
        sourceGameId: row.game_id_source,
        title: row.game_title || `Game #${row.game_id_source}`,
        airDate: row.air_date,
        season: row.season || '',
      })
    }
  }

  const allGames = Array.from(gameMap.values())
  for (let i = allGames.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allGames[i], allGames[j]] = [allGames[j], allGames[i]]
  }
  const options = allGames.slice(0, 3)
  const deadline = new Date(Date.now() + 30000).toISOString()

  await supabase.from('games').update({
    phase: 'game_voting',
    vote_options: options,
    vote_deadline: deadline,
    updated_at: new Date().toISOString(),
  }).eq('id', gameId)
}

/** Submit a player's vote for a game option. */
export async function submitVote(playerId: string, sourceGameId: number) {
  await supabase.from('players').update({ vote_choice: sourceGameId }).eq('id', playerId)
}

/** Resolve the vote: tally votes, pick the winner, start the game. */
export async function resolveVote(gameId: string) {
  const [{ data: players }, { data: gameRow }] = await Promise.all([
    supabase.from('players').select('id, vote_choice').eq('game_id', gameId),
    supabase.from('games').select('vote_options').eq('id', gameId).single(),
  ])

  if (!players || !gameRow?.vote_options) throw new Error('Missing vote data')
  const options = gameRow.vote_options as Array<{ sourceGameId: number }>

  const counts = new Map<number, number>()
  for (const opt of options) counts.set(opt.sourceGameId, 0)
  counts.set(-1, 0)

  for (const p of players) {
    if (p.vote_choice != null && counts.has(p.vote_choice)) {
      counts.set(p.vote_choice, (counts.get(p.vote_choice) || 0) + 1)
    }
  }

  let maxVotes = -1
  let winners: number[] = []
  for (const [id, count] of counts) {
    if (count > maxVotes) { maxVotes = count; winners = [id] }
    else if (count === maxVotes) winners.push(id)
  }

  const winnerId = winners[Math.floor(Math.random() * winners.length)]
  if (winnerId === -1) await startGame(gameId)
  else await startGameFromSource(gameId, winnerId)
}

/** List public multiplayer games in lobby state. */
export async function listPublicGames() {
  const { data: games, error } = await supabase
    .from('games')
    .select('id, room_code, settings, created_at')
    .eq('is_public', true)
    .eq('status', 'lobby')
    .eq('phase', 'lobby')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) throw error
  if (!games || games.length === 0) return []

  const gameIds = games.map(g => g.id)
  const { data: players } = await supabase
    .from('players')
    .select('game_id, name, is_creator')
    .in('game_id', gameIds)

  const playerMap = new Map<string, { count: number; creator: string }>()
  for (const p of players || []) {
    const entry = playerMap.get(p.game_id) || { count: 0, creator: '' }
    entry.count++
    if (p.is_creator) entry.creator = p.name
    playerMap.set(p.game_id, entry)
  }

  return games.map(g => ({
    id: g.id,
    room_code: g.room_code,
    gameLength: (g.settings as any)?.gameLength || 'full',
    playerCount: playerMap.get(g.id)?.count || 0,
    creatorName: playerMap.get(g.id)?.creator || 'Unknown',
    created_at: g.created_at,
  }))
}

/** Create a rematch: new game with same settings and players. */
export async function rematchGame(gameId: string) {
  const [{ data: oldGame }, { data: oldPlayers }] = await Promise.all([
    supabase.from('games').select('settings, is_public').eq('id', gameId).single(),
    supabase.from('players').select('name, is_creator, join_order').eq('game_id', gameId).order('join_order'),
  ])

  if (!oldGame || !oldPlayers) throw new Error('Game not found')

  const settings = oldGame.settings as GameSettings
  const { game: newGame } = await createGame(settings, oldGame.is_public)

  for (const p of oldPlayers) {
    await supabase.from('players').insert({
      game_id: newGame.id,
      name: p.name,
      join_order: p.join_order,
      is_creator: p.is_creator,
      is_ready: false,
    })
  }

  await supabase.from('games').update({ rematch_room_code: newGame.room_code }).eq('id', gameId)
  return newGame
}

/**
 * Create a game in presentation mode from a CustomBoard.
 * Adds a dummy "Presenter" player so startCustomGame can activate the game.
 * Returns the room code for the /present route.
 */
export async function createPresentationGame(board: CustomBoard) {
  const settings: GameSettings = {
    ...DEFAULT_CASUAL_SETTINGS,
    gameMode: 'party',
  }

  const { game } = await createGame(settings, false)

  // Add a dummy presenter player so startCustomGame doesn't fail
  await supabase.from('players').insert({
    game_id: game.id,
    name: 'Presenter',
    score: 0,
    is_connected: true,
    is_ready: true,
    join_order: 1,
    is_creator: true,
  })

  await startCustomGame(game.id, board)

  return game.room_code
}
