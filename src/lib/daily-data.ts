/**
 * THE BOARD OF THE DAY — twenty days that matter in Jeopardy! history.
 *
 * One 3×3 board, the same for everyone, changing at local midnight. It's the
 * first thing on the front page: nine real clues from one real night, $200 to
 * $600, no Daily Double and no Final — a board you finish standing up, which
 * is what makes a daily leaderboard worth looking at.
 *
 * Every day in the rotation is a day something HAPPENED: Alex Trebek's first
 * show and his last, the biggest one-day total ever won, the night each famous
 * streak began and the night it ended. The clues are pulled from the frozen
 * challenge boards (challenge-boards.json) — real clues from that exact
 * episode, already committed, never regenerated — and each board contributes
 * its two 3×3 rounds separately, so no two days here share a clue.
 *
 * Values are normalised to $200/$400/$600 whichever round the clues came
 * from. Every day is therefore worth exactly $3,600, and a score from one day
 * means the same as a score from another — the whole point of a daily.
 *
 * Day 21 wraps back to day 1 rather than running dry. Add days to the list
 * and the rotation just gets longer; the dates each board falls on shift, but
 * a finished day's scores are keyed by DATE, so nothing already played moves.
 */

import { getChallengeGame, type ChallengeCategory, type ChallengeGame } from './challenge-data'

export type DailyDay = {
  /** Which frozen board the clues come from. */
  boardKey: string
  /** Which of its two 3×3 rounds — each is its own day. */
  round: 1 | 2
  /** What happened that day, in a headline. */
  occasion: string
  /** Why the day is in here. One or two sentences, no hype. */
  story: string
}

/** $200/$400/$600, every day, whichever round the clues came from. */
export const DAILY_VALUES = [200, 400, 600]
export const DAILY_CLUES = 9
/** Three categories, three rows, nothing hidden: the perfect game. */
export const DAILY_MAX = DAILY_VALUES.reduce((a, b) => a + b, 0) * 3

/**
 * The rotation, in the order it runs. Twenty days.
 *
 * Verified against the air dates and show numbers already recorded on the
 * boards themselves — the episode a day names is the episode its clues came
 * from, which is the one fact here that has to be exactly right.
 */
export const DAILY_DAYS: DailyDay[] = [
  {
    boardKey: 'standard-1',
    round: 1,
    occasion: 'The first one Alex Trebek ever hosted',
    story:
      'Show #1, September 10, 1984. The revival nobody was sure about, with a brand-new host and $100 on the top row.',
  },
  {
    boardKey: 'standard-9',
    round: 1,
    occasion: "Alex Trebek's last episode",
    story:
      'Taped October 29, 2020, ten days before he died, and held back to air on January 8, 2021. His 37th season, and his last board.',
  },
  {
    boardKey: 'standard-4',
    round: 1,
    occasion: 'The biggest one-day total ever won',
    story:
      'James Holzhauer walked out of April 17, 2019 with $131,127 — a record that has not been touched since. This is the board he did it on.',
  },
  {
    boardKey: 'standard-3',
    round: 1,
    occasion: 'Ken Jennings, night one of 74',
    story:
      'June 2, 2004: a software engineer from Salt Lake City wins his first game. He does not lose again until November.',
  },
  {
    boardKey: 'standard-6',
    round: 1,
    occasion: 'The night the streak ended',
    story:
      'Game 75, November 30, 2004. Nancy Zerg beats Ken Jennings, and the longest run in the history of the show is over.',
  },
  {
    boardKey: 'standard-7',
    round: 1,
    occasion: "Roger Craig's $77,000",
    story:
      'September 14, 2010. The single-day record for nine years, until Holzhauer. Craig was a computer science PhD student who had studied the archive to do it.',
  },
  {
    boardKey: 'standard-10',
    round: 1,
    occasion: "Ken Jennings' first night as host",
    story:
      'January 11, 2021 — the first show after Alex Trebek’s last. The best player the game ever had, standing where Trebek stood.',
  },
  {
    boardKey: 'standard-5',
    round: 1,
    occasion: "Amy Schneider's debut",
    story:
      'November 17, 2021. Forty straight wins start here — the longest streak by a woman in the show’s history.',
  },
  {
    boardKey: 'standard-12',
    round: 1,
    occasion: 'The night Amy Schneider lost',
    story:
      'Game 41, January 26, 2022. Rhone Talsma, a Chicago librarian playing his first game, ends the 40-game run.',
  },
  {
    boardKey: 'standard-11',
    round: 1,
    occasion: 'The night Matt Amodio lost',
    story:
      'Game 39, October 11, 2021. Jonathan Fisher stops a 38-game streak that was second only to Jennings at the time.',
  },
  {
    boardKey: 'standard-8',
    round: 1,
    occasion: 'Holzhauer, $58,484 short',
    story:
      'June 3, 2019: Emma Boettcher beats James Holzhauer in game 33, leaving him just short of Ken Jennings’ regular-play record.',
  },
  {
    boardKey: 'standard-13',
    round: 1,
    occasion: "Arthur Chu's debut",
    story:
      'January 28, 2014. Chu hunted Daily Doubles, bounced around the board and wagered for the tie — and the internet argued about it for weeks.',
  },
  {
    boardKey: 'standard-15',
    round: 1,
    occasion: "Mattea Roach's first of 23",
    story:
      'April 5, 2022. A 23-year-old tutor from Toronto starts the longest run by a Canadian contestant.',
  },
  {
    boardKey: 'standard-14',
    round: 1,
    occasion: 'The day the money doubled',
    story:
      'November 26, 2001. The top row went from $100 to $200 and every value on the board doubled with it. The scale the show still uses.',
  },
  {
    boardKey: 'standard-2',
    round: 1,
    occasion: 'A Friday in 1996',
    story:
      'March 15, 1996, Season 12. No record, no streak — just the show at the height of its ordinary powers, which is its own kind of history.',
  },
  {
    boardKey: 'kids',
    round: 1,
    occasion: 'Kids Week',
    story:
      'December 5, 2014. The clues are written for ten-year-olds, which is no guarantee of anything.',
  },
  {
    boardKey: 'teen',
    round: 1,
    occasion: 'The 1994 Teen Tournament',
    story:
      'February 14, 1994. Teenagers playing for the title, back when a champion still retired after five wins.',
  },
  {
    boardKey: 'college',
    round: 1,
    occasion: 'The National College Championship',
    story:
      'February 22, 2022. The primetime college tournament, down to its last few games.',
  },
  {
    boardKey: 'standard-4',
    round: 2,
    occasion: 'The round that made the record',
    story:
      'Double Jeopardy from April 17, 2019 — the half of the night where Holzhauer’s $131,127 actually came together.',
  },
  {
    boardKey: 'standard-1',
    round: 2,
    occasion: 'Double Jeopardy, September 10, 1984',
    story:
      'The back half of Show #1 \u2014 forty-two years and more than nine thousand episodes ago.',
  },
]

/** The day DAILY_DAYS[0] runs. Shift this and every board shifts with it. */
export const DAILY_EPOCH = '2026-10-01'

export type DailyBoard = {
  /** The calendar day, local. Leaderboard rows key on this. */
  date: string
  /** Where this day sits in the rotation, 1-based. */
  dayNumber: number
  /** How many times the rotation has come around, 1-based. */
  cycle: number
  day: DailyDay
  game: ChallengeGame
  /** Exactly three, in board order. */
  categories: ChallengeCategory[]
  /** The episode these clues aired in. */
  show: string | null
  airDate: string | null
}

/** Today, on the player's own clock — not UTC, which is yesterday for half of them. */
export function todayISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Midnight UTC for a plain date, so differences can't be bitten by DST. */
function utcOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utcOf(to) - utcOf(from)) / 86_400_000)
}

export function addDays(iso: string, n: number): string {
  const t = new Date(utcOf(iso) + n * 86_400_000)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * The board for a date. Null only if the scheduled board has been re-keyed
 * out of the repo, which the caller should treat as "no board today" rather
 * than as an error — the front page still has a front page to be.
 */
export function boardForDate(dateISO: string): DailyBoard | null {
  const n = DAILY_DAYS.length
  const offset = daysBetween(DAILY_EPOCH, dateISO)
  const i = ((offset % n) + n) % n
  const day = DAILY_DAYS[i]
  const game = getChallengeGame(day.boardKey)
  if (!game) return null
  const categories = game.rounds[day.round - 1]
  if (!categories || categories.length < 3) return null
  return {
    date: dateISO,
    dayNumber: i + 1,
    cycle: Math.floor(offset / n) + 1,
    day,
    game,
    categories: categories.slice(0, 3),
    show: game.episode?.show ?? categories[0]?.show ?? null,
    airDate: game.episode?.airDate ?? categories[0]?.airDate ?? null,
  }
}

/** Seconds until the board changes, on the player's own clock. */
export function secondsUntilTomorrow(now: Date = new Date()): number {
  const next = new Date(now)
  next.setHours(24, 0, 0, 0)
  return Math.max(0, Math.round((next.getTime() - now.getTime()) / 1000))
}

/** "4h 12m" — how long today's board has left. */
export function untilTomorrowLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** "2026-10-01" → "Thu, Oct 1". */
export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${days[t.getUTCDay()]}, ${months[t.getUTCMonth()]} ${d}`
}
