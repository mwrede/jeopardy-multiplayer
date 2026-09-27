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

export type Outcome = 'correct' | 'wrong' | 'pass'
export type Resolved = { outcome: Outcome; delta: number; typed: string }

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
  /** A tournament's label ("2012 Tournament of Champions") when the run is
   *  one of those rather than regular play; the next night is then the
   *  event's next game, not the next show on the calendar. */
  series?: string
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
const NIGHT_KEY = 'campaign:night'

/**
 * A night in progress, written after every clue so the tab can close — or
 * the phone can ring — and the board comes back exactly as it was. A clue
 * that was open when you left is simply unplayed. Final is saved only once
 * it's decided; leave during the wager or the clue and it restarts from the
 * category card.
 */
export type NightSave = {
  gameId: number
  size: GameLength
  resolved: Record<string, Resolved>
  round: 1 | 2
  at: 'playing' | 'curtain' | 'final'
  final: { result: { right: boolean; delta: number; typed: string }; stake: number } | null
  savedAt: string
}

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
export const loadNightSave = () => read<NightSave>(NIGHT_KEY)
export const saveNightSave = (n: NightSave) => write(NIGHT_KEY, n)
export function clearNightSave() { if (canStore()) localStorage.removeItem(NIGHT_KEY) }

/** Record a run against the all-time best if it beats it. Returns the best. */
export function noteBest(run: Run, name: string): BestRun {
  const cur = loadBest()
  const mine: BestRun = { streak: run.streak, winnings: run.totalWinnings, name, startGameId: run.startGameId }
  const better = !cur || mine.streak > cur.streak || (mine.streak === cur.streak && mine.winnings > cur.winnings)
  if (better) write(BEST_KEY, mine)
  return better ? mine : cur!
}

export type EpisodeInfo = {
  gameId: number
  title: string
  airDate: string | null
  season: string
  /** The event, for a tournament or special ("2012 Tournament of Champions"); null for regular play. */
  series: string | null
  /** Where in the event ("quarterfinal game 1"); null for regular play. */
  stage: string | null
}

const INFO_COLS = 'game_id_source, game_title, air_date, season, notes'

/**
 * What J-Archive's game note says the night was. Regular games read
 * "Dave Leach game 4."; a tournament game reads "2012 Tournament of Champions
 * quarterfinal game 1." — the event, then the stage. Anchored on the leading
 * year on purpose: a regular game's note can MENTION a tournament ("last game
 * before the Tournament of Champions") and must not be mistaken for one.
 */
export function eventOf(notes: string | null | undefined): { series: string | null; stage: string | null; special: boolean } {
  // The note's first sentence: the importer stored "<summary>.. <full text>",
  // and the summary itself can run on ("...quarterfinal game 1. Category
  // names in the...").
  const head = (notes || '').split('..')[0].split('\n')[0].split(/\.\s/)[0].trim().replace(/\.$/, '')
  if (!head) return { series: null, stage: null, special: false }
  const m = head.match(/^(\d{4}(?:-[A-Za-z0-9]+)?\s+.*?)\s+((?:quarterfinal|semifinal|final|wild ?card|exhibition|game|round|match|play-?in|day|week)\b.*)$/i)
  if (m) return { series: m[1].trim(), stage: m[2].trim(), special: true }
  if (/^\d{4}\b/.test(head) || /^(Celebrity|Kids|Teen|College|Teachers|Power Players|Battle|Million|Ultimate|Super|IBM|Greatest|Masters|Second Chance|Invitational|Tournament|Primetime|Prime Time|Back to School|Holiday|All-Star|Trebek pilot)/i.test(head)) {
    return { series: head, stage: null, special: true }
  }
  return { series: null, stage: null, special: false }
}

function toInfo(r: any): EpisodeInfo {
  const ev = eventOf(r.notes)
  return {
    gameId: r.game_id_source, title: r.game_title || '', airDate: r.air_date, season: r.season || '',
    series: ev.series, stage: ev.stage,
  }
}

/** Title, date, season and event of an episode, from the games index. */
export async function episodeInfo(gameId: number): Promise<EpisodeInfo | null> {
  const { data } = await supabase
    .from('games_index')
    .select(INFO_COLS)
    .eq('game_id_source', gameId)
    .maybeSingle()
  return data ? toInfo(data) : null
}

/** A game number buried in a stage label ("final game 2" → 2), for same-day games. */
const stageNo = (stage: string | null) => {
  const m = stage?.match(/game\s+(\d+)/i)
  return m ? parseInt(m[1], 10) : 0
}
const byPlayOrder = (a: EpisodeInfo, b: EpisodeInfo) =>
  (a.airDate || '').localeCompare(b.airDate || '') || stageNo(a.stage) - stageNo(b.stage) || a.gameId - b.gameId

/** Every game of one event, in the order it was played. */
export async function seriesGames(series: string): Promise<EpisodeInfo[]> {
  const { data } = await supabase
    .from('games_index')
    .select(INFO_COLS)
    .ilike('notes', `${series}%`)
    .limit(200)
  return (data ?? []).map(toInfo).filter((e) => e.series === series).sort(byPlayOrder)
}

/**
 * The night after this one. In a tournament that's the event's next game.
 * In regular play it's the next show on the calendar that IS regular play —
 * the returning champion sits out the Tournament of Champions and the
 * college kids and comes back when they're done, and so do you. Null once
 * the archive (or the event) runs out.
 */
export async function nextEpisode(gameId: number, series?: string | null): Promise<EpisodeInfo | null> {
  const cur = await episodeInfo(gameId)
  if (!cur || !cur.airDate) return null
  if (series) {
    const games = await seriesGames(series)
    const i = games.findIndex((g) => g.gameId === gameId)
    return i >= 0 ? games[i + 1] ?? null : null
  }
  let after = cur.airDate
  // A tournament block is at most a few weeks of shows; a page or two of
  // forty covers it.
  for (let page = 0; page < 8; page++) {
    const { data } = await supabase
      .from('games_index')
      .select(INFO_COLS)
      .gt('air_date', after)
      .order('air_date', { ascending: true })
      .order('game_id_source', { ascending: true })
      .limit(40)
    if (!data?.length) return null
    const hit = data.find((r: any) => !eventOf(r.notes).special)
    if (hit) return toInfo(hit)
    after = data[data.length - 1].air_date
  }
  return null
}

/** The tournament families a run can start in. */
export const TOURNAMENT_KINDS = [
  { id: 'toc', label: 'Tournament of Champions', match: 'Tournament of Champions' },
  { id: 'college', label: 'College Championship', match: 'College' },
  { id: 'teen', label: 'Teen Tournament', match: 'Teen' },
  { id: 'teachers', label: 'Teachers Tournament', match: 'Teachers' },
] as const

export type Tournament = { series: string; games: EpisodeInfo[] }

/** Every event of one kind in the archive, newest first, each with its games in play order. */
export async function tournamentsOf(match: string): Promise<Tournament[]> {
  const { data } = await supabase
    .from('games_index')
    .select(INFO_COLS)
    .ilike('notes', `%${match}%`)
    .limit(1000)
  const groups = new Map<string, EpisodeInfo[]>()
  for (const r of data ?? []) {
    const e = toInfo(r)
    if (!e.series || !new RegExp(match, 'i').test(e.series)) continue
    groups.set(e.series, [...(groups.get(e.series) ?? []), e])
  }
  return [...groups.entries()]
    .map(([series, games]) => ({ series, games: games.sort(byPlayOrder) }))
    .sort((a, b) => (b.games[0]?.airDate || '').localeCompare(a.games[0]?.airDate || ''))
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
    .select(INFO_COLS)
    .or(`player1.ilike.*${n}*,player2.ilike.*${n}*,player3.ilike.*${n}*`)
    .order('air_date', { ascending: true, nullsFirst: false })
    .limit(1)
  const row = data?.[0]
  return row ? toInfo(row) : null
}

/** Episodes that aired in a calendar year, oldest first. */
export async function episodesInYear(year: number): Promise<EpisodeInfo[]> {
  const { data } = await supabase
    .from('games_index')
    .select(INFO_COLS)
    .gte('air_date', `${year}-01-01`)
    .lte('air_date', `${year}-12-31`)
    .order('air_date', { ascending: true })
    .order('game_id_source', { ascending: true })
    .limit(400)
  return (data ?? []).map(toInfo)
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

type Board = ReturnType<typeof boardFor>

/**
 * A contestant's real running total right before a clue was played that
 * night — J-Archive's clue order, round one wholly before round two. Pass
 * a round past the last to get their total going into Final.
 */
export function realScoreBefore(episode: Episode, who: EpisodeContestant, rd: number, order: number | null): number {
  let total = 0
  episode.rounds.forEach((round, i) => {
    if (i + 1 > rd) return
    for (const cl of round.clues) {
      // Same round: only what came before. Unknown order counts as nothing before it.
      if (i + 1 === rd && (order == null || cl.order == null || cl.order >= order)) continue
      for (const resp of cl.responses) {
        if (resp.name !== who.first) continue
        const stake = cl.ddWager != null ? cl.ddWager : cl.value
        total += resp.right ? stake : -stake
      }
    }
  })
  return total
}

const toHundred = (n: number) => Math.round(n / 100) * 100

/**
 * What a contestant puts on a Daily Double on THIS board. A smaller board
 * means smaller totals, so the recorded dollars are replayed as the same
 * fraction of what they held: half their money that night is half their
 * money tonight. Where they had nothing (or we have them at nothing) it's the
 * same fraction of the most the rules allowed. The full board is the real
 * night, and the wager is the real wager.
 */
export function contestantDdWager(
  episode: Episode,
  board: Board,
  who: EpisodeContestant,
  clue: EpisodeClue,
  rd: number,
  held: number,
  full: boolean,
): number {
  const real = clue.ddWager ?? clue.value
  if (full) return real
  const top = board.rounds[rd - 1].values.slice(-1)[0] ?? clue.value
  const most = Math.max(held, top)
  const realBefore = realScoreBefore(episode, who, rd, clue.order)
  const realTop = Math.max(0, ...episode.rounds[rd - 1].clues.map((c) => c.value)) || top
  const w = realBefore > 0 && held > 0
    ? (real / realBefore) * held
    : (real / Math.max(realBefore, realTop)) * most
  return Math.min(Math.max(toHundred(w), 5), most)
}

/**
 * A real contestant's total from the clues resolved so far, in the order
 * they were played. They score when YOU resolve a clue — like a ghost — so
 * the race moves together. On a Daily Double the money is what they wagered,
 * scaled to this board (see contestantDdWager) off what they held at that
 * moment; nobody else can score on a DD, since only the finder answers it.
 * `until` stops short of one clue: their total going INTO it.
 */
export function contestantScore(
  episode: Episode,
  board: Board,
  who: EpisodeContestant,
  resolved: Iterable<string>,
  full: boolean,
  until?: string,
): number {
  let total = 0
  for (const key of resolved) {
    if (key === until) break
    const [rd, c, r] = key.split(':').map(Number)
    const cl = clueAt(board, rd, c, r)
    if (!cl) continue
    for (const resp of cl.responses) {
      if (resp.name !== who.first) continue
      const stake = cl.ddWager != null ? contestantDdWager(episode, board, who, cl, rd, total, full) : cl.value
      total += resp.right ? stake : -stake
    }
  }
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
 * board. On a smaller board the recorded wager becomes the same fraction of
 * what they hold tonight that it was of what they held that night; on the
 * full board it's the real wager. Either way it can't exceed what they have,
 * and a contestant at zero or below wagers nothing.
 */
export function contestantFinal(
  episode: Episode,
  who: EpisodeContestant,
  before: number,
  full = true,
): { wager: number; right: boolean; written: string } | null {
  const rec = episode.final?.responses.find((r) => r.name === who.first)
  if (!rec) return null
  const cap = Math.max(0, before)
  if (full) return { wager: Math.min(rec.wager, cap), right: rec.right, written: rec.written }
  const realBefore = realScoreBefore(episode, who, 3, null)
  const w = realBefore > 0 && before > 0 ? toHundred((rec.wager / realBefore) * before) : 0
  return { wager: Math.min(Math.max(0, w), cap), right: rec.right, written: rec.written }
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
