/**
 * CAMPAIGN — Against Real Contestants.
 *
 * You're the fourth podium on a real episode. The three people who actually
 * played it score exactly as they did that night, clue by clue, beside you.
 * Win and you come back tomorrow — the next episode in the season, against
 * whoever was there — and the run goes on until you lose. The score is how
 * far into the season you got.
 *
 * Everything about a run lives in this browser (localStorage). No account, no
 * table, no migration: it's one person's story, and it doesn't need to be
 * anywhere else.
 *
 * Board size is the player's choice each night. A smaller board is a SUBSET
 * of the real one — the first categories and the cheapest rows — and the real
 * contestants are scored on those same clues only, so it stays a fair race
 * whatever the size. Their money is remapped to the size's values just as
 * yours is, so a Rapid night pays Rapid money for everyone.
 */

import { supabase } from './supabase'
import { GAME_LENGTH_CONFIG, type GameLength } from '@/types/game'
import type { Episode, EpisodeClue, EpisodeContestant } from './episode'

export type Profile = { name: string; hometown: string; anecdote: string }

export type NightResult = {
  gameId: number
  title: string
  airedOn: string | null
  size: GameLength
  myScore: number
  /** The real contestants' finals on this board, seat order. */
  theirs: { name: string; score: number }[]
  won: boolean
}

export type Run = {
  /** Client-minted, so nights can be grouped without an account. */
  id?: string
  /** Set when the run started on the first night of a famous streak. */
  chasing?: { name: string; games: number }
  startGameId: number
  currentGameId: number
  season: string
  /** Nights won in a row — the campaign's score. */
  streak: number
  totalWinnings: number
  history: NightResult[]
  startedAt: string
  /** Set once a night is lost; the run is over but stays readable. */
  endedAt: string | null
}

const PROFILE_KEY = 'campaign:profile'
const RUN_KEY = 'campaign:run'
const BEST_KEY = 'campaign:best'

/** The best run this browser has ever put together, kept across campaigns. */
export type BestRun = { streak: number; winnings: number; name: string; startGameId: number }

const canStore = () => typeof window !== 'undefined' && !!window.localStorage

function read<T>(key: string): T | null {
  if (!canStore()) return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}
function write(key: string, value: unknown) {
  if (!canStore()) return
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

export const loadProfile = () => read<Profile>(PROFILE_KEY)
export const saveProfile = (p: Profile) => write(PROFILE_KEY, p)
export const loadRun = () => read<Run>(RUN_KEY)
export const saveRun = (r: Run) => write(RUN_KEY, r)
export function clearRun() { if (canStore()) localStorage.removeItem(RUN_KEY) }
export const loadBest = () => read<BestRun>(BEST_KEY)

/** Record a run against the all-time best if it beats it. Returns the best. */
export function noteBest(run: Run, name: string): BestRun {
  const cur = loadBest()
  const mine: BestRun = { streak: run.streak, winnings: run.totalWinnings, name, startGameId: run.startGameId }
  const better = !cur || mine.streak > cur.streak || (mine.streak === cur.streak && mine.winnings > cur.winnings)
  if (better) write(BEST_KEY, mine)
  return better ? mine : cur!
}

export type EpisodeInfo = { gameId: number; title: string; airDate: string | null; season: string }

/** Title, date and season of an episode, from the games index. */
export async function episodeInfo(gameId: number): Promise<EpisodeInfo | null> {
  const { data } = await supabase
    .from('games_index')
    .select('game_id_source, game_title, air_date, season')
    .eq('game_id_source', gameId)
    .maybeSingle()
  if (!data) return null
  return { gameId: data.game_id_source, title: data.game_title || '', airDate: data.air_date, season: data.season || '' }
}

/** The episode that aired next in the same season, or null at season's end. */
export async function nextEpisode(gameId: number): Promise<EpisodeInfo | null> {
  const cur = await episodeInfo(gameId)
  if (!cur || !cur.airDate) return null
  const { data } = await supabase
    .from('games_index')
    .select('game_id_source, game_title, air_date, season')
    .eq('season', cur.season)
    .gt('air_date', cur.airDate)
    .order('air_date', { ascending: true })
    .limit(1)
  const row = data?.[0]
  if (!row) return null
  return { gameId: row.game_id_source, title: row.game_title || '', airDate: row.air_date, season: row.season || '' }
}

/**
 * The first episode a contestant appears in — for a champion, the night their
 * streak began. Looked up by name in the games index rather than hardcoded,
 * so it stays right if the index is rebuilt. Later appearances (tournaments,
 * the GOAT series) sort after by date and don't interfere.
 */
export async function firstGameOf(name: string): Promise<EpisodeInfo | null> {
  const n = name.replace(/[,()*]/g, ' ').trim()
  if (!n) return null
  const { data } = await supabase
    .from('games_index')
    .select('game_id_source, game_title, air_date, season')
    .or(`player1.ilike.*${n}*,player2.ilike.*${n}*,player3.ilike.*${n}*`)
    .order('air_date', { ascending: true, nullsFirst: false })
    .limit(1)
  const row = data?.[0]
  if (!row) return null
  return { gameId: row.game_id_source, title: row.game_title || '', airDate: row.air_date, season: row.season || '' }
}

/** Episodes that aired in a calendar year, oldest first. */
export async function episodesInYear(year: number): Promise<EpisodeInfo[]> {
  const { data } = await supabase
    .from('games_index')
    .select('game_id_source, game_title, air_date, season')
    .gte('air_date', `${year}-01-01`)
    .lte('air_date', `${year}-12-31`)
    .order('air_date', { ascending: true })
    .limit(400)
  return (data ?? []).map((r: any) => ({
    gameId: r.game_id_source, title: r.game_title || '', airDate: r.air_date, season: r.season || '',
  }))
}

/* ── Board subsetting and scoring ──────────────────────────────────────── */

export const cellKey = (rd: number, c: number, r: number) => `${rd}:${c}:${r}`

/** Which real clues are on the board at this size, remapped to its values. */
export function boardFor(episode: Episode, size: GameLength) {
  const cfg = GAME_LENGTH_CONFIG[size]
  const rounds = episode.rounds.map((round, i) => {
    const values = i === 0 ? cfg.values1 : cfg.values2
    const categories = round.categories.slice(0, cfg.categories)
    const clues = round.clues
      .filter((cl) => cl.c < cfg.categories && cl.r < cfg.cluesPerCat)
      .map((cl) => ({ ...cl, value: values[cl.r] ?? cl.value }))
    return { categories, clues, values }
  })
  return { rounds, cfg }
}

/** The single clue at a cell, if it was revealed that night. */
export function clueAt(board: ReturnType<typeof boardFor>, rd: number, c: number, r: number): EpisodeClue | undefined {
  return board.rounds[rd - 1]?.clues.find((cl) => cl.c === c && cl.r === r)
}

/**
 * A real contestant's total from the clues resolved so far. They score when
 * YOU resolve a clue — like a ghost — so the race moves together. On a Daily
 * Double the money is what they actually wagered; nobody else can score on
 * a DD, since only the finder answers it.
 */
export function contestantScore(
  board: ReturnType<typeof boardFor>,
  who: EpisodeContestant,
  resolved: Set<string>,
): number {
  let total = 0
  board.rounds.forEach((round, i) => {
    for (const cl of round.clues) {
      if (!resolved.has(cellKey(i + 1, cl.c, cl.r))) continue
      for (const resp of cl.responses) {
        if (resp.name !== who.first) continue
        const stake = cl.ddWager != null ? cl.ddWager : cl.value
        total += resp.right ? stake : -stake
      }
    }
  })
  return total
}

/** Who rang in on a clue, resolved to contestants, in order. */
export function whoAnswered(
  clue: EpisodeClue,
  contestants: EpisodeContestant[],
): { who: EpisodeContestant; right: boolean }[] {
  return clue.responses
    .map((r) => ({ who: contestants.find((c) => c.first === r.name), right: r.right }))
    .filter((x): x is { who: EpisodeContestant; right: boolean } => !!x.who)
}

/**
 * A contestant's Final Jeopardy, replayed against the total they have on THIS
 * board. The recorded wager was made against their real total, which a smaller
 * board won't match, so it's capped at what they hold — the rules' cap.
 */
export function contestantFinal(
  episode: Episode,
  who: EpisodeContestant,
  before: number,
): { wager: number; right: boolean; written: string } | null {
  const rec = episode.final?.responses.find((r) => r.name === who.first)
  if (!rec) return null
  return { wager: Math.min(rec.wager, Math.max(0, before)), right: rec.right, written: rec.written }
}

/* ── The shared record ─────────────────────────────────────────────────── */

export type NightRow = {
  run_id: string
  identity_key: string
  player_name: string
  hometown: string | null
  game_id_source: number
  aired_on: string | null
  size: string
  my_score: number
  their_scores: { name: string; score: number }[]
  won: boolean
  streak_after: number
  winnings_after: number
  created_at: string
}

export const newRunId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/**
 * Publish a settled night. Fire-and-forget: the run is already saved locally,
 * and the table may not exist yet (supabase-migration-campaign.sql is hand-run
 * like the rest), so a failure here changes nothing the player can see.
 */
export async function recordNight(run: Run, profile: Profile, identity: string, night: NightResult) {
  try {
    await supabase.from('campaign_nights').insert({
      run_id: run.id ?? newRunId(),
      identity_key: identity,
      player_name: profile.name.slice(0, 40),
      hometown: profile.hometown.slice(0, 60) || null,
      game_id_source: night.gameId,
      aired_on: night.airedOn,
      size: night.size,
      my_score: night.myScore,
      their_scores: night.theirs,
      won: night.won,
      streak_after: run.streak,
      winnings_after: run.totalWinnings,
    })
  } catch {}
}

export type Standings = {
  available: boolean
  /** Best night reached per run, longest first. */
  streaks: { name: string; hometown: string | null; streak: number; winnings: number; when: string }[]
  /** Most recent nights won. */
  beat: NightRow[]
  /** Most recent nights lost. */
  fell: NightRow[]
}

export async function campaignStandings(): Promise<Standings> {
  const { data, error } = await supabase
    .from('campaign_nights')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) return { available: false, streaks: [], beat: [], fell: [] }

  const rows = (data ?? []) as NightRow[]
  const byRun = new Map<string, { name: string; hometown: string | null; streak: number; winnings: number; when: string }>()
  for (const r of rows) {
    const cur = byRun.get(r.run_id)
    if (!cur || r.streak_after > cur.streak) {
      byRun.set(r.run_id, {
        name: r.player_name, hometown: r.hometown, streak: r.streak_after,
        winnings: r.winnings_after, when: r.created_at,
      })
    }
  }
  const streaks = [...byRun.values()]
    .filter((x) => x.streak > 0)
    .sort((a, b) => b.streak - a.streak || b.winnings - a.winnings)

  return {
    available: true,
    streaks,
    beat: rows.filter((r) => r.won),
    fell: rows.filter((r) => !r.won),
  }
}
