/**
 * BOARD OF THE DAY — results, standings and streaks.
 *
 * The boards themselves are fixed (daily-data.ts); this is everything that
 * happens around them.
 *
 *   · ONE SHOT per day. A unique constraint on (play_date, identity_key) is
 *     the referee, so a second tab or a second device can't get you a second
 *     go. Unlike a challenge board, a day is not replayable — a daily
 *     leaderboard that can be ground down isn't a leaderboard.
 *
 *   · Three standings, all computed from the same one fetch: TODAY (money on
 *     today's board), ALL TIME (money across every day played) and STREAKS
 *     (days in a row).
 *
 *   · A streak survives until you miss a whole day. Played today, or played
 *     yesterday and today isn't over: the streak is live. Miss a day and it's
 *     back to zero — which is the only rule that makes coming back matter.
 *
 * Your own record is ALSO kept in this browser, and the page reads that first.
 * It means the board tells you instantly that you've played today, shows your
 * score and streak with no round trip, and keeps working when the table hasn't
 * been created yet or Supabase is unreachable.
 */

import { supabase } from './supabase'
import { getChallengeIdentity } from './challenge'
import { addDays, todayISO } from './daily-data'
import type { ClueOutcome } from './challenge'

/** One clue of one person's day. c = category 0–2, r = row 0–2. */
export type DailyClueResult = {
  c: number
  r: number
  outcome: ClueOutcome
  value: number
  answer?: string
}

export type DailyResult = {
  id: string
  play_date: string
  board_key: string
  identity_key: string
  player_name: string
  score: number
  correct_count: number
  clue_results: DailyClueResult[]
  created_at: string
}

/** How far back the standings look. Long enough for any streak worth having. */
const HISTORY_DAYS = 400

/**
 * Who you are for the one-shot rule and the leaderboard — the same identity
 * the Challenge uses, deliberately: one guest id per browser, promoted to your
 * account when you sign in, so a person is one person across the whole site.
 */
export function dailyIdentity(userId?: string | null): string {
  return getChallengeIdentity(userId)
}

/** True when the failure is "daily_results isn't there yet". */
export function isMissingTable(message: string | undefined): boolean {
  if (!message) return false
  return /daily_results/i.test(message) && /(does not exist|not find|schema cache)/i.test(message)
}

function rowFromDb(r: any): DailyResult {
  return {
    id: r.id,
    play_date: r.play_date,
    board_key: r.board_key,
    identity_key: r.identity_key,
    player_name: r.player_name,
    score: r.score,
    correct_count: r.correct_count,
    clue_results: Array.isArray(r.clue_results) ? r.clue_results : [],
    created_at: r.created_at,
  }
}

export type DailyLoad =
  | { ok: true; rows: DailyResult[] }
  | { ok: false; missing: boolean }

/**
 * Every recorded day inside the window, newest first. One query feeds all
 * three standings — today's, all-time and the streaks — rather than three.
 */
export async function fetchDailyResults(): Promise<DailyLoad> {
  const since = addDays(todayISO(), -HISTORY_DAYS)
  const { data, error } = await supabase
    .from('daily_results')
    .select('*')
    .gte('play_date', since)
    .order('play_date', { ascending: false })
    .limit(5000)
  if (error) return { ok: false, missing: isMissingTable(error.message) }
  return { ok: true, rows: (data ?? []).map(rowFromDb) }
}

export type SubmitOutcome = 'recorded' | 'already-played'

/**
 * Record a finished day. 'already-played' means the unique constraint caught a
 * second attempt — the first score stands, and the caller should say so rather
 * than pretending the run counted.
 */
export async function submitDailyResult(input: {
  date: string
  boardKey: string
  identityKey: string
  userId?: string | null
  playerName: string
  score: number
  correctCount: number
  clueResults: DailyClueResult[]
}): Promise<SubmitOutcome> {
  const { error } = await supabase.from('daily_results').insert({
    play_date: input.date,
    board_key: input.boardKey,
    identity_key: input.identityKey,
    user_id: input.userId ?? null,
    player_name: input.playerName.slice(0, 30),
    score: input.score,
    correct_count: input.correctCount,
    clue_results: input.clueResults,
  })
  if (!error) return 'recorded'
  if ((error as any).code === '23505') return 'already-played'
  if (isMissingTable(error.message)) {
    throw new Error(
      'The daily table isn’t set up yet — run supabase-migration-daily.sql in the Supabase dashboard.',
    )
  }
  throw error
}

/* ───────────────────────────── standings ───────────────────────────── */

export type DayRow = {
  identityKey: string
  name: string
  score: number
  correct: number
  at: string
}

/** One day's board, best money first; a tie goes to whoever got there first. */
export function dayStandings(rows: DailyResult[], date: string): DayRow[] {
  return rows
    .filter((r) => r.play_date === date)
    .map((r) => ({
      identityKey: r.identity_key,
      name: r.player_name,
      score: r.score,
      correct: r.correct_count,
      at: r.created_at,
    }))
    .sort((a, b) => b.score - a.score || a.at.localeCompare(b.at))
}

export type AllTimeRow = {
  identityKey: string
  name: string
  total: number
  days: number
  best: number
  correct: number
}

/**
 * Money across every day a person has played, with days-played beside it: a
 * big total off twenty days reads differently from the same total off three,
 * and the table should let you see which it is.
 */
export function allTimeStandings(rows: DailyResult[]): AllTimeRow[] {
  const agg = new Map<string, AllTimeRow>()
  for (const r of rows) {
    const row =
      agg.get(r.identity_key) ??
      { identityKey: r.identity_key, name: '', total: 0, days: 0, best: -Infinity, correct: 0 }
    // Rows arrive newest-first, so the first name seen is the most recent.
    if (!row.name) row.name = r.player_name
    row.total += r.score
    row.days += 1
    row.best = Math.max(row.best, r.score)
    row.correct += r.correct_count
    agg.set(r.identity_key, row)
  }
  return [...agg.values()].sort((a, b) => b.total - a.total || b.days - a.days)
}

export type StreakRow = {
  identityKey: string
  name: string
  /** Days in a row, still alive. */
  current: number
  /** The longest they've ever run. */
  best: number
  days: number
}

/**
 * Longest run of consecutive dates in a sorted-descending date list, and the
 * run that's still going.
 *
 * "Still going" allows yesterday as well as today: the day isn't over, and
 * punishing someone at 9am for not having played yet would make the number
 * lie for most of the morning.
 */
export function streakOf(dates: string[], today = todayISO()): { current: number; best: number } {
  const seen = new Set(dates)
  const sorted = [...seen].sort()
  if (sorted.length === 0) return { current: 0, best: 0 }

  let best = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = addDays(sorted[i - 1], 1) === sorted[i] ? run + 1 : 1
    if (run > best) best = run
  }

  const yesterday = addDays(today, -1)
  let cursor = seen.has(today) ? today : seen.has(yesterday) ? yesterday : null
  let current = 0
  while (cursor && seen.has(cursor)) {
    current += 1
    cursor = addDays(cursor, -1)
  }
  return { current, best }
}

/** The streak table: live streaks first, then the longest ever run. */
export function streakStandings(rows: DailyResult[], today = todayISO()): StreakRow[] {
  const byId = new Map<string, { name: string; dates: string[] }>()
  for (const r of rows) {
    const e = byId.get(r.identity_key) ?? { name: r.player_name, dates: [] }
    if (!e.name) e.name = r.player_name
    e.dates.push(r.play_date)
    byId.set(r.identity_key, e)
  }
  return [...byId.entries()]
    .map(([identityKey, e]) => {
      const { current, best } = streakOf(e.dates, today)
      return { identityKey, name: e.name, current, best, days: new Set(e.dates).size }
    })
    .sort((a, b) => b.current - a.current || b.best - a.best || b.days - a.days)
}

/* ────────────────────── your own record, locally ────────────────────── */

const PLAYS_KEY = 'dailyPlays'
/**
 * Days played LATE, kept apart from the real ones on purpose: catching up on
 * six old boards in an afternoon must not hand you a six-day streak. Streaks
 * and the all-time table read PLAYS_KEY only; this is just so the catch-up
 * shelf can show what you've already done.
 */
const CATCHUP_KEY = 'dailyCatchUp'
const runKey = (date: string) => `dailyRun:${date}`

export type LocalPlay = {
  date: string
  boardKey: string
  score: number
  correct: number
  /** The nine outcomes in board order, for the shareable grid. */
  outcomes: ClueOutcome[]
  /**
   * Set once the day is on the public board. It's what stops a guest's score
   * being posted a second time under their account when they sign in after
   * playing — one person, one line on the day.
   */
  posted?: boolean
}

export function readLocalPlays(): Record<string, LocalPlay> {
  try {
    const raw = localStorage.getItem(PLAYS_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function noteLocalPlay(play: LocalPlay) {
  try {
    const all = readLocalPlays()
    all[play.date] = play
    localStorage.setItem(PLAYS_KEY, JSON.stringify(all))
  } catch {}
}

export function readCatchUps(): Record<string, LocalPlay> {
  try {
    const raw = localStorage.getItem(CATCHUP_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function noteCatchUp(play: LocalPlay) {
  try {
    const all = readCatchUps()
    all[play.date] = play
    localStorage.setItem(CATCHUP_KEY, JSON.stringify(all))
  } catch {}
}

/** Remember that a day made it onto the public board. */
export function markPosted(date: string) {
  try {
    const all = readLocalPlays()
    if (!all[date]) return
    all[date] = { ...all[date], posted: true }
    localStorage.setItem(PLAYS_KEY, JSON.stringify(all))
  } catch {}
}

/** Your streak from this browser alone — instant, and true even offline. */
export function localStreak(today = todayISO()): { current: number; best: number } {
  return streakOf(Object.keys(readLocalPlays()), today)
}

/** A day half-played, parked so a refresh resumes instead of resetting. */
export type SavedRun = { clueResults: DailyClueResult[] }

export function readRun(date: string): SavedRun | null {
  try {
    const raw = localStorage.getItem(runKey(date))
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && Array.isArray(parsed.clueResults) ? parsed : null
  } catch {
    return null
  }
}

export function saveRun(date: string, clueResults: DailyClueResult[]) {
  try {
    localStorage.setItem(runKey(date), JSON.stringify({ clueResults } satisfies SavedRun))
  } catch {}
}

export function clearRun(date: string) {
  try { localStorage.removeItem(runKey(date)) } catch {}
}

export function scoreOf(results: DailyClueResult[]): number {
  return results.reduce(
    (sum, r) => sum + (r.outcome === 'correct' ? r.value : r.outcome === 'wrong' ? -r.value : 0),
    0,
  )
}
