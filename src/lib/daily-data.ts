/**
 * THE BOARD OF THE DAY — twenty days that matter in Jeopardy! history.
 *
 * One board, the same for everyone, changing at local midnight. It's the first
 * thing on the front page, and it's a whole game: a 3×3 Jeopardy round, a 3×3
 * Double Jeopardy round at doubled values, then Final Jeopardy with a wager —
 * nineteen real clues from one real night.
 *
 * Every day in the rotation is a day something HAPPENED: Alex Trebek's first
 * show and his last, the biggest one-day total ever won, the night each famous
 * streak began and the night it ended. The clues are pulled from the frozen
 * challenge boards (challenge-boards.json) — real clues from that exact
 * episode, already committed, never regenerated. One day is one episode, so no
 * two days here share a clue.
 *
 * Values are the show's own: $200–$600, then $400–$1,200, then whatever you
 * wager. Every day is therefore worth the same $10,800 before Final, and a
 * score from one day means the same as a score from another — the whole point
 * of a daily. The hidden Daily Doubles are the one thing left out: a daily
 * leaderboard decided by who found the wager square is a lottery, and the full
 * board in the Challenge still has them.
 *
 * Day 21 wraps back to day 1 rather than running dry. Add days to the list
 * and the rotation just gets longer; the dates each board falls on shift, but
 * a finished day's scores are keyed by DATE, so nothing already played moves.
 */

import { getChallengeGame, type ChallengeCategory, type ChallengeGame } from './challenge-data'

export type DailyDay = {
  /** Which frozen board the clues come from. */
  boardKey: string
  /**
   * The episode on J-Archive, which is what lets the page show the three
   * people who actually played this board and what they made on it. Verified
   * against each board's own categories, so it is the right night and not just
   * the show that aired that date — the College board in particular is a
   * primetime game, not the daytime show from 2022-02-22.
   */
  gameId: number
  /**
   * Who won, when the night's own scores don't say. A tournament final played
   * over two games carries each player's first-game total into the second, so
   * the biggest score ON THIS BOARD isn't the winner — set this to the name
   * J-Archive's results use and the crown goes to the right person.
   */
  winner?: string
  /** What happened that day, in a headline. */
  occasion: string
  /** Why the day is in here. One or two sentences, no hype. */
  story: string
}

/** Card values by round, as the show has had them since 2001. */
export const ROUND_VALUES: [number[], number[]] = [
  [200, 400, 600],
  [400, 800, 1200],
]
/** 9 + 9 + Final Jeopardy. */
export const DAILY_CLUES = 19
/** Every clue right, before Final doubles it: $3,600 + $7,200. */
export const DAILY_MAX =
  ROUND_VALUES[0].reduce((a, b) => a + b, 0) * 3 + ROUND_VALUES[1].reduce((a, b) => a + b, 0) * 3

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
    gameId: 173,
    occasion: 'The first one Alex Trebek ever hosted',
    story:
      'Show #1, September 10, 1984. The revival nobody was sure about, with a brand-new host and $100 on the top row.',
  },
  {
    boardKey: 'standard-9',
    gameId: 6900,
    occasion: "Alex Trebek's last episode",
    story:
      'Taped October 29, 2020, ten days before he died, and held back to air on January 8, 2021. His 37th season, and his last board.',
  },
  {
    boardKey: 'standard-4',
    gameId: 6266,
    occasion: 'The biggest one-day total ever won',
    story:
      'James Holzhauer walked out of April 17, 2019 with $131,127 — a record that has not been touched since. This is the board he did it on.',
  },
  {
    boardKey: 'standard-3',
    gameId: 224,
    occasion: 'Ken Jennings, night one of 74',
    story:
      'June 2, 2004: a software engineer from Salt Lake City wins his first game. He does not lose again until November.',
  },
  {
    boardKey: 'standard-6',
    gameId: 62,
    occasion: 'The night the streak ended',
    story:
      'Game 75, November 30, 2004. Nancy Zerg beats Ken Jennings, and the longest run in the history of the show is over.',
  },
  {
    boardKey: 'standard-7',
    gameId: 3459,
    occasion: "Roger Craig's $77,000",
    story:
      'September 14, 2010. The single-day record for nine years, until Holzhauer. Craig was a computer science PhD student who had studied the archive to do it.',
  },
  {
    boardKey: 'standard-10',
    gameId: 6901,
    occasion: "Ken Jennings' first night as host",
    story:
      'January 11, 2021 — the first show after Alex Trebek’s last. The best player the game ever had, standing where Trebek stood.',
  },
  {
    boardKey: 'standard-5',
    gameId: 7194,
    occasion: "Amy Schneider's debut",
    story:
      'November 17, 2021. Forty straight wins start here — the longest streak by a woman in the show’s history.',
  },
  {
    boardKey: 'standard-12',
    gameId: 7250,
    occasion: 'The night Amy Schneider lost',
    story:
      'Game 41, January 26, 2022. Rhone Talsma, a Chicago librarian playing his first game, ends the 40-game run.',
  },
  {
    boardKey: 'standard-11',
    gameId: 7163,
    occasion: 'The night Matt Amodio lost',
    story:
      'Game 39, October 11, 2021. Jonathan Fisher stops a 38-game streak that was second only to Jennings at the time.',
  },
  {
    boardKey: 'standard-8',
    gameId: 6304,
    occasion: 'Holzhauer, $58,484 short',
    story:
      'June 3, 2019: Emma Boettcher beats James Holzhauer in game 33, leaving him just short of Ken Jennings’ regular-play record.',
  },
  {
    boardKey: 'standard-13',
    gameId: 4408,
    occasion: "Arthur Chu's debut",
    story:
      'January 28, 2014. Chu hunted Daily Doubles, bounced around the board and wagered for the tie — and the internet argued about it for weeks.',
  },
  {
    boardKey: 'standard-15',
    gameId: 7324,
    occasion: "Mattea Roach's first of 23",
    story:
      'April 5, 2022. A 23-year-old tutor from Toronto starts the longest run by a Canadian contestant.',
  },
  {
    boardKey: 'standard-14',
    gameId: 1062,
    occasion: 'The day the money doubled',
    story:
      'November 26, 2001. The top row went from $100 to $200 and every value on the board doubled with it. The scale the show still uses.',
  },
  {
    boardKey: 'standard-2',
    gameId: 8073,
    occasion: 'A Friday in 1996',
    story:
      'March 15, 1996, Season 12. No record, no streak — just the show at the height of its ordinary powers, which is its own kind of history.',
  },
  {
    boardKey: 'kids',
    gameId: 4742,
    occasion: 'Kids Week',
    story:
      'December 5, 2014. The clues are written for ten-year-olds, which is no guarantee of anything.',
  },
  {
    boardKey: 'teen',
    gameId: 8187,
    occasion: 'The 1994 Teen Tournament',
    story:
      'February 14, 1994. Teenagers playing for the title, back when a champion still retired after five wins.',
  },
  {
    boardKey: 'college',
    gameId: 7294,
    /* The College Championship final ran over two games: Jaskaran took it with
       $51,700 across both, though Raymond outscored him on this board alone. */
    winner: 'Jaskaran',
    occasion: 'The National College Championship',
    story:
      'February 22, 2022. The primetime college tournament, down to its last few games.',
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
  /** [Jeopardy, Double Jeopardy] — three categories each. */
  rounds: [ChallengeCategory[], ChallengeCategory[]]
  final: ChallengeGame['finalJeopardy']
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
  const [j, dj] = game.rounds
  if (!j || j.length < 3 || !dj || dj.length < 3) return null
  return {
    date: dateISO,
    dayNumber: i + 1,
    cycle: Math.floor(offset / n) + 1,
    day,
    game,
    rounds: [j.slice(0, 3), dj.slice(0, 3)],
    final: game.finalJeopardy,
    show: game.episode?.show ?? j[0]?.show ?? null,
    airDate: game.episode?.airDate ?? j[0]?.airDate ?? null,
  }
}

/**
 * The days already gone, newest first, back to the epoch — the catch-up shelf.
 *
 * Today is never in here: today's board is the ranked one, and it lives on the
 * front page. Past days are playable but not ranked, which is the only way a
 * daily leaderboard can mean anything.
 */
export function pastDays(today: string = todayISO(), limit = 60): DailyBoard[] {
  const out: DailyBoard[] = []
  for (let i = 1; i <= limit; i++) {
    const date = addDays(today, -i)
    if (daysBetween(DAILY_EPOCH, date) < 0) break
    const board = boardForDate(date)
    if (board) out.push(board)
  }
  return out
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
