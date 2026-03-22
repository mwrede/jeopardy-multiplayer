export type GameStatus = 'lobby' | 'active' | 'round_end' | 'final_jeopardy' | 'finished'

export type GamePhase =
  | 'lobby'
  | 'board_selection'
  | 'clue_reading'
  | 'buzz_window'
  | 'player_answering'
  | 'daily_double_wager'
  | 'daily_double_answering'
  | 'clue_result'
  | 'round_end'
  | 'final_category'
  | 'final_wager'
  | 'final_clue'
  | 'final_answering'
  | 'final_reveal'
  | 'game_over'

export interface Game {
  id: string
  room_code: string
  status: GameStatus
  current_round: number
  current_clue_id: string | null
  current_player_id: string | null
  phase: GamePhase
  buzz_window_open: boolean
  buzz_window_start: string | null
  settings: GameSettings
  created_at: string
  updated_at: string
  final_category_name: string | null
  final_clue_text: string | null
  final_answer: string | null
}

export type GameLength = 'full' | 'half' | 'rapid'

export type GameMode = 'party' | 'multiplayer'

export interface GameSettings {
  mode: 'casual' | 'strict'
  judgment: 'ai' | 'voting'
  gameMode: GameMode
  gameLength: GameLength
  reading_period_ms: number
  buzz_window_ms: number
  answer_time_ms: number
  daily_double_answer_ms: number
  final_answer_ms: number
}

export const GAME_LENGTH_CONFIG: Record<GameLength, {
  categories: number
  cluesPerCat: number
  values1: number[]
  values2: number[]
  dd1: number
  dd2: number
}> = {
  full:  { categories: 6, cluesPerCat: 5, values1: [200, 400, 600, 800, 1000], values2: [400, 800, 1200, 1600, 2000], dd1: 1, dd2: 2 },
  half:  { categories: 6, cluesPerCat: 3, values1: [200, 400, 600],            values2: [400, 800, 1200],              dd1: 1, dd2: 1 },
  rapid: { categories: 3, cluesPerCat: 3, values1: [200, 400, 600],            values2: [400, 800, 1200],              dd1: 1, dd2: 1 },
}

export const DEFAULT_CASUAL_SETTINGS: GameSettings = {
  mode: 'casual',
  judgment: 'ai',
  gameMode: 'party',
  gameLength: 'full',
  reading_period_ms: 0,
  buzz_window_ms: 15000,
  answer_time_ms: 15000,
  daily_double_answer_ms: 25000,
  final_answer_ms: 45000,
}

// Game search result for browsing J-Archive games
export interface GameSearchResult {
  game_id_source: number
  game_title: string
  air_date: string | null
  player1: string
  player2: string
  player3: string
  season: string
  clue_count: number
}

// Structured filters for game search
export interface GameSearchFilters {
  query?: string       // free text search (title, notes, player names)
  season?: string      // exact season match
  notesFilter?: string // ilike filter on notes field (for tournament types)
  dateFrom?: string    // YYYY-MM-DD
  dateTo?: string      // YYYY-MM-DD
  page?: number
  limit?: number
}

export const DEFAULT_STRICT_SETTINGS: GameSettings = {
  mode: 'strict',
  judgment: 'ai',
  gameMode: 'party',
  gameLength: 'full',
  reading_period_ms: 3000,
  buzz_window_ms: 10000,
  answer_time_ms: 15000,
  daily_double_answer_ms: 20000,
  final_answer_ms: 30000,
}

export interface Player {
  id: string
  game_id: string
  name: string
  score: number
  is_connected: boolean
  join_order: number
  latency_ms: number | null
  is_ready: boolean
  final_wager: number | null
  final_answer: string | null
  final_correct: boolean | null
}

export interface Category {
  id: string
  game_id: string
  name: string
  round_number: number
  position: number
}

export interface Clue {
  id: string
  category_id: string
  value: number
  question: string
  answer: string
  is_daily_double: boolean
  is_answered: boolean
  answered_by: string | null
  answered_correct: boolean | null
}

export interface Buzz {
  id: string
  game_id: string
  clue_id: string
  player_id: string
  server_timestamp: string
  client_timestamp: number | null
  latency_offset: number | null
  adjusted_time: string | null
  is_winner: boolean
  answer: string | null
  is_correct: boolean | null
}

// Realtime event types
export type RealtimeEvent =
  | { type: 'game_state'; payload: Partial<Game> }
  | { type: 'player_joined'; payload: Player }
  | { type: 'player_ready'; payload: { player_id: string; is_ready: boolean } }
  | { type: 'clue_selected'; payload: { clue_id: string; clue: Clue; is_daily_double: boolean } }
  | { type: 'buzz_window_open'; payload: { clue_id: string; deadline: string } }
  | { type: 'buzz_winner'; payload: { player_id: string; player_name: string } }
  | { type: 'buzz_lockout'; payload: { player_id: string; duration_ms: number } }
  | { type: 'answer_result'; payload: { player_id: string; answer: string; correct: boolean; score_change: number; new_score: number } }
  | { type: 'clue_timeout'; payload: { clue_id: string; correct_answer: string } }
  | { type: 'score_update'; payload: { players: Pick<Player, 'id' | 'score'>[] } }
  | { type: 'turn_change'; payload: { player_id: string } }
  | { type: 'daily_double'; payload: { player_id: string } }
  | { type: 'wager_confirmed'; payload: { player_id: string; wager: number } }
  | { type: 'final_category'; payload: { category_name: string } }
  | { type: 'final_clue'; payload: { question: string } }
  | { type: 'final_reveal'; payload: { player_id: string; answer: string; wager: number; correct: boolean; new_score: number } }
  | { type: 'game_over'; payload: { rankings: { player_id: string; name: string; score: number; rank: number }[] } }
  | { type: 'timer_sync'; payload: { timer_name: string; remaining_ms: number } }
  | { type: 'player_disconnected'; payload: { player_id: string } }
  | { type: 'player_reconnected'; payload: { player_id: string } }

// Board representation for the UI
export interface BoardCell {
  clue_id: string
  value: number
  is_answered: boolean
  is_daily_double: boolean // only known server-side until selected
}

export interface BoardColumn {
  category: Category
  cells: BoardCell[]
}

export type Board = BoardColumn[]
