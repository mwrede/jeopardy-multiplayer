import { supabase } from './supabase'
import type { Game, Player, Category, Clue, GameSettings, GameSearchResult, GameSearchFilters, CustomBoard } from '@/types/game'
import { GAME_LENGTH_CONFIG, DEFAULT_CASUAL_SETTINGS } from '@/types/game'
import {
  buildTopicRound,
  pickTopicFinal,
  MAX_TOPICS,
  type BoardTopic,
} from './topic-board'
import { checkAnswer, checkAnswerDetailed } from './answer-check'

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

export async function joinGame(roomCode: string, playerName: string, userId?: string) {
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
    // Reconnect: update connection status, then best-effort claim ownership.
    await supabase
      .from('players')
      .update({ is_connected: true })
      .eq('id', existing.id)
    if (userId && !existing.user_id) {
      await tryClaimPlayerOwnership(existing.id, userId)
    }

    return { game: game as Game, player: existing as Player }
  }

  // New player joining
  const { count } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true })
    .eq('game_id', game.id)

  // Party mode allows up to 15 buzzers; multiplayer (everyone on their own
  // device) still caps at 8 so the UI scoreboards stay readable.
  const isMultiplayerMode = (game.settings as any)?.gameMode === 'multiplayer'
  const maxPlayers = isMultiplayerMode ? 8 : 15
  if ((count ?? 0) >= maxPlayers) {
    throw new Error(`Game is full (max ${maxPlayers} players)`)
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
      // Party mode has no ready-up step (auto-ready). Multiplayer keeps the
      // ready toggle — everyone confirms they're on their own device first.
      is_ready: isActive || !isMultiplayerMode,
      is_creator: isFirstPlayer, // first player to join is the creator
    })
    .select()
    .single()

  if (playerError) throw playerError

  // Best-effort: tag ownership if signed in. Done as a separate update so the
  // join still succeeds when the user-identity migration hasn't been applied.
  if (userId && player?.id) {
    await tryClaimPlayerOwnership(player.id, userId)
  }

  return { game: game as Game, player: player as Player }
}

/**
 * Stamp a player row with user_id. Silently skips if the column doesn't exist
 * yet (user-identity migration not applied) so guests/anonymous still works.
 */
async function tryClaimPlayerOwnership(playerId: string, userId: string) {
  const { error } = await supabase
    .from('players')
    .update({ user_id: userId })
    .eq('id', playerId)
  if (error) console.warn('[joinGame] skipped user_id claim:', error.message)
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
/**
 * Atomically flip a game out of the 'lobby' status so only one caller
 * proceeds to seed categories/clues. Prevents duplicate-row races when
 * multiple clients hit Start simultaneously.
 */
async function claimGameSeed(gameId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('games')
    .update({ status: 'starting', updated_at: new Date().toISOString() })
    .eq('id', gameId)
    .eq('status', 'lobby')
    .select('id')
  if (error) {
    console.warn('[claimGameSeed] error:', error.message)
    return false
  }
  return (data?.length ?? 0) > 0
}

/**
 * Build a game board from user-chosen topics (curated themes and/or free-text
 * headers). Mirrors the tail end of startGame: rounds → Daily Doubles →
 * Final Jeopardy → activate.
 */
async function buildTopicBoard(
  gameId: string,
  topics: BoardTopic[],
  lengthConfig: (typeof GAME_LENGTH_CONFIG)[keyof typeof GAME_LENGTH_CONFIG],
) {
  const trimmed = topics.slice(0, MAX_TOPICS)

  const round1ClueIds = await buildTopicRound({
    gameId, topics: trimmed,
    roundName: 'Jeopardy Round', roundNumber: 1, roundIndex: 0,
    values: lengthConfig.values1,
    numCategories: lengthConfig.categories,
    cluesPerCat: lengthConfig.cluesPerCat,
  })

  const round2ClueIds = await buildTopicRound({
    gameId, topics: trimmed,
    roundName: 'Double Jeopardy', roundNumber: 2, roundIndex: 1,
    values: lengthConfig.values2,
    numCategories: lengthConfig.categories,
    cluesPerCat: lengthConfig.cluesPerCat,
  })

  // Daily Doubles
  if (round1ClueIds.length > 0) {
    const dd1 = round1ClueIds[Math.floor(Math.random() * round1ClueIds.length)]
    await supabase.from('clues').update({ is_daily_double: true }).eq('id', dd1)
  }
  if (round2ClueIds.length > 0) {
    const dd2idx = Math.floor(Math.random() * round2ClueIds.length)
    await supabase.from('clues').update({ is_daily_double: true }).eq('id', round2ClueIds[dd2idx])
    if (lengthConfig.dd2 >= 2 && round2ClueIds.length > 1) {
      let dd3idx = Math.floor(Math.random() * round2ClueIds.length)
      while (dd3idx === dd2idx) dd3idx = Math.floor(Math.random() * round2ClueIds.length)
      await supabase.from('clues').update({ is_daily_double: true }).eq('id', round2ClueIds[dd3idx])
    }
  }

  // Final Jeopardy — prefer a clue matching one of the topics
  let finalCategoryName = 'Final Jeopardy'
  let finalClueText = 'No Final Jeopardy clue available.'
  let finalAnswerText = ''
  const topicFinal = await pickTopicFinal(trimmed)
  if (topicFinal) {
    finalCategoryName = topicFinal.category
    finalClueText = topicFinal.question
    finalAnswerText = topicFinal.answer
  } else {
    const { data: fjCats } = await supabase
      .from('clue_pool')
      .select('category, question, answer')
      .eq('round', 'Final Jeopardy')
      .limit(50)
    if (fjCats && fjCats.length > 0) {
      const pick = fjCats[Math.floor(Math.random() * fjCats.length)] as any
      finalCategoryName = pick.category
      finalClueText = pick.question
      finalAnswerText = pick.answer
    }
  }

  const { data: players } = await supabase
    .from('players').select('id').eq('game_id', gameId)
  if (!players || players.length === 0) throw new Error('No players in game')
  const firstPlayer = players[Math.floor(Math.random() * players.length)]

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

export async function startGame(gameId: string) {
  console.log('[startGame] Starting RANDOM game (no sourceGameId)')
  if (!(await claimGameSeed(gameId))) {
    console.log('[startGame] another caller already seeded; skipping')
    return
  }
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

  // Topic board: user picked/typed their own category headers. Entirely
  // separate build path — see lib/topic-board.ts.
  const boardTopics = (settings as any)?.boardTopics as BoardTopic[] | undefined
  if (boardTopics && boardTopics.length > 0) {
    await buildTopicBoard(gameId, boardTopics, lengthConfig)
    return
  }

  // Determine which game IDs to pull from based on gameType
  const gameType = (settings as any)?.gameType as string | undefined
  const GAME_TYPE_TO_IDS: Record<string, string> = {
    kids: 'Kids Week',
    teen: 'Teen Tournament',
    toc: 'Tournament of Champions',
  }
  const tournamentKey = gameType ? GAME_TYPE_TO_IDS[gameType] : undefined
  const allowedGameIds = tournamentKey ? TOURNAMENT_GAME_IDS[tournamentKey] : undefined

  // Category theme uses the pre-computed category_type column (indexed).
  // Settings accept either a single `categoryTheme` (string) or `categoryThemes`
  // (array, for Mix Mashups) — normalize to one list.
  const categoryThemesSetting = (settings as any)?.categoryThemes as string[] | undefined
  const singleTheme = (settings as any)?.categoryTheme as string | undefined
  const categoryThemes =
    categoryThemesSetting && categoryThemesSetting.length > 0
      ? categoryThemesSetting
      : singleTheme
        ? [singleTheme]
        : null
  // Free-text topic search — finds categories whose name matches a user-typed
  // term. Sidesteps the predefined category_type taxonomy entirely so users
  // can ask for arbitrary topics ("football", "the Beatles", "Africa", etc.)
  const customCategorySearch = ((settings as any)?.customCategorySearch as string | undefined)?.trim() || undefined

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

    // Topic search: pick from categories whose name matches the user's term.
    // This bypasses the predefined category_type taxonomy entirely.
    if (customCategorySearch) {
      const safe = customCategorySearch.replace(/[%_]/g, ' ')
      const { data: topicRows } = await supabase
        .from('clue_pool')
        .select('category')
        .eq('round', roundName)
        .ilike('category', `%${safe}%`)
        .limit(20000)
      if (!topicRows || topicRows.length === 0) {
        throw new Error(`No categories match "${customCategorySearch}" in ${roundName}.`)
      }
      const counts: Record<string, number> = {}
      for (const row of topicRows) counts[(row as any).category] = (counts[(row as any).category] || 0) + 1
      const eligible = Object.keys(counts).filter((c) => counts[c] >= CLUES_PER_CAT)
      if (eligible.length < count) {
        throw new Error(
          `Not enough categories match "${customCategorySearch}" with ${CLUES_PER_CAT}+ clues ` +
          `(need ${count}, found ${eligible.length}). Try a broader term or pick a smaller board size.`,
        )
      }
      for (let i = eligible.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[eligible[i], eligible[j]] = [eligible[j], eligible[i]]
      }
      return eligible.slice(0, count)
    }

    // Mix mode: pick a balanced, interleaved set of categories across themes.
    // For 6 categories with Politics + Geography, the result is 3 + 3
    // alternating (politics, geography, politics, geography, ...). Extras when
    // the count doesn't divide evenly go to the first themes in user order.
    if (categoryThemes && categoryThemes.length > 1) {
      const { data: mixRows } = await supabase
        .from('clue_pool')
        .select('category, category_type')
        .eq('round', roundName)
        .in('category_type', categoryThemes)
        .limit(20000)
      if (!mixRows || mixRows.length === 0) {
        throw new Error(`No clues found for round: ${roundName}`)
      }

      // Count clues per (theme, category)
      const countsByTheme = new Map<string, Map<string, number>>()
      for (const row of mixRows) {
        const t = (row as any).category_type as string | null
        const c = (row as any).category as string | null
        if (!t || !c) continue
        if (!countsByTheme.has(t)) countsByTheme.set(t, new Map())
        const m = countsByTheme.get(t)!
        m.set(c, (m.get(c) || 0) + 1)
      }

      // Shuffle eligible categories per theme
      const eligibleByTheme = new Map<string, string[]>()
      for (const t of categoryThemes) {
        const inner = countsByTheme.get(t) || new Map<string, number>()
        const list: string[] = []
        for (const [cat, n] of inner) {
          if (n >= CLUES_PER_CAT) list.push(cat)
        }
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[list[i], list[j]] = [list[j], list[i]]
        }
        eligibleByTheme.set(t, list)
      }

      // Even allocation per theme, with leftovers distributed to first themes
      const allocation = new Map<string, number>()
      const base = Math.floor(count / categoryThemes.length)
      for (const t of categoryThemes) allocation.set(t, base)
      const leftover = count - base * categoryThemes.length
      for (let i = 0; i < leftover; i++) {
        const t = categoryThemes[i]
        allocation.set(t, (allocation.get(t) || 0) + 1)
      }

      // If a theme is short on eligible categories, fill from others that have spare
      let shortfall = 0
      for (const t of categoryThemes) {
        const eligible = (eligibleByTheme.get(t) || []).length
        const want = allocation.get(t) || 0
        if (want > eligible) {
          shortfall += want - eligible
          allocation.set(t, eligible)
        }
      }
      if (shortfall > 0) {
        for (const t of categoryThemes) {
          if (shortfall === 0) break
          const eligible = (eligibleByTheme.get(t) || []).length
          const want = allocation.get(t) || 0
          const spare = eligible - want
          if (spare > 0) {
            const take = Math.min(spare, shortfall)
            allocation.set(t, want + take)
            shortfall -= take
          }
        }
      }

      const totalPicked = [...allocation.values()].reduce((a, b) => a + b, 0)
      if (totalPicked < count) {
        throw new Error(
          `Not enough mix categories for ${roundName} ` +
          `(need ${count}, found ${totalPicked} across ${categoryThemes.join(', ')})`,
        )
      }

      // Take the allocated slice per theme
      const pickedByTheme = new Map<string, string[]>()
      for (const t of categoryThemes) {
        pickedByTheme.set(t, (eligibleByTheme.get(t) || []).slice(0, allocation.get(t) || 0))
      }

      // Interleave: theme1[0], theme2[0], theme1[1], theme2[1], ...
      const out: string[] = []
      let i = 0
      while (out.length < count) {
        let advanced = false
        for (const t of categoryThemes) {
          const list = pickedByTheme.get(t)!
          if (list.length > i) {
            out.push(list[i])
            advanced = true
            if (out.length >= count) break
          }
        }
        if (!advanced) break
        i++
      }
      return out
    }

    // Single-theme or random path
    if (categoryThemes && categoryThemes.length === 1) {
      query = query.eq('category_type', categoryThemes[0])
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

  if (customCategorySearch) {
    const safe = customCategorySearch.replace(/[%_]/g, ' ')
    fjQuery = fjQuery.ilike('category', `%${safe}%`)
  } else if (categoryThemes && categoryThemes.length === 1) {
    fjQuery = fjQuery.eq('category_type', categoryThemes[0])
  } else if (categoryThemes && categoryThemes.length > 1) {
    fjQuery = fjQuery.in('category_type', categoryThemes)
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
      const playerAnswer = (p.final_answer || '').trim()
      const wager = p.final_wager || 0

      // Writing nothing costs nothing. Standard rules would dock the wager,
      // but a party guest who looked away shouldn't be punished for it —
      // they simply sit the round out.
      if (!playerAnswer) {
        await supabase
          .from('players')
          .update({ final_correct: false })
          .eq('id', p.id)
        continue
      }

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
  const [{ data: clue, error: clueError }, { data: gameRow }] = await Promise.all([
    supabase.from('clues').select('*').eq('id', clueId).single(),
    supabase.from('games').select('settings').eq('id', gameId).single(),
  ])

  // Host-run games: only the host picks. Refuse here as well as hiding the
  // board on phones, so a stale tab or a crafted request can't take the board.
  if ((gameRow?.settings as any)?.gameMode === 'host') {
    throw new Error('The host picks the clues in this game.')
  }

  if (clueError || !clue) throw clueError || new Error('Clue not found')

  // Set the current clue and change phase
  const nextPhase = clue.is_daily_double ? 'daily_double_wager' : 'clue_reading'

  const update: any = {
    current_clue_id: clueId,
    phase: nextPhase,
    current_player_id: playerId,
    // Clear any shortened rebuzz duration left over from the previous clue.
    buzz_window_ms: null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase.from('games').update(update).eq('id', gameId)
  if (error) {
    // Column may not exist yet (migration not applied) — retry without it.
    delete update.buzz_window_ms
    const { error: retryErr } = await supabase.from('games').update(update).eq('id', gameId)
    if (retryErr) throw retryErr
  }
}

/**
 * Submit a buzz.
 * Records the buzz and sets the player as the current answerer.
 * Sends a high-resolution client timestamp so the server can break ties
 * when two players buzz at nearly the same instant.
 */
export type BuzzOrderRow = {
  player_id: string
  is_winner: boolean
  server_timestamp: string
  client_timestamp: number | null
  answer: string | null
  is_correct: boolean | null
}

/**
 * Fetch every non-passing buzz for a clue in the order they arrived
 * (server_timestamp, then client_timestamp as tiebreaker — same rule
 * resolve_buzz uses to pick the winner). Used to render "who buzzed first".
 */
export async function getBuzzOrder(gameId: string, clueId: string): Promise<BuzzOrderRow[]> {
  const { data, error } = await supabase
    .from('buzzes')
    .select('player_id, is_winner, server_timestamp, client_timestamp, answer, is_correct')
    .eq('game_id', gameId)
    .eq('clue_id', clueId)
    .eq('is_pass', false)
    .order('server_timestamp', { ascending: true })
    .order('client_timestamp', { ascending: true, nullsFirst: false })
  if (error) {
    console.warn('[getBuzzOrder] failed:', error.message)
    return []
  }
  return (data || []) as BuzzOrderRow[]
}

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
  const [{ data: clue }, { data: game }, { data: playerData }] = await Promise.all([
    supabase.from('clues').select('answer, value, is_daily_double').eq('id', clueId).single(),
    supabase.from('games').select('current_round, phase, settings').eq('id', gameId).single(),
    supabase.from('players').select('final_wager').eq('id', playerId).single(),
  ])

  if (!clue) throw new Error('Clue not found')

  const correct = checkAnswer(answer, clue.answer)
  const isDailyDouble = clue.is_daily_double && (game?.phase === 'daily_double_answering')
  const pointValue = isDailyDouble ? (playerData?.final_wager || clue.value) : clue.value
  const scoreChange = correct ? pointValue : -pointValue

  const { data: player } = await supabase
    .from('players').select('score').eq('id', playerId).single()

  if (player) {
    await supabase
      .from('players')
      .update({ score: player.score + scoreChange })
      .eq('id', playerId)
  }

  // Record this attempt on the buzz row
  await supabase
    .from('buzzes')
    .update({ answer, is_correct: correct })
    .eq('game_id', gameId)
    .eq('clue_id', clueId)
    .eq('player_id', playerId)

  // Correct answer or a Daily Double (single-answerer): close out the clue.
  if (correct || isDailyDouble) {
    await supabase.from('clues').update({
      is_answered: true,
      answered_by: playerId,
      answered_correct: correct,
    }).eq('id', clueId)

    const updateFields: any = { phase: 'clue_result', updated_at: new Date().toISOString() }
    if (correct) updateFields.current_player_id = playerId
    await supabase.from('games').update(updateFields).eq('id', gameId)
    return { correct, scoreChange }
  }

  // Wrong answer on a regular clue (both party and multiplayer):
  // rebound to the next-fastest buzzer if any, otherwise reopen the
  // buzz window so untried players can jump in.
  await advanceAfterFailedAnswer(gameId, clueId, playerId)
  return { correct, scoreChange }
}

/**
 * After a buzzer answers wrong or lets the answer clock run out on a regular
 * clue, promote the next-fastest untried buzzer. If none, REOPEN the buzz
 * window so any player who hasn't attempted yet gets a shot — skipClue's
 * auto-timeout later closes the clue if nobody jumps in.
 */
async function advanceAfterFailedAnswer(gameId: string, clueId: string, lastAnswererId: string) {
  const { data: nextRows } = await supabase
    .from('buzzes')
    .select('player_id, server_timestamp, client_timestamp')
    .eq('game_id', gameId)
    .eq('clue_id', clueId)
    .eq('is_pass', false)
    .is('is_correct', null) // untried — is_correct gets set once they attempt
    .neq('player_id', lastAnswererId)
    .order('server_timestamp', { ascending: true })
    .order('client_timestamp', { ascending: true, nullsFirst: false })
    .limit(1)

  const next = nextRows?.[0]

  if (next) {
    await supabase
      .from('games')
      .update({
        current_player_id: next.player_id,
        phase: 'player_answering',
        updated_at: new Date().toISOString(),
      })
      .eq('id', gameId)
    return
  }

  // Queue exhausted — reopen the buzz window for anyone who hasn't tried.
  // Shorter than the opening window: everyone has already heard the clue, so
  // this is a quick "anyone else?" rather than a fresh read.
  const { data: g } = await supabase
    .from('games').select('settings').eq('id', gameId).single()
  const fullWindow = (g?.settings as any)?.buzz_window_ms ?? 10000
  const reopenMs = Math.max(4000, Math.round(fullWindow * 0.5))

  const update: any = {
    phase: 'buzz_window',
    buzz_window_open: true,
    buzz_window_start: new Date(Date.now() + 700).toISOString(),
    buzz_window_ms: reopenMs,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('games').update(update).eq('id', gameId)
  if (error) {
    // buzz_window_ms column missing (migration not applied) — reopen anyway
    // at the default duration rather than stranding the clue.
    console.warn('[advanceAfterFailedAnswer] retrying without buzz_window_ms:', error.message)
    delete update.buzz_window_ms
    await supabase.from('games').update(update).eq('id', gameId)
  }
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

/* ─── Host mode ───────────────────────────────────────────────────────────
   A human runs the board: they pick the clue, decide when buzzers open, and
   judge each answer by ear. Players never type an answer — their phone is a
   buzzer that also shows the clue once the host opens it. */

/** Put a clue on screen with buzzers still closed. */
export async function hostSelectClue(gameId: string, clueId: string) {
  const { error } = await supabase
    .from('games')
    .update({
      current_clue_id: clueId,
      phase: 'clue_reading',
      buzz_window_open: false,
      buzz_window_ms: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', gameId)
  if (error) throw error
}

/** Open the buzzers. Players' phones reveal the clue at the same moment. */
export async function hostOpenBuzzers(gameId: string, windowMs?: number) {
  const update: any = {
    phase: 'buzz_window',
    buzz_window_open: true,
    buzz_window_start: new Date(Date.now() + 700).toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (windowMs) update.buzz_window_ms = windowMs
  const { error } = await supabase.from('games').update(update).eq('id', gameId)
  if (error) throw error
}

/**
 * Host's verdict on whoever is holding the buzz.
 * Correct closes the clue and hands them the board. Wrong deducts and passes
 * to the next player in the buzz queue, or reopens the buzzers if none remain.
 */
export async function hostJudge(
  gameId: string,
  clueId: string,
  playerId: string,
  correct: boolean,
) {
  const [{ data: clue }, { data: player }] = await Promise.all([
    supabase.from('clues').select('value').eq('id', clueId).single(),
    supabase.from('players').select('score').eq('id', playerId).single(),
  ])
  const value = clue?.value ?? 0

  if (player) {
    await supabase
      .from('players')
      .update({ score: player.score + (correct ? value : -value) })
      .eq('id', playerId)
  }

  await supabase
    .from('buzzes')
    .update({ is_correct: correct })
    .eq('game_id', gameId).eq('clue_id', clueId).eq('player_id', playerId)

  if (correct) {
    await supabase.from('clues')
      .update({ is_answered: true, answered_by: playerId, answered_correct: true })
      .eq('id', clueId)
    await supabase.from('games')
      .update({ phase: 'clue_result', current_player_id: playerId, updated_at: new Date().toISOString() })
      .eq('id', gameId)
    return
  }

  await advanceAfterFailedAnswer(gameId, clueId, playerId)
}

/** Manual score nudge — the host always gets the last word. */
export async function hostAdjustScore(playerId: string, delta: number) {
  const { data: player } = await supabase
    .from('players').select('score').eq('id', playerId).single()
  if (!player) return
  await supabase.from('players')
    .update({ score: player.score + delta }).eq('id', playerId)
}

/** Nobody got it — close the clue out and return to the board. */
export async function hostCloseClue(gameId: string, clueId: string) {
  await supabase.from('clues')
    .update({ is_answered: true, answered_by: null }).eq('id', clueId)
  await supabase.from('games')
    .update({ phase: 'clue_result', updated_at: new Date().toISOString() })
    .eq('id', gameId)
}

/**
 * Submit a Daily Double wager.
 * Server clamps to Jeopardy! rules: minimum $5, maximum is max(player.score, round max clue).
 * Round-1 max is $1000, round-2 max is $2000 — so a player under those scores can still wager
 * up to that floor. After wagering, move to the answering phase.
 */
export async function submitWager(gameId: string, playerId: string, wager: number) {
  const [{ data: game }, { data: player }] = await Promise.all([
    supabase.from('games').select('current_round, settings').eq('id', gameId).single(),
    supabase.from('players').select('score').eq('id', playerId).single(),
  ])

  const roundMax = game?.current_round === 2 ? 2000 : 1000
  const maxWager = Math.max(player?.score ?? 0, roundMax)
  const clamped = Math.min(Math.max(Math.floor(wager) || 5, 5), maxWager)

  await supabase
    .from('players')
    .update({ final_wager: clamped })
    .eq('id', playerId)

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
 * Player who buzzed in fails to answer in time (or taps "I Don't Know").
 * Deducts the clue value — or the Daily Double wager — from their score.
 * If more buzzers are waiting in the queue, hands the mic to the next one
 * instead of closing the clue.
 */
export async function passAfterBuzz(gameId: string, clueId: string, playerId: string) {
  const [{ data: clue }, { data: game }, { data: playerData }] = await Promise.all([
    supabase.from('clues').select('value, is_daily_double, is_answered').eq('id', clueId).single(),
    supabase.from('games').select('phase, settings, current_player_id, current_clue_id').eq('id', gameId).single(),
    supabase.from('players').select('score, final_wager').eq('id', playerId).single(),
  ])

  // Guard against a stale timer firing after the game has moved on. If the
  // clue is already closed OR this player is no longer the active answerer
  // (mic passed to next in queue), do nothing — otherwise we'd re-deduct
  // and re-run the rebound.
  if (
    !clue ||
    !game ||
    clue.is_answered ||
    game.current_clue_id !== clueId ||
    (game.phase !== 'player_answering' && game.phase !== 'daily_double_answering') ||
    game.current_player_id !== playerId
  ) return

  const isDailyDouble = clue.is_daily_double && (game.phase === 'daily_double_answering')
  const pointValue = isDailyDouble ? (playerData?.final_wager || clue.value || 0) : (clue.value || 0)

  if (playerData && pointValue > 0) {
    await supabase
      .from('players')
      .update({ score: playerData.score - pointValue })
      .eq('id', playerId)
  }

  // Record the timeout on this player's buzz row so it counts as a tried attempt.
  await supabase
    .from('buzzes')
    .update({ answer: '', is_correct: false })
    .eq('game_id', gameId)
    .eq('clue_id', clueId)
    .eq('player_id', playerId)

  // Daily Doubles have only one attempt — close out immediately.
  if (isDailyDouble) {
    await supabase.from('clues').update({
      is_answered: true,
      answered_by: playerId,
      answered_correct: false,
    }).eq('id', clueId)

    await supabase.from('games').update({
      phase: 'clue_result',
      updated_at: new Date().toISOString(),
    }).eq('id', gameId)
    return
  }

  // Regular clue in either mode — rebound to next buzzer or reopen the window.
  await advanceAfterFailedAnswer(gameId, clueId, playerId)
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
/**
 * Fast path: query the games_index materialized view (~9,300 rows) instead of
 * scanning clue_pool (~558,000). Returns null when the view doesn't exist yet
 * so the caller can fall back to the legacy clue_pool scan.
 * See supabase-migration-games-index.sql.
 */
async function searchGamesIndexed(filters: GameSearchFilters): Promise<GameSearchResult[] | null> {
  const { query, season, notesFilter, dateFrom, dateTo, page = 0, limit = 50 } = filters

  let qb = supabase
    .from('games_index')
    .select('game_id_source, game_title, air_date, player1, player2, player3, season, clue_count')

  if (season) qb = qb.eq('season', season)
  if (dateFrom) qb = qb.gte('air_date', dateFrom)
  if (dateTo) qb = qb.lte('air_date', dateTo)

  // Difficulty tiers: prefer the curated id list, fall back to matching notes.
  if (notesFilter) {
    const ids = TOURNAMENT_GAME_IDS[notesFilter]
    if (ids) qb = qb.in('game_id_source', ids)
    else qb = qb.ilike('notes', `%${notesFilter.replace(/[%_]/g, ' ')}%`)
  }

  const trimmed = query?.trim()
  if (trimmed) {
    const asNum = parseInt(trimmed, 10)
    if (!isNaN(asNum) && String(asNum) === trimmed) {
      qb = qb.eq('game_id_source', asNum)
    } else {
      // Safe inside .or() — quote the value and use * as the wildcard, since
      // this string is spliced into the URL rather than encoded.
      const safe = trimmed.replace(/["(),]/g, ' ').trim()
      if (!safe) return []
      qb = qb.or(
        [
          `game_title.ilike."%${safe}%"`,
          `notes.ilike."%${safe}%"`,
          `player1.ilike."%${safe}%"`,
          `player2.ilike."%${safe}%"`,
          `player3.ilike."%${safe}%"`,
        ].join(','),
      )
    }
  }

  const from = page * limit
  const { data, error } = await qb
    .order('air_date', { ascending: false, nullsFirst: false })
    .range(from, from + limit - 1)

  if (error) {
    // 42P01 = undefined_table — migration not applied yet.
    if (/games_index/i.test(error.message) || error.code === '42P01') {
      console.warn('[searchGames] games_index missing, falling back to clue_pool scan')
      return null
    }
    throw error
  }

  return (data ?? []).map((r: any) => ({
    game_id_source: r.game_id_source,
    game_title: r.game_title || '',
    air_date: r.air_date,
    player1: r.player1 || '',
    player2: r.player2 || '',
    player3: r.player3 || '',
    season: r.season || '',
    clue_count: r.clue_count ?? 0,
  }))
}

export async function searchGames(filters: GameSearchFilters = {}): Promise<GameSearchResult[]> {
  // Try the indexed view first; it handles every filter combination and
  // returns in milliseconds. Falls through to the legacy scan only when the
  // migration hasn't been applied.
  const indexed = await searchGamesIndexed(filters)
  if (indexed) return indexed

  const { query, season, notesFilter, dateFrom, dateTo, page = 0, limit = 50 } = filters

  function addDateFilters(qb: any) {
    if (season) qb = qb.eq('season', season)
    if (dateFrom) qb = qb.gte('air_date', dateFrom)
    if (dateTo) qb = qb.lte('air_date', dateTo)
    return qb
  }

  const cols = 'game_id_source, game_title, air_date, player1, player2, player3, season'
  // 5000 was timing out on free-tier Supabase. 2000 still gives ~30-100 unique
  // games after dedupe (the page-of-50 slice almost always fits).
  const fetchLimit = 2000

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
      // Text search across title, notes, and player names.
      // Title/notes need pg_trgm GIN indexes (supabase-migration-search-trigram.sql).
      // Strategy: try a broad OR across all 5 cols; on timeout/error, fall back
      // to progressively narrower queries so something still returns. Values
      // are wrapped in double quotes so commas/parens in the query don't
      // break PostgREST's OR parser.
      const safe = trimmed.replace(/"/g, '')
      if (safe.length < 3) {
        // pg_trgm needs >= 3 chars to use its index; shorter queries scan the
        // whole 558K-row table and time out.
        throw new Error('Type at least 3 characters to search. Or use the difficulty / season filters.')
      }
      const TEXT_LIMIT = 2000
      const buildOr = (cs: string[]) => cs.map((c) => `${c}.ilike."%${safe}%"`).join(',')

      // First attempt: broad OR.
      let result = await addDateFilters(
        supabase.from('clue_pool').select(cols).or(buildOr(['game_title', 'notes', 'player1', 'player2', 'player3']))
      ).order('air_date', { ascending: false }).limit(TEXT_LIMIT)

      // Fallback 1: title + notes only (drops 3 columns of OR cost).
      if (result.error) {
        console.warn('[searchGames] broad search failed, trying title+notes:', result.error.message)
        result = await addDateFilters(
          supabase.from('clue_pool').select(cols).or(buildOr(['game_title', 'notes']))
        ).order('air_date', { ascending: false }).limit(TEXT_LIMIT)
      }

      // Fallback 2: players only — short, fast columns.
      if (result.error) {
        console.warn('[searchGames] title+notes failed, trying players:', result.error.message)
        result = await addDateFilters(
          supabase.from('clue_pool').select(cols).or(buildOr(['player1', 'player2', 'player3']))
        ).order('air_date', { ascending: false }).limit(TEXT_LIMIT)
      }

      // Fallback 3: just title (single column query, simplest plan).
      if (result.error) {
        console.warn('[searchGames] players failed, trying title only:', result.error.message)
        result = await addDateFilters(
          supabase.from('clue_pool').select(cols).ilike('game_title', `%${safe}%`)
        ).order('air_date', { ascending: false }).limit(1000)
      }

      if (result.error) {
        const msg = /timeout/i.test(result.error.message)
          ? `Search for "${safe}" timed out. Try a longer or more specific term, or filter by difficulty / season instead.`
          : result.error.message
        throw new Error(msg)
      }
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
  if (!(await claimGameSeed(gameId))) {
    console.log('[startGameFromSource] another caller already seeded; skipping')
    return
  }
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
  if (!(await claimGameSeed(gameId))) {
    console.log('[startCustomGame] another caller already seeded; skipping')
    return
  }
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
export async function saveCustomBoard(
  title: string,
  boardData: CustomBoard,
  creatorUserId?: string,
) {
  // Every board is public. "Private" only ever hid boards from their own
  // author — updates and deletes were open to anyone regardless — so it was
  // a lock with no door.
  const isPublic = true
  // First try with creator_user_id (post user-identity migration). If the
  // column doesn't exist yet, retry without it so saving still works.
  // Generate the id here rather than reading it back. The SELECT policy used
  // to hide private boards, so `.select().single()` after inserting one
  // returned zero rows and threw "Cannot coerce the result to a single JSON
  // object" — the row was written, we just couldn't see it. Supplying the id
  // means the insert never has to read anything.
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : undefined

  const fullPayload: any = {
    ...(id ? { id } : {}),
    title,
    board_data: boardData,
    is_public: isPublic,
    creator_user_id: creatorUserId || null,
  }

  let { error } = await supabase.from('custom_boards').insert(fullPayload)
  if (error && /creator_user_id/.test(error.message || '')) {
    console.warn('[saveCustomBoard] creator_user_id column missing; saving without ownership')
    const { creator_user_id: _drop, ...rest } = fullPayload
    error = (await supabase.from('custom_boards').insert(rest)).error
  }
  if (error) throw error

  if (id) return { id, title }

  // No crypto.randomUUID (very old browser) — fall back to looking it up.
  const { data } = await supabase
    .from('custom_boards')
    .select('id, title')
    .eq('title', title)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data
}

/**
 * List public custom boards for browsing.
 */
export type CustomBoardRow = {
  id: string
  title: string
  is_public: boolean
  created_at: string
  creator_user_id?: string | null
}

export async function listCustomBoards(search?: string): Promise<CustomBoardRow[]> {
  async function run(cols: string) {
    let query = supabase
      .from('custom_boards')
      .select(cols)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(50)
    if (search) query = query.ilike('title', `%${search}%`)
    return query
  }
  // Try the full select with creator_user_id first; if the column doesn't exist
  // (pre user-identity migration) fall back to the legacy projection.
  let { data, error } = await run('id, title, is_public, created_at, creator_user_id')
  if (error && /creator_user_id/.test(error.message || '')) {
    const fallback = await run('id, title, is_public, created_at')
    data = fallback.data as any
    error = fallback.error
  }
  if (error) throw error
  return (data as unknown as CustomBoardRow[]) || []
}

/**
 * Update an existing custom board.
 */
export async function updateCustomBoard(boardId: string, title: string, boardData: CustomBoard) {
  const isPublic = true
  // No .single() here either: a private board's row is invisible to the SELECT
  // policy on older databases, and the update itself is what matters.
  const { error } = await supabase
    .from('custom_boards')
    .update({ title, board_data: boardData, is_public: isPublic })
    .eq('id', boardId)
  if (error) throw error
  return { id: boardId, title }
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
/**
 * Reshape a J-Archive game (rows in clue_pool) into a CustomBoard for preview.
 * Returns single / double Jeopardy boards + the Final Jeopardy category. The
 * actual clue text is included so it can be quoted on the preview if we ever
 * want; the BoardPreview component itself only shows category names + values.
 */
export async function loadGamePreview(gameIdSource: number) {
  const { data, error } = await supabase
    .from('clue_pool')
    .select('round, category, value, question, answer, is_daily_double, game_title, air_date, season, player1, player2, player3')
    .eq('game_id_source', gameIdSource)
  if (error) throw error
  if (!data || data.length === 0) throw new Error(`No clues found for game ${gameIdSource}`)

  const first = data[0] as any
  const players = [first.player1, first.player2, first.player3].filter(Boolean) as string[]

  // Group: round name → category name → list of clue rows
  const grouped: Record<string, Record<string, Array<{ value: number; question: string; answer: string; is_daily_double: boolean }>>> = {
    'Jeopardy Round': {},
    'Double Jeopardy': {},
  }
  let finalJeopardy: CustomBoard['finalJeopardy'] = undefined

  for (const row of data) {
    const r = (row as any).round as string
    const cat = (row as any).category as string
    if (!r || !cat) continue
    if (r === 'Final Jeopardy') {
      if (!finalJeopardy) {
        finalJeopardy = {
          categoryName: cat,
          question: (row as any).question || '',
          answer: (row as any).answer || '',
        }
      }
      continue
    }
    if (!grouped[r]) continue
    if (!grouped[r][cat]) grouped[r][cat] = []
    grouped[r][cat].push({
      value: (row as any).value || 0,
      question: (row as any).question || '',
      answer: (row as any).answer || '',
      is_daily_double: !!(row as any).is_daily_double,
    })
  }

  const buildRound = (roundName: string) => {
    const cats = Object.entries(grouped[roundName]).map(([name, clues]) => ({
      name,
      clues: clues
        .sort((a, b) => a.value - b.value)
        .map((c) => ({
          question: c.question,
          answer: c.answer,
          value: c.value,
          isDailyDouble: c.is_daily_double,
        })),
    }))
    return { categories: cats }
  }

  const board: CustomBoard = {
    rounds: [buildRound('Jeopardy Round'), buildRound('Double Jeopardy')].filter(
      (r) => r.categories.length > 0,
    ),
    finalJeopardy,
  }

  return {
    sourceGameId: gameIdSource,
    title: (first.game_title as string) || `Game #${gameIdSource}`,
    airDate: (first.air_date as string | null) ?? null,
    season: (first.season as string | null) ?? null,
    players,
    board,
  }
}

/**
 * Fork a real J-Archive game into a brand-new editable custom board.
 * Returns the new custom_boards.id so the caller can navigate to
 * /create?boardId=<id>. Requires sign-in: anonymous forks can't be edited
 * later because the custom_boards UPDATE policy is owner-only.
 */
export async function forkGameToCustomBoard(sourceGameId: number, creatorUserId: string): Promise<{ id: string }> {
  const preview = await loadGamePreview(sourceGameId)
  const data = await saveCustomBoard(
    `Forked: ${preview.title}`,
    preview.board,
    creatorUserId,
  )
  if (!data?.id) throw new Error('Fork failed — no board id returned')
  return { id: data.id as string }
}

export async function loadCustomBoard(boardId: string) {
  const { data, error } = await supabase
    .from('custom_boards')
    .select('*')
    .eq('id', boardId)
    .single()
  if (error) throw error
  return data as {
    id: string
    title: string
    board_data: CustomBoard
    is_public: boolean
    created_at: string
    creator_user_id?: string | null
  }
}

export type PlayCountKind = 'game' | 'mashup' | 'custom'

/**
 * Increment the play counter for a game / mashup / custom board.
 * Fire-and-forget — failures log but don't block playback.
 */
export async function incrementPlayCount(kind: PlayCountKind, key: string) {
  const { error } = await supabase.rpc('increment_play_count', { p_kind: kind, p_key: key })
  if (error) console.warn('[play_counts] increment failed:', error.message)
}

/**
 * Fetch play counts for one kind, optionally narrowed to a list of keys.
 * Returns a Map<key, count>; missing keys are absent (treat as 0).
 */
export async function getPlayCounts(kind: PlayCountKind, keys?: string[]): Promise<Map<string, number>> {
  let q = supabase.from('play_counts').select('key, count').eq('kind', kind)
  if (keys && keys.length > 0) q = q.in('key', keys)
  const { data, error } = await q
  if (error) {
    console.warn('[play_counts] fetch failed:', error.message)
    return new Map()
  }
  return new Map((data || []).map((r: any) => [r.key as string, r.count as number]))
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
/**
 * Create a PLAYABLE lobby from a board that only exists in the editor.
 *
 * Unlike createPresentationGame this does NOT seed the board or start the
 * game — it stops at the lobby so buzzer players can join first. The board
 * rides along in settings.customBoard, which the lobby's Start Game path
 * hands to startCustomGame.
 *
 * mode 'party'       → one shared screen, players buzz on phones
 * mode 'multiplayer' → everyone on their own device
 */
export async function createGameFromCustomBoard(
  board: CustomBoard,
  mode: 'party' | 'multiplayer',
) {
  const settings: any = {
    ...DEFAULT_CASUAL_SETTINGS,
    gameMode: mode,
    customBoard: board,
  }
  const { game } = await createGame(settings, false)
  return game.room_code
}

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
